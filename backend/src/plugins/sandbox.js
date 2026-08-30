/**
 * src/plugins/sandbox.js
 *
 * Genuine sandboxed execution for untrusted plugin code (Issue #322).
 *
 * ARCHITECTURE NOTE — why a forked OS process, not `worker_threads`:
 *
 * The first implementation of this module used `worker_threads.Worker`
 * with `resourceLimits` to cap memory. Under test
 * (`sandbox.test.js`'s "a plugin that allocates one huge block cannot
 * abort the host process" case), a plugin that performs one large
 * allocation exceeding the configured heap in a single call — e.g.
 * `new Array(1e7).fill("x")` inside a tight loop — was found to trigger
 * V8's *fatal* out-of-memory path rather than the graceful,
 * `resourceLimits`-catchable one. A V8 fatal OOM is a native abort, not a
 * catchable JS exception or a `'error'` event: it is unconditional and, for
 * a `worker_threads` thread, it **takes the entire host process down with
 * it**, because a worker thread shares one OS process (and therefore one
 * `abort()`) with the thread that spawned it. This was verified
 * empirically, not assumed — see the git history on this file if the
 * `worker_threads` version is of interest for comparison.
 *
 * That failure mode is exactly what the issue's "a plugin crash is
 * contained and reported, never surfacing as a platform failure"
 * acceptance criterion rules out. So the outer isolation boundary here is
 * `child_process.fork()`: a genuine separate OS process, its own address
 * space, its own V8 instance. A fatal OOM abort in the child terminates
 * *that process* — the parent observes a `SIGABRT` exit and reports it as a
 * contained `PluginError`; the host is never at risk. `--max-old-space-size`
 * passed via `execArgv` still caps the child's heap; a graceful
 * near-limit case still surfaces as a clean out-of-memory error, and even
 * the ungraceful, single-huge-allocation case is now merely a child-process
 * exit, not a host-process crash.
 *
 * Inside that process, a second boundary: a `vm.createContext` sandbox — a
 * fresh global object with no `require`, no `process`, no
 * `fs`/`net`/`http`. The plugin's source is compiled and run *only* inside
 * this stripped context (see childEntry.js). The one thing it is given is
 * `marketpay.call(method, params)`, an async RPC bridge that messages a
 * request out to the parent, which mediates it against the plugin's
 * declared, installer-granted permissions (broker.js) before doing
 * anything.
 *
 * What this deliberately does NOT do: give a plugin a WebAssembly runtime.
 * A forked Node process running JS inside a stripped `vm` context achieves
 * the same "genuine isolate, not a same-process callback" property this
 * issue asks for, without adding a second language runtime to build
 * tooling and audit for. See docs/ADR-011-plugin-platform.md for the
 * design record and the WASM option this considered and deferred.
 */
"use strict";

const { fork } = require("node:child_process");
const path = require("node:path");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("plugin-sandbox");

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_OLD_SPACE_MB = 64;
const MAX_RESULT_BYTES = 256 * 1024;
const READY_TIMEOUT_MS = 3000;

const CHILD_ENTRY = path.join(__dirname, "childEntry.js");

class PluginError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = "PluginError";
    this.code = code || "PLUGIN_ERROR";
    this.cause = cause;
  }
}

/**
 * Run one plugin invocation to completion (or failure) in a fresh,
 * disposable child process. A new process per call is deliberate: no
 * state, no warm reuse, no way for one invocation's mistakes (a global left
 * dirty, a pending timer, a half-crashed heap) to bleed into the next one —
 * the isolation boundary is the call, not the plugin's lifetime.
 *
 * `onBrokerCall(method, params)` is invoked for every `marketpay.call(...)`
 * the plugin makes; it is the caller's (pluginService's) responsibility to
 * check the requested method against the plugin's granted permissions
 * before doing anything — see broker.js. This function never trusts the
 * child's claims about what it's allowed to do.
 */
function runPlugin({
  source,
  hookName,
  payload,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOldSpaceMb = DEFAULT_MAX_OLD_SPACE_MB,
  onBrokerCall,
  pluginId = "unknown",
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle = null;
    let readyTimeoutHandle = null;

    const child = fork(CHILD_ENTRY, [], {
      // NOTE: no --disallow-code-generation-from-strings here — childEntry.js
      // itself must compile the plugin's source via vm.Script, which *is*
      // code generation from a string. The safety boundary against a
      // plugin's own eval()/Function() is the vm context's own
      // `codeGeneration: { strings: false }` (see childEntry.js), which
      // applies only to that inner context, not this whole process.
      //
      // `--permission` with no --allow-fs-read/--allow-fs-write/
      // --allow-child-process/--allow-worker: Node's Permission Model,
      // enforced at the runtime binding layer rather than by JS object
      // references, so it still holds even for code that reaches
      // `process.mainModule.require` via a vm-context constructor-chain
      // trick (verified — see docs/ADR-011-plugin-platform.md, "Sandbox
      // limitations", for the one thing this does NOT close: raw network
      // sockets are not yet gateable by Node's Permission Model, so the
      // broker in broker.js remains the only *mediated* network path, not
      // a hard guarantee against a plugin that deliberately attacks the
      // sandbox rather than merely using the SDK it was given).
      execArgv: [`--max-old-space-size=${maxOldSpaceMb}`, "--permission"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {}, // no inherited environment (secrets, config) for the plugin process
      serialization: "json",
    });

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (readyTimeoutHandle) clearTimeout(readyTimeoutHandle);
      child.removeAllListeners();
      if (!child.killed) child.kill("SIGKILL");
      fn(value);
    };

    timeoutHandle = setTimeout(() => {
      settle(
        reject,
        new PluginError(`plugin "${pluginId}" exceeded ${timeoutMs}ms execution limit`, {
          code: "TIMEOUT",
        })
      );
    }, timeoutMs);

    readyTimeoutHandle = setTimeout(() => {
      settle(
        reject,
        new PluginError(`plugin "${pluginId}" sandbox process failed to start`, {
          code: "START_FAILED",
        })
      );
    }, READY_TIMEOUT_MS);

    // Surface anything a misbehaving plugin writes to fd 1/2 in the logs,
    // capped, without ever giving the plugin a real stream object it could
    // abuse (stdio is piped, not inherited).
    let stderrBuf = "";
    child.stderr?.on("data", (chunk) => {
      stderrBuf = (stderrBuf + chunk.toString("utf8")).slice(-4000);
    });

    child.on("message", async (msg) => {
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ready") {
        if (readyTimeoutHandle) clearTimeout(readyTimeoutHandle);
        child.send({ type: "init", source, hookName, payload });
        return;
      }

      if (msg.type === "result") {
        const size = Buffer.byteLength(JSON.stringify(msg.value ?? null), "utf8");
        if (size > MAX_RESULT_BYTES) {
          settle(
            reject,
            new PluginError(`plugin "${pluginId}" result exceeds ${MAX_RESULT_BYTES} bytes`, {
              code: "RESULT_TOO_LARGE",
            })
          );
          return;
        }
        settle(resolve, msg.value);
        return;
      }

      if (msg.type === "error") {
        settle(
          reject,
          new PluginError(`plugin "${pluginId}" threw: ${msg.message}`, {
            code: "PLUGIN_THREW",
            cause: msg.stack,
          })
        );
        return;
      }

      if (msg.type === "log") {
        logger.info({ pluginId, level: msg.level }, msg.line);
        return;
      }

      if (msg.type === "broker") {
        // Mediated capability call — the only way out of the vm context.
        // Never resolved locally; always deferred to the caller-supplied
        // permission-checked handler.
        try {
          const result = await onBrokerCall(msg.method, msg.params);
          child.send({ type: "broker-response", callId: msg.callId, ok: true, value: result });
        } catch (err) {
          child.send({
            type: "broker-response",
            callId: msg.callId,
            ok: false,
            error: err.message,
          });
        }
        return;
      }
    });

    child.on("error", (err) => {
      logger.warn({ pluginId, error: err.message }, "Plugin sandbox process error");
      settle(
        reject,
        new PluginError(`plugin "${pluginId}" sandbox process error: ${err.message}`, {
          code: "PROCESS_ERROR",
          cause: err,
        })
      );
    });

    // The critical containment path: whatever kills the child — a clean
    // exit, --max-old-space-size OOM, or a native fatal abort from a
    // single-huge-allocation OOM (see module doc comment) — surfaces here
    // as a normal Node 'exit' event on the *parent's* child handle. The
    // parent process itself is never at risk; that is the entire point of
    // this being a process boundary rather than a thread boundary.
    child.on("exit", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        // Exited cleanly without ever sending a result/error message —
        // treat as contained failure, not a hang.
        settle(
          reject,
          new PluginError(`plugin "${pluginId}" exited without producing a result`, {
            code: "NO_RESULT",
          })
        );
        return;
      }
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      const oomHint =
        signal === "SIGABRT" || signal === "SIGKILL"
          ? " (likely resource-limit termination — see docs/ADR-011-plugin-platform.md)"
          : "";
      settle(
        reject,
        new PluginError(
          `plugin "${pluginId}" sandbox process exited abnormally (${detail})${oomHint}`,
          {
            code: "PROCESS_CRASHED",
            cause: stderrBuf,
          }
        )
      );
    });
  });
}

module.exports = { runPlugin, PluginError, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OLD_SPACE_MB };
