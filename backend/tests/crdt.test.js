"use strict";

const { VectorClock, PNCounter, LWWRegister, ORSet, Ordering } = require("../src/db/crdt");

describe("VectorClock", () => {
  it("initializes and increments per node", () => {
    const vc = new VectorClock();
    vc.increment("region-a");
    vc.increment("region-a");
    vc.increment("region-b");

    expect(vc.get("region-a")).toBe(2);
    expect(vc.get("region-b")).toBe(1);
    expect(vc.get("region-c")).toBe(0);
  });

  it("detects causal ordering and concurrency", () => {
    const vc1 = new VectorClock({ "region-a": 1, "region-b": 0 });
    const vc2 = new VectorClock({ "region-a": 2, "region-b": 0 });
    const vc3 = new VectorClock({ "region-a": 1, "region-b": 1 });

    expect(vc1.compare(vc2)).toBe(Ordering.BEFORE);
    expect(vc2.compare(vc1)).toBe(Ordering.AFTER);
    expect(vc2.compare(vc3)).toBe(Ordering.CONCURRENT);
    expect(vc2.isConcurrentWith(vc3)).toBe(true);
  });

  it("merges by taking pointwise maximums", () => {
    const vc1 = new VectorClock({ "region-a": 3, "region-b": 1 });
    const vc2 = new VectorClock({ "region-a": 2, "region-b": 4, "region-c": 1 });

    vc1.merge(vc2);
    expect(vc1.toJSON()).toEqual({
      "region-a": 3,
      "region-b": 4,
      "region-c": 1,
    });
  });
});

describe("PNCounter CRDT", () => {
  it("increments and decrements across distinct regions commutatively", () => {
    const c1 = new PNCounter("profile", "user-1", "completed_jobs");
    const c2 = new PNCounter("profile", "user-1", "completed_jobs");

    c1.increment(5, "us-east", "node-1");
    c1.decrement(2, "us-east", "node-1");

    c2.increment(10, "eu-west", "node-1");
    c2.decrement(1, "eu-west", "node-1");

    expect(c1.value()).toBe(3);
    expect(c2.value()).toBe(9);

    // Merge both directions (commutativity & idempotency)
    const merged1 = new PNCounter("profile", "user-1", "completed_jobs", c1.deltas).merge(c2);
    const merged2 = new PNCounter("profile", "user-1", "completed_jobs", c2.deltas).merge(c1);

    expect(merged1.value()).toBe(12);
    expect(merged2.value()).toBe(12);
  });

  it("builds valid SQL upsert queries", () => {
    const sql = PNCounter.buildUpsertSql("job", "job-123", "view_count", "us-east", "node-1", 5, 0);
    expect(sql.text).toContain("INSERT INTO crdt_pn_counters");
    expect(sql.values).toEqual(["job", "job-123", "view_count", "us-east", "node-1", 5, 0]);
  });
});

describe("LWWRegister", () => {
  it("resolves by highest timestamp and breaks ties by node ID", () => {
    const reg = new LWWRegister("val-1", 1000, "node-a");

    // Older timestamp should not replace
    const updated1 = reg.merge({ value: "val-0", timestamp: 999, nodeId: "node-z" });
    expect(updated1).toBe(false);
    expect(reg.value).toBe("val-1");

    // Newer timestamp replaces
    const updated2 = reg.merge({ value: "val-2", timestamp: 1001, nodeId: "node-a" });
    expect(updated2).toBe(true);
    expect(reg.value).toBe("val-2");

    // Same timestamp: higher node ID wins tie
    const updated3 = reg.merge({ value: "val-3", timestamp: 1001, nodeId: "node-b" });
    expect(updated3).toBe(true);
    expect(reg.value).toBe("val-3");
  });
});

describe("ORSet (Add-Wins Set)", () => {
  it("supports concurrent adds and removes without lost additions", () => {
    const setA = new ORSet();
    const setB = new ORSet();

    setA.add("skill:stellar");
    setA.add("skill:rust");

    // Set B observes and merges set A
    setB.merge(setA);
    expect(setB.read()).toEqual(expect.arrayContaining(["skill:stellar", "skill:rust"]));

    // Concurrent: Set A removes "skill:stellar", while Set B adds "skill:stellar" again concurrently
    setA.remove("skill:stellar");
    setB.add("skill:stellar");

    // Merge both
    setA.merge(setB);
    setB.merge(setA);

    // Add wins over earlier remove because of new tag
    expect(setA.has("skill:stellar")).toBe(true);
    expect(setB.has("skill:stellar")).toBe(true);
    expect(setA.has("skill:rust")).toBe(true);
  });
});
