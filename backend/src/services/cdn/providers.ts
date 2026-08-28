/**
 * src/services/cdn/providers.js
 * Per-vendor CDN purge adapters (#91).
 *
 * Each provider exposes the same shape: `{ name, purge({ urls, tags }) }`.
 * cdnService.js orchestrates an ordered list of these with failover, so no
 * caller ever depends on a specific vendor's API directly — that's what
 * keeps this a multi-CDN strategy rather than single-vendor lock-in.
 */
"use strict";

const axios = require("axios");

/**
 * Cloudflare purge_cache adapter.
 * https://developers.cloudflare.com/api/operations/zone-purge
 *
 * @param {{ zoneId: string, apiToken: string, axiosInstance?: import('axios').AxiosInstance }} config
 */
function createCloudflareProvider({ zoneId, apiToken, axiosInstance = axios }: any) {
  if (!zoneId || !apiToken) {
    throw new Error("createCloudflareProvider requires zoneId and apiToken");
  }
  return {
    name: "cloudflare",
    async purge({ urls = [], tags = [] }) {
      const body: any = {};
      if (urls.length) body.files = urls;
      // Cache Tags require an Enterprise plan; harmless no-op on lower plans
      // as long as `files` is also present, so we always send both.
      if (tags.length) body.tags = tags;

      const response = await axiosInstance.post(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        body,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.data?.success) {
        throw new Error(
          `Cloudflare purge failed: ${JSON.stringify(response.data?.errors || response.data)}`
        );
      }
      return response.data;
    },
  };
}

/**
 * Fastly purge adapter — purges by surrogate key (preferred, since it also
 * covers list views that embed the resource) and falls back to per-URL
 * PURGE requests for anything without a surrogate key.
 * https://www.fastly.com/documentation/reference/api/purging/
 *
 * @param {{ serviceId: string, apiToken: string, axiosInstance?: import('axios').AxiosInstance }} config
 */
function createFastlyProvider({ serviceId, apiToken, axiosInstance = axios }: any) {
  if (!serviceId || !apiToken) {
    throw new Error("createFastlyProvider requires serviceId and apiToken");
  }
  return {
    name: "fastly",
    async purge({ urls = [], tags = [] }) {
      if (!urls.length && !tags.length) {
        throw new Error("Fastly purge requires at least one URL or surrogate key");
      }

      const results = [];
      for (const tag of tags) {
        const response = await axiosInstance.post(
          `https://api.fastly.com/service/${serviceId}/purge/${encodeURIComponent(tag)}`,
          null,
          { headers: { "Fastly-Key": apiToken, Accept: "application/json" } }
        );
        results.push(response.data);
      }
      for (const url of urls) {
        const response = await axiosInstance.request({
          method: "PURGE",
          url,
          headers: { "Fastly-Key": apiToken },
        });
        results.push(response.data);
      }
      return { results };
    },
  };
}

/**
 * In-memory provider used in dev/test/CI when no real CDN credentials are
 * configured, so the invalidation pipeline stays exercisable end-to-end
 * without live vendor accounts.
 *
 * @param {string} [name]
 */
function createMockProvider(name = "mock") {
  const purged: any[] = [];
  return {
    name,
    purged, // exposed for assertions in tests
    async purge({ urls = [], tags = [] }) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      purged.push({ urls, tags, at: Date.now() });
      return { success: true, mocked: true };
    },
  };
}

/**
 * Build the ordered provider chain from environment configuration.
 * Order is controlled by CDN_PROVIDER_ORDER (comma-separated, e.g.
 * "cloudflare,fastly"); a provider is only included if its credentials are
 * present. Falls back to a mock provider so the app still boots (and the
 * invalidation pipeline still runs) in environments with no CDN configured.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
function createProvidersFromEnv(env = process.env) {
  const order = (env.CDN_PROVIDER_ORDER || "cloudflare,fastly")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const providers = [];
  for (const name of order) {
    if (name === "cloudflare" && env.CLOUDFLARE_ZONE_ID && env.CLOUDFLARE_API_TOKEN) {
      providers.push(
        createCloudflareProvider({
          zoneId: env.CLOUDFLARE_ZONE_ID,
          apiToken: env.CLOUDFLARE_API_TOKEN,
        })
      );
    } else if (name === "fastly" && env.FASTLY_SERVICE_ID && env.FASTLY_API_TOKEN) {
      providers.push(
        createFastlyProvider({
          serviceId: env.FASTLY_SERVICE_ID,
          apiToken: env.FASTLY_API_TOKEN,
        })
      );
    }
  }

  if (!providers.length) {
    providers.push(createMockProvider("mock-primary"));
  }
  return providers;
}

module.exports = {
  createCloudflareProvider,
  createFastlyProvider,
  createMockProvider,
  createProvidersFromEnv,
};

export {};
