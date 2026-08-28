/**
 * src/services/cdn/cacheStrategy.js
 * Cache-key / TTL strategy for the multi-CDN edge layer (#91).
 *
 * Three content-type tiers, each with a distinct caching posture:
 *   - STATIC_ASSET          long-TTL, content-hashed filenames (Next.js build output).
 *   - SEMI_DYNAMIC          job listings / job detail / profile pages — short edge TTL
 *                           plus event-driven purge on the on-chain events that make
 *                           them stale (job closed, escrow released, dispute raised).
 *   - DYNAMIC_PERSONALIZED  per-viewer content (dashboard, spending analytics,
 *                           notifications) — never cached at the CDN edge.
 *
 * See docs/CDN_STRATEGY.md for the full design and the failover/SLA writeup.
 */
"use strict";

const CONTENT_TYPES = {
  STATIC_ASSET: "static_asset",
  SEMI_DYNAMIC: "semi_dynamic",
  DYNAMIC_PERSONALIZED: "dynamic_personalized",
};

// TTLs in seconds. These back the `Cache-Control` values below — kept as a
// separate map so tests/docs can assert on the numbers without parsing headers.
const TTL_SECONDS = {
  [CONTENT_TYPES.STATIC_ASSET]: 31536000, // 1 year — safe because filenames are content-hashed
  [CONTENT_TYPES.SEMI_DYNAMIC]: 30, // short edge TTL; freshness is really enforced by event purge
  [CONTENT_TYPES.DYNAMIC_PERSONALIZED]: 0,
};

/**
 * Build the `Cache-Control` header value for a content-type tier.
 *
 * @param {string} type one of CONTENT_TYPES
 * @returns {string}
 */
function cacheControlFor(type: any) {
  switch (type) {
    case CONTENT_TYPES.STATIC_ASSET:
      return `public, max-age=${TTL_SECONDS[CONTENT_TYPES.STATIC_ASSET]}, immutable`;
    case CONTENT_TYPES.SEMI_DYNAMIC:
      // max-age=0 so browsers revalidate; s-maxage governs the CDN edge.
      // stale-while-revalidate lets the edge serve the last known-good copy
      // for up to 60s while it refetches in the background (coalesced —
      // see requestCoalescer.js) instead of every client blocking on a
      // cold fetch right after a purge.
      return `public, max-age=0, s-maxage=${TTL_SECONDS[CONTENT_TYPES.SEMI_DYNAMIC]}, stale-while-revalidate=60, stale-if-error=300`;
    case CONTENT_TYPES.DYNAMIC_PERSONALIZED:
      return "private, no-store";
    default:
      throw new Error(`Unknown content type: ${type}`);
  }
}

/**
 * Surrogate/cache tag keys for a job's URLs (detail page + the list views
 * that embed it). Purging by tag lets the CDN drop exactly these entries
 * instead of a full-cache flush.
 *
 * @param {string} jobId
 * @returns {string[]}
 */
function surrogateKeysForJob(jobId: any) {
  return [`job-${jobId}`, "jobs-list"];
}

/**
 * Surrogate/cache tag key for a profile page.
 *
 * @param {string} publicKey
 * @returns {string[]}
 */
function surrogateKeysForProfile(publicKey: any) {
  return [`profile-${publicKey}`];
}

module.exports = {
  CONTENT_TYPES,
  TTL_SECONDS,
  cacheControlFor,
  surrogateKeysForJob,
  surrogateKeysForProfile,
};

export {};
