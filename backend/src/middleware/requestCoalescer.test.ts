/**
 * src/middleware/requestCoalescer.test.js
 * Cache-stampede protection: a burst of concurrent requests for the same key
 * must collapse into a single origin call (#91).
 */
"use strict";

const { coalesce, _inFlightCount } = require("./requestCoalescer");

function deferred() {
  let resolve: (value?: any) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve: resolve! };
}

describe("requestCoalescer", () => {
  test("a simulated post-invalidation traffic spike (50 concurrent misses) hits the origin exactly once", async () => {
    let originCalls = 0;
    const origin = async () => {
      originCalls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { data: "job-42" };
    };

    const results = await Promise.all(
      Array.from({ length: 50 }, () => coalesce("job:detail:42", origin))
    );

    expect(originCalls).toBe(1);
    expect(results).toHaveLength(50);
    for (const r of results) expect(r).toEqual({ data: "job-42" });
  });

  test("different keys are not coalesced together", async () => {
    let originCalls = 0;
    const origin = async () => {
      originCalls += 1;
      return "ok";
    };

    await Promise.all([coalesce("key-a", origin), coalesce("key-b", origin)]);

    expect(originCalls).toBe(2);
  });

  test("a request after the in-flight promise settles triggers a fresh origin call", async () => {
    let originCalls = 0;
    const origin = async () => {
      originCalls += 1;
      return originCalls;
    };

    const first = await coalesce("job:detail:42", origin);
    const second = await coalesce("job:detail:42", origin);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(originCalls).toBe(2);
  });

  test("removes the key from the in-flight map once settled, including on rejection", async () => {
    const d = deferred();
    const pending = coalesce("job:detail:99", () => d.promise);
    expect(_inFlightCount()).toBe(1);

    d.resolve("done");
    await pending;
    expect(_inFlightCount()).toBe(0);

    const failing = coalesce("job:detail:100", () => Promise.reject(new Error("boom")));
    await expect(failing).rejects.toThrow("boom");
    expect(_inFlightCount()).toBe(0);
  });

  test("concurrent callers waiting on a failing origin all receive the same rejection", async () => {
    const origin = () => Promise.reject(new Error("origin down"));

    const results = await Promise.allSettled([
      coalesce("job:detail:7", origin),
      coalesce("job:detail:7", origin),
      coalesce("job:detail:7", origin),
    ]);

    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason.message).toBe("origin down");
    }
  });
});

export {};
