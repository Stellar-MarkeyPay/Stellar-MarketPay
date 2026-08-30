"use strict";

const { routeQuery, ConsistencyLevel, PoolTarget } = require("./router");

describe("Multi-Region Query Router", () => {
  it("routes Class 1 financial queries to the Authority Writer pool", () => {
    const route = routeQuery("INSERT INTO escrows (job_id, amount_xlm) VALUES ($1, $2)", {});
    expect(route.target).toBe(PoolTarget.AUTHORITY_WRITER);
    expect(route.isFinancial).toBe(true);
    expect(route.consistencyClass).toBe("STRICT_CP");
  });

  it("routes SELECT queries to the local Read Replica pool when replica is healthy", () => {
    const route = routeQuery("SELECT * FROM jobs WHERE status = 'open'", {
      replicaLagSeconds: 0.1,
    });
    expect(route.target).toBe(PoolTarget.READ_REPLICA);
    expect(route.isFinancial).toBe(false);
  });

  it("automatically falls back to Authority Writer for reads when replica lag exceeds threshold", () => {
    const route = routeQuery("SELECT * FROM jobs WHERE status = 'open'", {
      replicaLagSeconds: 3.5,
    });
    expect(route.target).toBe(PoolTarget.AUTHORITY_WRITER);
    expect(route.reason).toContain("Replica lag");
  });

  it("routes Read-Your-Writes explicit requests to Writer pool", () => {
    const route = routeQuery("SELECT * FROM profiles WHERE public_key = $1", {
      readYourWrites: true,
    });
    expect(route.target).toBe(PoolTarget.AUTHORITY_WRITER);
  });

  it("routes Class 3 eventual writes to Regional Local pool", () => {
    const route = routeQuery("INSERT INTO job_views (job_id, ip_hash) VALUES ($1, $2)", {
      consistency: ConsistencyLevel.EVENTUAL,
    });
    expect(route.target).toBe(PoolTarget.REGIONAL_LOCAL);
  });
});
