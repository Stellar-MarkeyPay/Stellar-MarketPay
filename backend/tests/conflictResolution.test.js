"use strict";

const { ConflictResolver, FINANCIAL_TABLES } = require("../src/db/crdt");

describe("Conflict Resolution & Consistency Matrix", () => {
  it("strictly forbids silent Last-Write-Wins on all financial tables", () => {
    for (const table of FINANCIAL_TABLES) {
      // 1. Write on non-authority region must be REJECTED
      const evalNonAuthority = ConflictResolver.evaluateWrite(table, "secondary-cluster", false);
      expect(evalNonAuthority.allowed).toBe(false);
      expect(evalNonAuthority.reason).toContain("cannot be written on non-authority region");

      // 2. Write on fenced region must be REJECTED
      const evalFenced = ConflictResolver.evaluateWrite(table, "primary-cluster", true, {
        fenced: true,
      });
      expect(evalFenced.allowed).toBe(false);
      expect(evalFenced.reason).toContain("is fenced");

      // 3. Conflict resolution attempt on financial rows returns hard rejection
      const resolution = ConflictResolver.resolveCausalConflict(
        table,
        { id: "1", amount: 100 },
        { id: "1", amount: 200 }
      );
      expect(resolution.status).toBe("rejected");
      expect(resolution.strategy).toBe("HARD_REJECT_FINANCIAL");
    }
  });

  it("resolves job lifecycle conflicts through state machine progression", () => {
    const localOpen = { id: "job-1", status: "open", title: "Original Title" };
    const incomingInProgress = { id: "job-1", status: "in_progress", freelancer_address: "G..." };

    const res = ConflictResolver.resolveCausalConflict("jobs", localOpen, incomingInProgress);

    expect(res.status).toBe("resolved");
    expect(res.strategy).toBe("STATE_MACHINE_PROGRESSION");
    expect(res.resolvedRecord.status).toBe("in_progress");
  });

  it("prevents regressing completed or in-progress jobs to open status", () => {
    const localCompleted = { id: "job-1", status: "completed" };
    const incomingOpen = { id: "job-1", status: "open" };

    const res = ConflictResolver.resolveCausalConflict("jobs", localCompleted, incomingOpen);

    expect(res.status).toBe("resolved");
    expect(res.strategy).toBe("RETAIN_PROGRESSIVE_STATE");
    expect(res.resolvedRecord.status).toBe("completed");
  });

  it("resolves profile updates via timestamp and field-level merging", () => {
    const localProfile = {
      public_key: "G...",
      display_name: "Old Name",
      bio: "Local Bio",
      updated_at: "2026-08-30T10:00:00Z",
    };
    const incomingProfile = {
      public_key: "G...",
      display_name: "New Name",
      bio: "Incoming Bio",
      updated_at: "2026-08-30T10:05:00Z",
    };

    const res = ConflictResolver.resolveCausalConflict("profiles", localProfile, incomingProfile);

    expect(res.status).toBe("resolved");
    expect(res.strategy).toBe("FIELD_MERGE_NEWER_TS");
    expect(res.resolvedRecord.display_name).toBe("New Name");
  });
});
