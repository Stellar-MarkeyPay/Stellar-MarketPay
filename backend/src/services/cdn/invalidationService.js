/**
 * src/services/cdn/invalidationService.js
 * Event-driven CDN invalidation pipeline (#91).
 *
 * Wired into indexerService.processEvent(): whenever a contract event
 * changes a job's public state (created, closed, escrow released, dispute
 * raised, milestone released) this fires a *targeted* purge for just that
 * job's detail page, the job-list surrogate group, and the client's /
 * freelancer's profile pages — never a full-cache flush.
 *
 * It also busts the origin's own Redis cache (cacheService) for the same
 * keys, since the CDN edge is only half of the staleness problem — the
 * origin's 30s/300s TTLs would otherwise keep serving stale data to
 * cache-miss traffic for the rest of their window.
 *
 * Exposed as an EventEmitter ("invalidation:completed" / "invalidation:failed")
 * so other consumers (e.g. a metrics/alerting sidecar, or an external
 * pub-sub relay) can subscribe without coupling to indexerService directly.
 * routes/cdn.js's POST /api/cdn/webhook drives the same handleContractEvent()
 * entrypoint for deployments that run event ingestion as a separate worker.
 */
"use strict";

const { EventEmitter } = require("events");
const promClient = require("prom-client");
const pool = require("../../db/pool");
const cache = require("../cacheService");
const { surrogateKeysForJob, surrogateKeysForProfile } = require("./cacheStrategy");

// Contract event types (see indexerService.js's typeMap) that change a job's
// publicly-visible state and therefore require a purge. Events that don't
// affect cached views (e.g. message_sent) are intentionally omitted.
const INVALIDATING_EVENTS = new Set([
  "escrow_created",
  "work_started",
  "escrow_released",
  "escrow_refunded",
  "dispute_opened",
  "milestone_released",
]);

class CdnInvalidationService extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./cdnService')} opts.cdnService
   * @param {import('prom-client').Registry} [opts.metricsRegistry]
   * @param {string} [opts.publicBaseUrl] origin the CDN fronts, e.g. https://app.example.com
   */
  constructor({ cdnService, metricsRegistry = null, publicBaseUrl } = {}) {
    super();
    if (!cdnService) throw new Error("CdnInvalidationService requires a cdnService");
    this.cdnService = cdnService;
    this.publicBaseUrl =
      publicBaseUrl || process.env.PUBLIC_BASE_URL || "https://app.stellar-marketpay.example";
    this._registerMetrics(metricsRegistry);
  }

  _registerMetrics(registry) {
    if (!registry) {
      this.purgeLatency = null;
      this.purgeFailures = null;
      return;
    }
    this.purgeLatency = new promClient.Histogram({
      name: "marketpay_cdn_invalidation_latency_seconds",
      help: "Time from on-chain event to completed targeted CDN purge — SLA is < 5s",
      labelNames: ["event_type"],
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [registry],
    });
    this.purgeFailures = new promClient.Counter({
      name: "marketpay_cdn_invalidation_failures_total",
      help: "Contract events for which every configured CDN provider failed to purge",
      labelNames: ["event_type"],
      registers: [registry],
    });
  }

  /**
   * @param {string} jobId
   * @returns {Promise<{client_address: string, freelancer_address: string|null}|null>}
   */
  async getJobParties(jobId) {
    try {
      const { rows } = await pool.query(
        "SELECT client_address, freelancer_address FROM jobs WHERE id = $1",
        [jobId]
      );
      return rows[0] || null;
    } catch {
      // Best-effort — the job/profile purge still proceeds without party-scoped URLs.
      return null;
    }
  }

  /**
   * @param {string} jobId
   * @param {{client_address?: string, freelancer_address?: string}|null} parties
   */
  buildTargets(jobId, parties) {
    const urls = [`${this.publicBaseUrl}/jobs/${jobId}`];
    const tags = surrogateKeysForJob(jobId);

    if (parties?.client_address) {
      urls.push(`${this.publicBaseUrl}/freelancers/${parties.client_address}`);
      tags.push(...surrogateKeysForProfile(parties.client_address));
    }
    if (parties?.freelancer_address) {
      urls.push(`${this.publicBaseUrl}/freelancers/${parties.freelancer_address}`);
      tags.push(...surrogateKeysForProfile(parties.freelancer_address));
    }

    return { urls, tags };
  }

  /**
   * Entry point called for every relevant contract event.
   *
   * @param {string} eventType one of INVALIDATING_EVENTS (others are ignored)
   * @param {string} jobId
   * @param {{receivedAt?: number}} [opts] receivedAt defaults to now; pass the
   *   on-chain event timestamp when available so the SLA metric reflects
   *   ledger-close-to-purge latency rather than just indexer-to-purge latency.
   */
  async handleContractEvent(eventType, jobId, { receivedAt = Date.now() } = {}) {
    if (!jobId || !INVALIDATING_EVENTS.has(eventType)) return null;

    const parties = await this.getJobParties(jobId);
    const { urls, tags } = this.buildTargets(jobId, parties);

    // Origin-side (Redis) cache: bust the job-list cache and both profile
    // entries so cache-miss requests during CDN propagation still get fresh
    // data instead of stale origin responses.
    await cache.delPattern("jobs:list:*");
    await cache.del(cache.jobDetailKey(jobId));
    if (parties?.client_address) await cache.del(cache.profileKey(parties.client_address));
    if (parties?.freelancer_address) await cache.del(cache.profileKey(parties.freelancer_address));

    try {
      const result = await this.cdnService.purge({ urls, tags });
      const latencySeconds = (Date.now() - receivedAt) / 1000;
      this.purgeLatency?.observe({ event_type: eventType }, latencySeconds);
      this.emit("invalidation:completed", {
        jobId,
        eventType,
        urls,
        tags,
        latencySeconds,
        provider: result.provider,
      });
      return { urls, tags, latencySeconds, ...result };
    } catch (err) {
      const latencySeconds = (Date.now() - receivedAt) / 1000;
      this.purgeLatency?.observe({ event_type: eventType }, latencySeconds);
      this.purgeFailures?.inc({ event_type: eventType });
      this.emit("invalidation:failed", {
        jobId,
        eventType,
        urls,
        tags,
        latencySeconds,
        error: err.message,
      });
      throw err;
    }
  }
}

module.exports = CdnInvalidationService;
module.exports.INVALIDATING_EVENTS = INVALIDATING_EVENTS;
