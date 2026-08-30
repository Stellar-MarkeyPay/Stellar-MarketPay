/**
 * src/db/crdt.js
 *
 * Conflict-Free Replicated Data Types (CRDTs) and Conflict Resolution Primitives.
 * Implements:
 * 1. PNCounter: State-based Positive-Negative Counter with per-node delta vectors.
 * 2. VectorClock: Causality tracking and concurrent modification detector.
 * 3. LWWRegister: Deterministic Last-Write-Wins with vector clock / timestamp + node tie-breaker.
 * 4. ORSet: Observed-Remove Set (Add-Wins Set) for tag and preference collections.
 * 5. ConflictResolver: Table-policy-aware conflict evaluation engine enforcing strict rejection on financial rows.
 */
"use strict";

const { generateUlid } = require("./ulid");

// ─────────────────────────────────────────
// 1. VectorClock
// ─────────────────────────────────────────

const Ordering = {
  EQUAL: "EQUAL",
  BEFORE: "BEFORE",
  AFTER: "AFTER",
  CONCURRENT: "CONCURRENT",
};

class VectorClock {
  /**
   * @param {Record<string, number>} [initialEntries]
   */
  constructor(initialEntries = {}) {
    this.entries = {};
    for (const [node, count] of Object.entries(initialEntries)) {
      if (typeof count === "number" && count >= 0) {
        this.entries[node] = count;
      }
    }
  }

  /**
   * Increment clock for a given node/region.
   * @param {string} node
   * @returns {VectorClock} this
   */
  increment(node) {
    if (!node) throw new Error("Node identifier is required to increment VectorClock");
    this.entries[node] = (this.entries[node] || 0) + 1;
    return this;
  }

  /**
   * Get logical counter for a node.
   * @param {string} node
   * @returns {number}
   */
  get(node) {
    return this.entries[node] || 0;
  }

  /**
   * Clone vector clock.
   * @returns {VectorClock}
   */
  clone() {
    return new VectorClock(this.entries);
  }

  /**
   * Merge another vector clock into this one by taking pointwise maximum.
   * @param {VectorClock|Record<string, number>} other
   * @returns {VectorClock} this
   */
  merge(other) {
    const otherEntries = other instanceof VectorClock ? other.entries : other || {};
    for (const [node, count] of Object.entries(otherEntries)) {
      this.entries[node] = Math.max(this.entries[node] || 0, count);
    }
    return this;
  }

  /**
   * Compare this clock with another clock.
   * @param {VectorClock|Record<string, number>} other
   * @returns {"EQUAL"|"BEFORE"|"AFTER"|"CONCURRENT"}
   */
  compare(other) {
    const otherClock = other instanceof VectorClock ? other : new VectorClock(other);
    const allKeys = new Set([...Object.keys(this.entries), ...Object.keys(otherClock.entries)]);

    let hasGreater = false;
    let hasLesser = false;

    for (const key of allKeys) {
      const v1 = this.get(key);
      const v2 = otherClock.get(key);

      if (v1 > v2) hasGreater = true;
      if (v1 < v2) hasLesser = true;
    }

    if (hasGreater && hasLesser) return Ordering.CONCURRENT;
    if (hasGreater) return Ordering.AFTER;
    if (hasLesser) return Ordering.BEFORE;
    return Ordering.EQUAL;
  }

  isConcurrentWith(other) {
    return this.compare(other) === Ordering.CONCURRENT;
  }

  descendsFrom(other) {
    const cmp = this.compare(other);
    return cmp === Ordering.AFTER || cmp === Ordering.EQUAL;
  }

  toJSON() {
    return { ...this.entries };
  }
}

// ─────────────────────────────────────────
// 2. PNCounter (Positive-Negative Counter CRDT)
// ─────────────────────────────────────────

class PNCounter {
  /**
   * @param {string} entityType - e.g. "profile", "job"
   * @param {string} entityId - Entity identifier
   * @param {string} counterName - e.g. "completed_jobs", "applicant_count"
   * @param {Record<string, { p: number, n: number }>} [initialDeltas] - Map of "region:node" -> { p, n }
   */
  constructor(entityType, entityId, counterName, initialDeltas = {}) {
    this.entityType = entityType;
    this.entityId = entityId;
    this.counterName = counterName;
    this.deltas = {};

    for (const [key, val] of Object.entries(initialDeltas)) {
      this.deltas[key] = {
        p: Number(val?.p || 0),
        n: Number(val?.n || 0),
      };
    }
  }

  static makeKey(region, node) {
    return `${region || "unknown"}:${node || "0"}`;
  }

  /**
   * Increment counter on a given region and node.
   * @param {number} [amount=1]
   * @param {string} [region="default"]
   * @param {string} [node="node-0"]
   * @returns {PNCounter} this
   */
  increment(amount = 1, region = "default", node = "node-0") {
    const num = Number(amount);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error(`Increment amount must be a non-negative number: ${amount}`);
    }
    const key = PNCounter.makeKey(region, node);
    if (!this.deltas[key]) this.deltas[key] = { p: 0, n: 0 };
    this.deltas[key].p += num;
    return this;
  }

  /**
   * Decrement counter on a given region and node.
   * @param {number} [amount=1]
   * @param {string} [region="default"]
   * @param {string} [node="node-0"]
   * @returns {PNCounter} this
   */
  decrement(amount = 1, region = "default", node = "node-0") {
    const num = Number(amount);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error(`Decrement amount must be a non-negative number: ${amount}`);
    }
    const key = PNCounter.makeKey(region, node);
    if (!this.deltas[key]) this.deltas[key] = { p: 0, n: 0 };
    this.deltas[key].n += num;
    return this;
  }

  /**
   * Calculate aggregate counter value.
   * @returns {number}
   */
  value() {
    let total = 0;
    for (const delta of Object.values(this.deltas)) {
      total += (delta.p || 0) - (delta.n || 0);
    }
    return total;
  }

  /**
   * Merge another PNCounter into this one taking the max positive and negative deltas per node.
   * @param {PNCounter} other
   * @returns {PNCounter} this
   */
  merge(other) {
    if (!other || !other.deltas) return this;
    for (const [key, val] of Object.entries(other.deltas)) {
      if (!this.deltas[key]) {
        this.deltas[key] = { p: Number(val.p || 0), n: Number(val.n || 0) };
      } else {
        this.deltas[key].p = Math.max(this.deltas[key].p, Number(val.p || 0));
        this.deltas[key].n = Math.max(this.deltas[key].n, Number(val.n || 0));
      }
    }
    return this;
  }

  /**
   * Build SQL UPSERT parameter list for database synchronization.
   * @param {string} region
   * @param {string} node
   * @param {number} pos
   * @param {number} neg
   * @returns {{ text: string, values: any[] }}
   */
  static buildUpsertSql(entityType, entityId, counterName, region, node, pos, neg) {
    return {
      text: `
        INSERT INTO crdt_pn_counters (entity_type, entity_id, counter_name, region_id, node_id, positive_delta, negative_delta, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (entity_type, entity_id, counter_name, region_id, node_id)
        DO UPDATE SET
          positive_delta = crdt_pn_counters.positive_delta + EXCLUDED.positive_delta,
          negative_delta = crdt_pn_counters.negative_delta + EXCLUDED.negative_delta,
          updated_at = NOW()
        RETURNING *
      `,
      values: [entityType, entityId, counterName, region, node, Math.max(0, pos), Math.max(0, neg)],
    };
  }

  toJSON() {
    return {
      entityType: this.entityType,
      entityId: this.entityId,
      counterName: this.counterName,
      value: this.value(),
      deltas: this.deltas,
    };
  }
}

// ─────────────────────────────────────────
// 3. LWWRegister (Last-Write-Wins Register)
// ─────────────────────────────────────────

class LWWRegister {
  /**
   * @param {any} value
   * @param {number} [timestamp]
   * @param {string} [nodeId]
   */
  constructor(value, timestamp = Date.now(), nodeId = "node-0") {
    this.value = value;
    this.timestamp = timestamp;
    this.nodeId = String(nodeId);
  }

  /**
   * Merge with incoming register update.
   * Compares timestamp first; on tie, uses lexicographical node ID.
   * @param {LWWRegister|{ value: any, timestamp: number, nodeId: string }} incoming
   * @returns {boolean} True if incoming value replaced current value
   */
  merge(incoming) {
    if (!incoming) return false;
    const inTs = incoming.timestamp;
    const inNode = String(incoming.nodeId || "");

    if (inTs > this.timestamp) {
      this.value = incoming.value;
      this.timestamp = inTs;
      this.nodeId = inNode;
      return true;
    } else if (inTs === this.timestamp && inNode > this.nodeId) {
      this.value = incoming.value;
      this.timestamp = inTs;
      this.nodeId = inNode;
      return true;
    }
    return false;
  }
}

// ─────────────────────────────────────────
// 4. ORSet (Observed-Remove Set / Add-Wins Set)
// ─────────────────────────────────────────

class ORSet {
  constructor() {
    // Map of element -> Set of addition tag ULIDs
    this.addMap = new Map();
    // Set of observed tombstone tag ULIDs
    this.tombstones = new Set();
  }

  /**
   * Add an element to the set.
   * @param {any} element
   * @param {string} [tag] - Optional ULID tag
   * @returns {string} Tag ULID
   */
  add(element, tag) {
    const ulid = tag || generateUlid();
    const key = JSON.stringify(element);
    if (!this.addMap.has(key)) {
      this.addMap.set(key, new Set());
    }
    this.addMap.get(key).add(ulid);
    return ulid;
  }

  /**
   * Remove an element by moving all its current addition tags to tombstones.
   * @param {any} element
   */
  remove(element) {
    const key = JSON.stringify(element);
    if (this.addMap.has(key)) {
      for (const tag of this.addMap.get(key)) {
        this.tombstones.add(tag);
      }
      this.addMap.delete(key);
    }
  }

  /**
   * Check if set contains element.
   * @param {any} element
   * @returns {boolean}
   */
  has(element) {
    const key = JSON.stringify(element);
    if (!this.addMap.has(key)) return false;
    const tags = this.addMap.get(key);
    for (const tag of tags) {
      if (!this.tombstones.has(tag)) return true;
    }
    return false;
  }

  /**
   * Read all active elements.
   * @returns {any[]}
   */
  read() {
    const result = [];
    for (const [key, tags] of this.addMap.entries()) {
      for (const tag of tags) {
        if (!this.tombstones.has(tag)) {
          result.push(JSON.parse(key));
          break;
        }
      }
    }
    return result;
  }

  /**
   * Merge another ORSet into this one.
   * @param {ORSet} other
   */
  merge(other) {
    if (!other) return;
    for (const tomb of other.tombstones) {
      this.tombstones.add(tomb);
    }
    for (const [key, tags] of other.addMap.entries()) {
      if (!this.addMap.has(key)) {
        this.addMap.set(key, new Set());
      }
      const myTags = this.addMap.get(key);
      for (const tag of tags) {
        myTags.add(tag);
      }
    }
  }
}

// ─────────────────────────────────────────
// 5. ConflictResolver
// ─────────────────────────────────────────

const CONSISTENCY_CLASSES = {
  STRICT_CP: "STRICT_CP",
  CAUSAL_RYW: "CAUSAL_RYW",
  EVENTUAL_CRDT: "EVENTUAL_CRDT",
};

const FINANCIAL_TABLES = new Set([
  "escrows",
  "referral_payouts",
  "platform_fee_payouts",
  "multi_level_payouts",
  "insurance_claims",
  "insurance_premiums_paid",
  "sla_violations",
  "ratings",
  "dispute_evidence",
  "reputation_commitments",
  "reputation_revocations",
  "reputation_epochs",
  "frozen_wallets",
  "api_keys",
  "admin_profiles",
  "webauthn_credentials",
]);

class ConflictResolver {
  /**
   * Validate write request against table consistency policy.
   * Prevents silent Last-Write-Wins on financial records.
   *
   * @param {string} tableName
   * @param {string} currentRegion
   * @param {boolean} isAuthorityRegion
   * @param {object} [options]
   * @returns {{ allowed: boolean, reason?: string }}
   */
  static evaluateWrite(tableName, currentRegion, isAuthorityRegion, options = {}) {
    const table = String(tableName || "").toLowerCase();

    if (FINANCIAL_TABLES.has(table)) {
      if (!isAuthorityRegion) {
        return {
          allowed: false,
          reason: `Class 1 Financial record on table '${table}' cannot be written on non-authority region '${currentRegion}'. Must route to active lease authority.`,
        };
      }
      if (options.fenced === true) {
        return {
          allowed: false,
          reason: `Region '${currentRegion}' is fenced. Financial write on table '${table}' rejected to prevent split-brain.`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Reconcile two conflicting records for Class 2 (Causal) tables using state machine validation.
   *
   * @param {string} tableName
   * @param {object} localRecord
   * @param {object} incomingRecord
   * @returns {{ resolvedRecord: object, strategy: string, status: "resolved"|"rejected"|"escalated" }}
   */
  static resolveCausalConflict(tableName, localRecord, incomingRecord) {
    const table = String(tableName || "").toLowerCase();

    // Prevent silent LWW for financial entities
    if (FINANCIAL_TABLES.has(table)) {
      return {
        resolvedRecord: localRecord,
        strategy: "HARD_REJECT_FINANCIAL",
        status: "rejected",
      };
    }

    // State machine transitions for jobs
    if (table === "jobs") {
      const stateOrder = { draft: 0, open: 1, in_progress: 2, completed: 3, cancelled: 3 };
      const localState = localRecord.status || "open";
      const inState = incomingRecord.status || "open";

      const localRank = stateOrder[localState] ?? 0;
      const inRank = stateOrder[inState] ?? 0;

      if (inRank > localRank) {
        return {
          resolvedRecord: { ...localRecord, ...incomingRecord },
          strategy: "STATE_MACHINE_PROGRESSION",
          status: "resolved",
        };
      }
      return {
        resolvedRecord: localRecord,
        strategy: "RETAIN_PROGRESSIVE_STATE",
        status: "resolved",
      };
    }

    // Default field-level merge with updated_at timestamp validation
    const localTs = new Date(localRecord.updated_at || 0).getTime();
    const inTs = new Date(incomingRecord.updated_at || 0).getTime();

    if (inTs > localTs) {
      return {
        resolvedRecord: { ...localRecord, ...incomingRecord },
        strategy: "FIELD_MERGE_NEWER_TS",
        status: "resolved",
      };
    }

    return {
      resolvedRecord: { ...incomingRecord, ...localRecord },
      strategy: "FIELD_MERGE_LOCAL_AUTHORITATIVE",
      status: "resolved",
    };
  }
}

module.exports = {
  Ordering,
  VectorClock,
  PNCounter,
  LWWRegister,
  ORSet,
  ConflictResolver,
  CONSISTENCY_CLASSES,
  FINANCIAL_TABLES,
};
