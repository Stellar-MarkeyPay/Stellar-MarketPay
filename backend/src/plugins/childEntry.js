/**
 * src/plugins/childEntry.js
 *
 * Runs *inside* the sandboxed child process (see sandbox.js's module doc
 * for why this is a forked OS process, not a `worker_threads` thread, and
 * what that decision cost us to discover). This file itself has full Node
 * access — it is trusted bootstrap code, written by us, never by a plugin
 * author. Its only job is to build a stripped `vm` context that has none of
 * that access, compile the plugin's source inside it, and relay exactly one
 * capability back out: `marketpay.call(method, params)`.
 *
 * Nothing here ever calls `require()` on behalf of plugin source, exposes
 * `process`, `require`, `module`, `global`, to the vm context, or lets the
 * plugin's code run anywhere but inside that context.
 */
"use strict";

const vm = require("node:vm");

// Plugin source can be up to securityScan.js's MAX_SOURCE_BYTES (512KB),
// well past what fits in an environment variable or argv, so init data
// arrives as the first IPC message rather than at spawn time.
let nextCallId = 1;
const pendingBrokerCalls = new Map();

process.on("message", (msg) => {
  if (msg?.type === "init") {
    run(msg.source, msg.hookName, msg.payload);
    return;
  }
  if (msg?.type === "broker-response") {
    const pending = pendingBrokerCalls.get(msg.callId);
    if (!pending) return;
    pendingBrokerCalls.delete(msg.callId);
    if (msg.ok) pending.resolve(msg.value);
    else pending.reject(new Error(msg.error || "broker call failed"));
  }
});

/** The one bridge out of the sandbox. Every call is relayed to the parent,
 *  which checks it against the plugin's granted permissions (broker.js)
 *  before doing anything — this code has no opinion on what is allowed. */
function brokerCall(method, params) {
  return new Promise((resolve, reject) => {
    const callId = nextCallId++;
    pendingBrokerCalls.set(callId, { resolve, reject });
    process.send({ type: "broker", callId, method, params });
  });
}

/** A console that reaches the host's logs (capped, prefixed) without
 *  handing the plugin a real stdout/stderr stream or any Node stream API. */
function sandboxedConsole() {
  const relay =
    (level) =>
    (...args) => {
      try {
        const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
        process.send({ type: "log", level, line: String(line).slice(0, 2000) });
      } catch {
        // A plugin that can't even be console.log'd safely just loses the log line.
      }
    };
  return { log: relay("log"), warn: relay("warn"), error: relay("error"), info: relay("info") };
}

function buildSandboxGlobal() {
  const sandbox = {
    marketpay: Object.freeze({
      call: (method, params) => brokerCall(method, params),
    }),
    console: sandboxedConsole(),
    // Deliberately no: require, module, exports, process, global,
    // Buffer, __dirname, __filename, setTimeout/setInterval (a plugin
    // call is bounded by the parent's own timeout; giving it timers would
    // let it outlive that in spirit if not in fact), fetch,
    // XMLHttpRequest, WebSocket. Standard JS globals (Object, Array,
    // Promise, JSON, Math, Date, ...) come for free with vm.createContext
    // and are intentionally left in place — removing them would make the
    // sandbox unusable for reasons unrelated to safety.
  };
  // `codeGeneration: { strings: false }` blocks eval()/Function()/setTimeout(str)
  // *inside this context*, including the classic
  // `someInjectedObject.constructor.constructor("...")()` bypass — V8 ties
  // the restriction to the executing context, not to which realm the
  // constructor reference originated from. It does NOT, by itself, stop a
  // plugin from walking that same constructor chain to reach the *outer*
  // realm's `process` object and calling `.mainModule.require(...)`
  // directly (no new code-from-string involved in that step) — that
  // residual gap is why sandbox.js also runs this process under Node's
  // `--permission` model (blocks fs/child_process/worker_threads even for
  // code that reaches them this way) and documents the one gap neither
  // closes: raw network sockets are not yet gateable by Node's Permission
  // Model. See docs/ADR-011-plugin-platform.md, "Sandbox limitations."
  return vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
}

async function run(source, hookName, payload) {
  try {
    const context = buildSandboxGlobal();
    // Wrap the plugin source as a CommonJS-shaped module without actually
    // providing `module`/`exports`/`require`: the plugin must assign its
    // handler to the sandbox global `plugin`, matching the SDK's documented
    // shape (see sdk/index.d.ts and templates/workflow-hook).
    const wrapped = `(function () { ${source}\n return typeof plugin !== "undefined" ? plugin : null; })()`;
    const script = new vm.Script(wrapped, { filename: "index.js" });
    const pluginExport = script.runInContext(context, { timeout: 4500 });

    if (!pluginExport || typeof pluginExport.onEvent !== "function") {
      throw new Error(
        "plugin must define a global `plugin` object with an `onEvent(payload)` function"
      );
    }

    const result = await pluginExport.onEvent(payload, { hook: hookName });
    // process.send() is asynchronous — calling process.exit() right after
    // it can terminate the process before a large message finishes writing
    // to the IPC pipe, silently dropping it. Only exit once send's callback
    // confirms the message was handed off.
    process.send({ type: "result", value: result === undefined ? null : result }, () =>
      process.exit(0)
    );
  } catch (err) {
    process.send(
      {
        type: "error",
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? String(err.stack).slice(0, 4000) : undefined,
      },
      () => process.exit(0)
    );
  }
}

// Signal readiness; sandbox.js waits for this before sending `init` so a
// broker call/init race can never lose a message.
process.send({ type: "ready" });
