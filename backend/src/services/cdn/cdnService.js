/**
 * src/services/cdn/cdnService.js
 * Multi-CDN purge orchestrator with automatic failover (#91).
 *
 * Providers are tried in configured order (see providers.js). A provider
 * that times out or errors trips a simple circuit breaker — after
 * `failureThreshold` consecutive failures it's skipped for `cooldownMs`
 * so a degraded vendor doesn't add latency to every purge — and the next
 * provider in the chain is tried immediately. This is the documented
 * failover behavior for a CDN-provider outage (see docs/CDN_STRATEGY.md).
 *
 * purge() always requires an explicit url/tag scope — there is no
 * "flush everything" call — so an invalidation can never accidentally
 * degrade into a full-cache flush.
 */
"use strict";

const promClient = require("prom-client");

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30000;

class CdnPurgeError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = "CdnPurgeError";
    this.attempts = attempts;
  }
}

class CdnService {
  /**
   * @param {object} opts
   * @param {Array<{name: string, purge: Function}>} opts.providers ordered provider chain
   * @param {import('prom-client').Registry} [opts.metricsRegistry] registry to publish purge metrics to
   * @param {number} [opts.timeoutMs] per-provider purge timeout
   * @param {number} [opts.failureThreshold] consecutive failures before a provider's circuit opens
   * @param {number} [opts.cooldownMs] how long an open circuit stays open before retrying
   */
  constructor({
    providers = [],
    metricsRegistry = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    cooldownMs = DEFAULT_COOLDOWN_MS,
  } = {}) {
    if (!providers.length) {
      throw new Error("CdnService requires at least one provider");
    }
    this.providers = providers;
    this.timeoutMs = timeoutMs;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.circuits = new Map(providers.map((p) => [p.name, { failures: 0, openUntil: 0 }]));
    this._registerMetrics(metricsRegistry);
  }

  _registerMetrics(registry) {
    if (!registry) {
      this.purgeTotal = null;
      this.purgeLatency = null;
      this.failoverTotal = null;
      return;
    }
    this.purgeTotal = new promClient.Counter({
      name: "marketpay_cdn_purge_total",
      help: "Total CDN purge attempts by provider and result",
      labelNames: ["provider", "result"],
      registers: [registry],
    });
    this.purgeLatency = new promClient.Histogram({
      name: "marketpay_cdn_purge_duration_seconds",
      help: "CDN purge call duration in seconds, per provider",
      labelNames: ["provider"],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4],
      registers: [registry],
    });
    this.failoverTotal = new promClient.Counter({
      name: "marketpay_cdn_failover_total",
      help: "Number of times a purge failed over to the next configured CDN provider",
      registers: [registry],
    });
  }

  isCircuitOpen(name) {
    const circuit = this.circuits.get(name);
    return Boolean(circuit && circuit.openUntil > Date.now());
  }

  _recordFailure(name) {
    const circuit = this.circuits.get(name);
    circuit.failures += 1;
    if (circuit.failures >= this.failureThreshold) {
      circuit.openUntil = Date.now() + this.cooldownMs;
    }
  }

  _recordSuccess(name) {
    const circuit = this.circuits.get(name);
    circuit.failures = 0;
    circuit.openUntil = 0;
  }

  async _withTimeout(promise, ms, providerName) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`CDN provider "${providerName}" timed out after ${ms}ms`)),
        ms
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Targeted purge across the provider chain, with failover.
   *
   * @param {{ urls?: string[], tags?: string[] }} target
   * @returns {Promise<{success: boolean, provider: string, failedOver: boolean, attempts: object[]}>}
   */
  async purge({ urls = [], tags = [] } = {}) {
    if (!urls.length && !tags.length) {
      throw new Error(
        "purge() requires at least one url or tag — refusing an unscoped full-cache flush"
      );
    }

    const attempts = [];
    for (let i = 0; i < this.providers.length; i += 1) {
      const provider = this.providers[i];

      if (this.isCircuitOpen(provider.name)) {
        attempts.push({ provider: provider.name, skipped: "circuit_open" });
        continue;
      }

      const start = Date.now();
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await this._withTimeout(
          provider.purge({ urls, tags }),
          this.timeoutMs,
          provider.name
        );
        const durationSeconds = (Date.now() - start) / 1000;

        this._recordSuccess(provider.name);
        this.purgeTotal?.inc({ provider: provider.name, result: "success" });
        this.purgeLatency?.observe({ provider: provider.name }, durationSeconds);

        return {
          success: true,
          provider: provider.name,
          durationSeconds,
          urls,
          tags,
          failedOver: attempts.length > 0,
          attempts: [...attempts, { provider: provider.name, success: true }],
          data,
        };
      } catch (err) {
        this._recordFailure(provider.name);
        this.purgeTotal?.inc({ provider: provider.name, result: "failure" });
        attempts.push({ provider: provider.name, error: err.message });
        if (i < this.providers.length - 1) this.failoverTotal?.inc();
      }
    }

    throw new CdnPurgeError(
      "All CDN providers failed to purge — cache may be stale until manual intervention",
      attempts
    );
  }

  /**
   * Provider/circuit-breaker status — surfaced at GET /api/cdn/health.
   */
  getHealth() {
    return this.providers.map((p) => ({
      provider: p.name,
      circuitOpen: this.isCircuitOpen(p.name),
      failures: this.circuits.get(p.name).failures,
    }));
  }
}

module.exports = CdnService;
module.exports.CdnPurgeError = CdnPurgeError;
