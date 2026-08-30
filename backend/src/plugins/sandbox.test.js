"use strict";

/**
 * src/plugins/sandbox.test.js
 *
 * Exercises the real sandbox (genuine child processes, no mocking of
 * child_process or vm) — these tests are slower than a typical unit test
 * because each one spawns and tears down at least one real OS process, but
 * that is the point: this is what the sandbox actually is, and mocking it
 * away would test nothing about its safety properties.
 */

const { runPlugin } = require("./sandbox");

// Comfortably above the largest inner timeoutMs used below (20000ms, in the
// memory-bomb test) so jest's own per-test timeout never races that test's
// own timeout/rejection handling under CI load.
jest.setTimeout(30000);

describe("plugin sandbox — happy path", () => {
  test("runs a plugin and returns its result", async () => {
    const source = `
      globalThis.plugin = {
        async onEvent(payload, ctx) {
          return { doubled: payload.n * 2, hook: ctx.hook };
        }
      };
    `;
    const result = await runPlugin({
      source,
      hookName: "job.created",
      payload: { n: 21 },
      onBrokerCall: async () => {
        throw new Error("no broker calls expected in this test");
      },
    });
    expect(result).toEqual({ doubled: 42, hook: "job.created" });
  });

  test("mediates a marketpay.call through the supplied broker handler", async () => {
    const source = `
      globalThis.plugin = {
        async onEvent(payload) {
          return marketpay.call("jobs.get", { jobId: payload.jobId });
        }
      };
    `;
    const onBrokerCall = jest.fn(async (method, params) => {
      expect(method).toBe("jobs.get");
      expect(params).toEqual({ jobId: "job-1" });
      return { id: "job-1", title: "Fake job" };
    });
    const result = await runPlugin({
      source,
      hookName: "t",
      payload: { jobId: "job-1" },
      onBrokerCall,
    });
    expect(result).toEqual({ id: "job-1", title: "Fake job" });
    expect(onBrokerCall).toHaveBeenCalledTimes(1);
  });
});

describe("plugin sandbox — no ambient Node access", () => {
  test("require, process, fs are not available inside the sandbox", async () => {
    const source = `
      globalThis.plugin = {
        async onEvent() {
          return {
            hasRequire: typeof require !== "undefined",
            hasProcess: typeof process !== "undefined",
            hasGlobal: typeof global !== "undefined",
            hasBuffer: typeof Buffer !== "undefined",
          };
        }
      };
    `;
    const result = await runPlugin({
      source,
      hookName: "t",
      payload: {},
      onBrokerCall: async () => {},
    });
    expect(result).toEqual({
      hasRequire: false,
      hasProcess: false,
      hasGlobal: false,
      hasBuffer: false,
    });
  });

  test("eval and the Function constructor are blocked inside the sandbox", async () => {
    const source = `
      globalThis.plugin = {
        async onEvent() {
          const results = {};
          try { eval("1+1"); results.eval = "allowed"; } catch (e) { results.eval = "blocked"; }
          try { new Function("return 1")(); results.fn = "allowed"; } catch (e) { results.fn = "blocked"; }
          return results;
        }
      };
    `;
    const result = await runPlugin({
      source,
      hookName: "t",
      payload: {},
      onBrokerCall: async () => {},
    });
    expect(result).toEqual({ eval: "blocked", fn: "blocked" });
  });

  test("NEGATIVE: the constructor-chain escape cannot reach the filesystem", async () => {
    const source = `
      globalThis.plugin = {
        async onEvent() {
          try {
            const req = marketpay.constructor.constructor("return process.mainModule.require")();
            const fs = req("fs");
            fs.readFileSync("/etc/passwd", "utf8");
            return { escaped: true };
          } catch (e) {
            return { escaped: false, error: e.message };
          }
        }
      };
    `;
    const result = await runPlugin({
      source,
      hookName: "t",
      payload: {},
      onBrokerCall: async () => {},
    });
    expect(result.escaped).toBe(false);
    expect(result.error).toMatch(/restricted/i);
  });
});

describe("plugin sandbox — containment", () => {
  test("a plugin that runs forever is terminated at the timeout and reported, not left hanging", async () => {
    const source = `globalThis.plugin = { async onEvent() { while (true) {} } };`;
    await expect(
      runPlugin({
        source,
        hookName: "t",
        payload: {},
        timeoutMs: 500,
        onBrokerCall: async () => {},
      })
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  test("a plugin that throws is reported as a contained PluginError, not an uncaught exception", async () => {
    const source = `globalThis.plugin = { async onEvent() { throw new Error("deliberate failure"); } };`;
    await expect(
      runPlugin({ source, hookName: "t", payload: {}, onBrokerCall: async () => {} })
    ).rejects.toMatchObject({ code: "PLUGIN_THREW" });
  });

  test("CRITICAL: a plugin that exhausts memory in one huge allocation cannot crash the host process", async () => {
    // This is the failure mode a worker_threads-based sandbox does not
    // contain (see sandbox.js's module doc comment) — a single allocation
    // that overshoots the heap limit can hit V8's fatal OOM path, which
    // aborts the entire process for a same-process thread. Run under a
    // real child process, it must instead surface as a normal rejected
    // promise, and this test process (standing in for the host) must still
    // be alive to report it.
    const source = `
      globalThis.plugin = {
        async onEvent() {
          const arrs = [];
          while (true) { arrs.push(new Array(1e7).fill("x")); }
        }
      };
    `;
    // timeoutMs is generous (well beyond how long the OOM itself takes
    // locally) because this test process competes with a full CI test
    // suite for CPU/memory — under contention, the child's V8 fatal-OOM
    // abort can take longer wall-clock time to reach the parent than it
    // does on an idle machine, and if the outer timeout wins that race the
    // rejection arrives as TIMEOUT instead of PROCESS_CRASHED. Both codes
    // are accepted below for exactly that reason: either one means the
    // sandbox caught and reported the failure without the host going down,
    // which is the actual property this test exists to verify — which
    // watchdog got there first is an implementation detail, not the
    // guarantee.
    let caught;
    try {
      await runPlugin({
        source,
        hookName: "t",
        payload: {},
        timeoutMs: 20000,
        maxOldSpaceMb: 32,
        onBrokerCall: async () => {},
      });
      throw new Error("expected runPlugin to reject");
    } catch (err) {
      caught = err;
    }
    expect(["PROCESS_CRASHED", "TIMEOUT"]).toContain(caught.code);
    // Reaching this line at all is the assertion that matters most: the
    // test runner process was not taken down by the plugin's OOM.
  });

  test("an invalid plugin (no plugin.onEvent) is reported, not silently ignored", async () => {
    const source = `globalThis.notAPlugin = 1;`;
    await expect(
      runPlugin({ source, hookName: "t", payload: {}, onBrokerCall: async () => {} })
    ).rejects.toMatchObject({ code: "PLUGIN_THREW" });
  });

  test("an oversized result is rejected rather than forwarded", async () => {
    const source = `
      globalThis.plugin = {
        async onEvent() {
          return { big: "x".repeat(300000) };
        }
      };
    `;
    await expect(
      runPlugin({ source, hookName: "t", payload: {}, onBrokerCall: async () => {} })
    ).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
  });
});
