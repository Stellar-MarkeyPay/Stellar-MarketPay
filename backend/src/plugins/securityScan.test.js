"use strict";

const { scanSource } = require("./securityScan");

describe("plugin security scan", () => {
  test("passes clean plugin source", () => {
    const result = scanSource(`
      globalThis.plugin = {
        async onEvent(payload) {
          return marketpay.call("jobs.get", { jobId: payload.jobId });
        }
      };
    `);
    expect(result).toEqual({ passed: true, findings: [] });
  });

  test("NEGATIVE: flags a require of a forbidden Node builtin", () => {
    const result = scanSource(`const fs = require("fs"); fs.readFileSync("/etc/passwd");`);
    expect(result.passed).toBe(false);
    expect(result.findings[0].kind).toBe("require");
  });

  test("NEGATIVE: flags child_process", () => {
    const result = scanSource(`const cp = require("child_process");`);
    expect(result.passed).toBe(false);
  });

  test("NEGATIVE: flags eval", () => {
    const result = scanSource(`eval("1+1");`);
    expect(result.passed).toBe(false);
    expect(result.findings[0].kind).toBe("eval");
  });

  test("NEGATIVE: flags the Function constructor", () => {
    const result = scanSource(`const f = new Function("return 1");`);
    expect(result.passed).toBe(false);
    expect(result.findings[0].kind).toBe("function-constructor");
  });

  test("NEGATIVE: flags __proto__ manipulation", () => {
    const result = scanSource(`const x = {}; x.__proto__.polluted = true;`);
    expect(result.passed).toBe(false);
  });

  test("NEGATIVE: flags a syntax error", () => {
    const result = scanSource(`this is not { valid js`);
    expect(result.passed).toBe(false);
    expect(result.findings[0].kind).toBe("syntax-error");
  });

  test("NEGATIVE: flags an import of an unrecognized module", () => {
    const result = scanSource(`const evil = require("some-random-npm-package");`);
    expect(result.passed).toBe(false);
    expect(result.findings[0].kind).toBe("unrecognized-import");
  });

  test("NEGATIVE: rejects oversized source", () => {
    const huge = "// " + "x".repeat(600000);
    const result = scanSource(huge);
    expect(result.passed).toBe(false);
    expect(result.findings[0].kind).toBe("too-large");
  });
});
