/**
 * src/services/cdn/cacheStrategy.test.js
 * Cache-key/TTL strategy per content-type tier (#91).
 */
"use strict";

const {
  CONTENT_TYPES,
  TTL_SECONDS,
  cacheControlFor,
  surrogateKeysForJob,
  surrogateKeysForProfile,
} = require("./cacheStrategy");

describe("cacheStrategy", () => {
  test("static assets get a long, immutable TTL", () => {
    expect(cacheControlFor(CONTENT_TYPES.STATIC_ASSET)).toBe(
      `public, max-age=${TTL_SECONDS[CONTENT_TYPES.STATIC_ASSET]}, immutable`
    );
    expect(TTL_SECONDS[CONTENT_TYPES.STATIC_ASSET]).toBeGreaterThan(
      TTL_SECONDS[CONTENT_TYPES.SEMI_DYNAMIC]
    );
  });

  test("semi-dynamic content gets a short edge TTL with stale-while-revalidate", () => {
    const header = cacheControlFor(CONTENT_TYPES.SEMI_DYNAMIC);
    expect(header).toContain(`s-maxage=${TTL_SECONDS[CONTENT_TYPES.SEMI_DYNAMIC]}`);
    expect(header).toContain("stale-while-revalidate");
  });

  test("personalized content is never cached at the edge", () => {
    expect(cacheControlFor(CONTENT_TYPES.DYNAMIC_PERSONALIZED)).toBe("private, no-store");
  });

  test("throws for an unknown content type", () => {
    expect(() => cacheControlFor("unknown")).toThrow(/Unknown content type/);
  });

  test("job surrogate keys cover the detail page and the list view", () => {
    expect(surrogateKeysForJob("job-1")).toEqual(["job-job-1", "jobs-list"]);
  });

  test("profile surrogate key is scoped to just that profile", () => {
    expect(surrogateKeysForProfile("GADDR")).toEqual(["profile-GADDR"]);
  });
});
