/**
 * src/middleware/edgeCacheControl.test.js
 * Cache-Control + Surrogate-Key/Cache-Tag headers per content-type tier (#91).
 */
"use strict";

const express = require("express");
const request = require("supertest");
const { edgeCacheControl, CONTENT_TYPES } = require("./edgeCacheControl");

describe("edgeCacheControl", () => {
  test("semi-dynamic responses carry a short s-maxage and static surrogate keys", async () => {
    const app = express();
    app.get(
      "/jobs",
      edgeCacheControl(CONTENT_TYPES.SEMI_DYNAMIC, { surrogateKeys: ["jobs-list"] }),
      (req: any, res: any) => res.json({ ok: true })
    );

    const res = await request(app).get("/jobs");

    expect(res.headers["cache-control"]).toContain("s-maxage=30");
    expect(res.headers["surrogate-key"]).toBe("jobs-list");
    expect(res.headers["cache-tag"]).toBe("jobs-list");
  });

  test("supports request-derived surrogate keys (e.g. per-job tags)", async () => {
    const app = express();
    app.get(
      "/jobs/:id",
      edgeCacheControl(CONTENT_TYPES.SEMI_DYNAMIC, {
        surrogateKeys: (req: any) => [`job-${req.params.id}`, "jobs-list"],
      }),
      (req: any, res: any) => res.json({ ok: true })
    );

    const res = await request(app).get("/jobs/42");

    expect(res.headers["surrogate-key"]).toBe("job-42 jobs-list");
  });

  test("personalized responses are never cached at the edge", async () => {
    const app = express();
    app.get(
      "/dashboard",
      edgeCacheControl(CONTENT_TYPES.DYNAMIC_PERSONALIZED),
      (req: any, res: any) => res.json({ ok: true })
    );

    const res = await request(app).get("/dashboard");

    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["surrogate-key"]).toBeUndefined();
  });
});

export {};
