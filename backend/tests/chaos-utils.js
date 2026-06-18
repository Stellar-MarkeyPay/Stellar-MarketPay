/**
 * backend/tests/chaos-utils.js
 * Chaos Engineering Utility Functions
 * Provides tools to inject various failure scenarios into the system
 */
"use strict";

const CHAOS_SCENARIOS = {
  DB_LATENCY: "database_latency",
  DB_TIMEOUT: "database_timeout",
  DB_DISCONNECT: "database_disconnect",
  DB_POOL_STRESS: "database_pool_stress",
  DB_ERROR_INJECTION: "database_error_injection",
  CONNECTION_REFUSED: "connection_refused",
  DEGRADATION: "service_degradation",
};

class ChaosInjector {
  constructor() {
    this.eventListeners = [];
    this.metrics = {
      scenariosRun: 0,
      failuresInjected: 0,
      failuresRecovered: 0,
    };
  }

  on(eventType, handler) {
    this.eventListeners.push({ type: eventType, handler });
  }

  off(eventType, handler) {
    this.eventListeners = this.eventListeners.filter(
      (listener) => !(listener.type === eventType && listener.handler === handler)
    );
  }

  emit(eventType, data) {
    this.eventListeners
      .filter((listener) => listener.type === eventType)
      .forEach((listener) => listener.handler(data));
  }

  createLatencyInjectedQuery(originalQuery, latencyMs) {
    return async (...args) => {
      const delay = typeof latencyMs === "function" ? latencyMs() : latencyMs;
      await new Promise((resolve) => setTimeout(resolve, delay));

      this.emit("event", {
        type: "latency_injected",
        latency: delay,
        timestamp: new Date().toISOString(),
      });

      return originalQuery(...args);
    };
  }

  createTimeoutInjectedQuery(originalQuery, timeoutMs) {
    return async (...args) => {
      return Promise.race([
        originalQuery(...args),
        new Promise((_, reject) => {
          const timeout = setTimeout(() => {
            clearTimeout(timeout);
            const error = new Error(
              `Query timeout after ${timeoutMs}ms`
            );
            error.code = "ETIMEDOUT";
            reject(error);
          }, timeoutMs);
        }),
      ]);
    };
  }

  createConnectionLossQuery(originalQuery, failureRate = 0.5) {
    return async (...args) => {
      if (Math.random() < failureRate) {
        this.metrics.failuresInjected++;
        const error = new Error("Connection lost");
        error.code = "ECONNLOST";
        throw error;
      }

      return originalQuery(...args);
    };
  }

  createErrorInjectedQuery(originalQuery, errorRate = 0.1) {
    return async (...args) => {
      if (Math.random() < errorRate) {
        this.metrics.failuresInjected++;
        const errors = [
          new Error("Database error: connection pool exhausted"),
          new Error("Database error: query canceled due to timeout"),
          new Error("Database error: server closed the connection unexpectedly"),
        ];
        throw errors[Math.floor(Math.random() * errors.length)];
      }

      return originalQuery(...args);
    };
  }

  async runChaosScenario(scenarioName, testFn, iterations = 1) {
    const results = [];
    let successCount = 0;
    let errorCount = 0;
    const latencies = [];
    let recoveryAttempts = 0;

    this.metrics.scenariosRun++;

    this.emit("event", {
      type: "chaos_scenario_started",
      scenario: scenarioName,
      iterations,
      timestamp: new Date().toISOString(),
    });

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();

      try {
        const result = await testFn();
        const duration = Date.now() - startTime;

        if (result.success) {
          successCount++;
          if (result.recoveredAfterFailure) {
            recoveryAttempts++;
            this.metrics.failuresRecovered++;
          }
        } else {
          errorCount++;
        }

        latencies.push(duration);
        results.push({ ...result, duration });
      } catch (error) {
        errorCount++;
        latencies.push(Date.now() - startTime);
        results.push({
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
        });
      }
    }

    const averageLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;

    const summary = {
      scenario: scenarioName,
      totalRuns: iterations,
      successCount,
      errorCount,
      successRate: successCount / iterations,
      averageLatency,
      maxLatency: Math.max(...latencies),
      minLatency: Math.min(...latencies),
      recoveryAttempts,
      results,
    };

    this.emit("event", {
      type: "chaos_scenario_completed",
      scenario: scenarioName,
      summary,
      timestamp: new Date().toISOString(),
    });

    return summary;
  }

  reset() {
    this.metrics = {
      scenariosRun: 0,
      failuresInjected: 0,
      failuresRecovered: 0,
    };
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getReport() {
    const report = {
      title: "Chaos Engineering Test Report",
      timestamp: new Date().toISOString(),
      metrics: this.getMetrics(),
      steadyStateDefinition: {
        maxLatency: "500ms",
        maxErrorRate: "1%",
        minSuccessRate: "99%",
        maxRecoveryTime: "5s",
      },
      scenarios: Object.values(CHAOS_SCENARIOS),
      recommendations: [
        "Implement circuit breaker pattern for database failures",
        "Add exponential backoff for retry logic",
        "Monitor connection pool usage continuously",
        "Set appropriate query timeouts per operation",
        "Implement health checks for critical services",
        "Use bulkheads to isolate failure domains",
        "Enable detailed logging for failure scenarios",
        "Test disaster recovery procedures regularly",
      ],
    };

    return report;
  }
}

function createChaosInjector() {
  return new ChaosInjector();
}

module.exports = {
  ChaosInjector,
  createChaosInjector,
  CHAOS_SCENARIOS,
};
