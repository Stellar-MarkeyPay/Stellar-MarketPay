/**
 * src/services/cdn/providers.test.js
 * Per-vendor purge adapters + env-driven provider chain construction (#91).
 */
"use strict";

const {
  createCloudflareProvider,
  createFastlyProvider,
  createMockProvider,
  createProvidersFromEnv,
} = require("./providers");

describe("createCloudflareProvider", () => {
  test("sends files + tags and resolves on success:true", async () => {
    const post = jest.fn().mockResolvedValue({ data: { success: true } });
    const provider = createCloudflareProvider({
      zoneId: "zone1",
      apiToken: "tok",
      axiosInstance: { post },
    });

    await provider.purge({ urls: ["https://app.example/jobs/1"], tags: ["job-1"] });

    expect(post).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone1/purge_cache",
      { files: ["https://app.example/jobs/1"], tags: ["job-1"] },
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok" }) })
    );
  });

  test("throws when Cloudflare reports success:false", async () => {
    const post = jest.fn().mockResolvedValue({ data: { success: false, errors: ["bad zone"] } });
    const provider = createCloudflareProvider({
      zoneId: "zone1",
      apiToken: "tok",
      axiosInstance: { post },
    });

    await expect(provider.purge({ urls: ["https://app.example/jobs/1"] })).rejects.toThrow(
      /Cloudflare purge failed/
    );
  });

  test("requires zoneId and apiToken", () => {
    expect(() => createCloudflareProvider({})).toThrow(/requires zoneId and apiToken/);
  });
});

describe("createFastlyProvider", () => {
  test("purges by surrogate key", async () => {
    const post = jest.fn().mockResolvedValue({ data: { status: "ok" } });
    const provider = createFastlyProvider({
      serviceId: "svc1",
      apiToken: "tok",
      axiosInstance: { post, request: jest.fn() },
    });

    await provider.purge({ tags: ["job-1"] });

    expect(post).toHaveBeenCalledWith(
      "https://api.fastly.com/service/svc1/purge/job-1",
      null,
      expect.objectContaining({ headers: expect.objectContaining({ "Fastly-Key": "tok" }) })
    );
  });

  test("falls back to per-URL PURGE when no surrogate key is given", async () => {
    const request = jest.fn().mockResolvedValue({ data: { status: "ok" } });
    const provider = createFastlyProvider({
      serviceId: "svc1",
      apiToken: "tok",
      axiosInstance: { post: jest.fn(), request },
    });

    await provider.purge({ urls: ["https://app.example/jobs/1"] });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PURGE", url: "https://app.example/jobs/1" })
    );
  });

  test("rejects an unscoped purge", async () => {
    const provider = createFastlyProvider({
      serviceId: "svc1",
      apiToken: "tok",
      axiosInstance: { post: jest.fn(), request: jest.fn() },
    });
    await expect(provider.purge({})).rejects.toThrow(/at least one URL or surrogate key/);
  });
});

describe("createMockProvider", () => {
  test("records purged targets for assertions", async () => {
    const provider = createMockProvider("mock-a");
    await provider.purge({ urls: ["u1"], tags: ["t1"] });
    expect(provider.purged).toEqual([{ urls: ["u1"], tags: ["t1"], at: expect.any(Number) }]);
  });
});

describe("createProvidersFromEnv", () => {
  test("falls back to a mock provider when no CDN credentials are configured", () => {
    const providers = createProvidersFromEnv({});
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("mock-primary");
  });

  test("builds cloudflare then fastly in the configured order when both are credentialed", () => {
    const providers = createProvidersFromEnv({
      CDN_PROVIDER_ORDER: "cloudflare,fastly",
      CLOUDFLARE_ZONE_ID: "z",
      CLOUDFLARE_API_TOKEN: "t",
      FASTLY_SERVICE_ID: "s",
      FASTLY_API_TOKEN: "t2",
    });

    expect(providers.map((p: any) => p.name)).toEqual(["cloudflare", "fastly"]);
  });

  test("skips a vendor whose credentials are missing", () => {
    const providers = createProvidersFromEnv({
      CDN_PROVIDER_ORDER: "cloudflare,fastly",
      FASTLY_SERVICE_ID: "s",
      FASTLY_API_TOKEN: "t2",
    });

    expect(providers.map((p: any) => p.name)).toEqual(["fastly"]);
  });

  test("honors a reversed CDN_PROVIDER_ORDER", () => {
    const providers = createProvidersFromEnv({
      CDN_PROVIDER_ORDER: "fastly,cloudflare",
      CLOUDFLARE_ZONE_ID: "z",
      CLOUDFLARE_API_TOKEN: "t",
      FASTLY_SERVICE_ID: "s",
      FASTLY_API_TOKEN: "t2",
    });

    expect(providers.map((p: any) => p.name)).toEqual(["fastly", "cloudflare"]);
  });
});

export {};
