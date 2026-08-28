"use strict";

const ped = require("./pedersen");
const { Transcript } = require("./transcript");
const statements = require("./statements");

const T = (label) => new Transcript(label);

function scoreLeaf(scaled) {
  const blinding = ped.randomBlinding();
  return { value: BigInt(scaled), blinding, commitment: ped.commit(BigInt(scaled), blinding) };
}

describe("zk/statements — rating_threshold", () => {
  test("proves and verifies an average that meets the threshold", () => {
    const leaves = Array.from({ length: 20 }, (_, i) => scoreLeaf(i % 2 === 0 ? 500 : 450));
    const stmt = statements.ratingThreshold({ thresholdScaled: 450, count: 20 });
    const proof = stmt.prove(T("t"), {
      scoreValues: leaves.map((l) => l.value),
      scoreBlindings: leaves.map((l) => l.blinding),
    });
    expect(stmt.verify(T("t"), { scoreCommitments: leaves.map((l) => l.commitment) }, proof)).toBe(
      true
    );
  });

  test("NEGATIVE: refuses to build a proof for an average below the threshold", () => {
    const leaves = Array.from({ length: 20 }, () => scoreLeaf(450));
    const stmt = statements.ratingThreshold({ thresholdScaled: 460, count: 20 });
    expect(() =>
      stmt.prove(T("t"), {
        scoreValues: leaves.map((l) => l.value),
        scoreBlindings: leaves.map((l) => l.blinding),
      })
    ).toThrow(/does not hold/);
  });

  test("NEGATIVE: a proof for a low threshold does not verify against commitments for a claimed-higher one", () => {
    const leaves = Array.from({ length: 20 }, () => scoreLeaf(450));
    const lowStmt = statements.ratingThreshold({ thresholdScaled: 450, count: 20 });
    const proof = lowStmt.prove(T("t"), {
      scoreValues: leaves.map((l) => l.value),
      scoreBlindings: leaves.map((l) => l.blinding),
    });
    const highStmt = statements.ratingThreshold({ thresholdScaled: 500, count: 20 });
    expect(
      highStmt.verify(T("t"), { scoreCommitments: leaves.map((l) => l.commitment) }, proof)
    ).toBe(false);
  });

  test("NEGATIVE: verify rejects a commitment list of the wrong length (padding with zero-value leaves)", () => {
    const leaves = Array.from({ length: 20 }, () => scoreLeaf(500));
    const stmt = statements.ratingThreshold({ thresholdScaled: 450, count: 20 });
    const proof = stmt.prove(T("t"), {
      scoreValues: leaves.map((l) => l.value),
      scoreBlindings: leaves.map((l) => l.blinding),
    });
    const padded = [...leaves.map((l) => l.commitment), ped.commit(0n, ped.randomBlinding())];
    expect(stmt.verify(T("t"), { scoreCommitments: padded }, proof)).toBe(false);
  });
});

describe("zk/statements — earnings_band", () => {
  function amountLeaf(v) {
    const blinding = ped.randomBlinding();
    return { value: BigInt(v), blinding, commitment: ped.commit(BigInt(v), blinding) };
  }

  test("proves and verifies a total within the band", () => {
    const leaves = [amountLeaf(1000), amountLeaf(2500), amountLeaf(500)];
    const stmt = statements.earningsBand({ minAmount: 1000, maxAmount: 5000, count: 3 });
    const proof = stmt.prove(T("t"), {
      amountValues: leaves.map((l) => l.value),
      amountBlindings: leaves.map((l) => l.blinding),
    });
    expect(stmt.verify(T("t"), { amountCommitments: leaves.map((l) => l.commitment) }, proof)).toBe(
      true
    );
  });

  test("NEGATIVE: refuses to build a proof for a total outside the band", () => {
    const leaves = [amountLeaf(1000), amountLeaf(2500), amountLeaf(500)];
    const stmt = statements.earningsBand({ minAmount: 10000, maxAmount: 20000, count: 3 });
    expect(() =>
      stmt.prove(T("t"), {
        amountValues: leaves.map((l) => l.value),
        amountBlindings: leaves.map((l) => l.blinding),
      })
    ).toThrow(/does not hold/);
  });

  test("NEGATIVE: verify rejects tampered commitments even against a valid proof", () => {
    const leaves = [amountLeaf(1000), amountLeaf(2500), amountLeaf(500)];
    const stmt = statements.earningsBand({ minAmount: 1000, maxAmount: 5000, count: 3 });
    const proof = stmt.prove(T("t"), {
      amountValues: leaves.map((l) => l.value),
      amountBlindings: leaves.map((l) => l.blinding),
    });
    const tampered = [...leaves.map((l) => l.commitment)];
    tampered[0] = ped.commit(999999n, ped.randomBlinding());
    expect(stmt.verify(T("t"), { amountCommitments: tampered }, proof)).toBe(false);
  });
});

describe("zk/statements — dispute_free", () => {
  function flagLeaf(v) {
    const blinding = ped.randomBlinding();
    return { value: BigInt(v), blinding, commitment: ped.commit(BigInt(v), blinding) };
  }

  test("proves and verifies zero disputes", () => {
    const leaves = [flagLeaf(0), flagLeaf(0), flagLeaf(0), flagLeaf(0)];
    const stmt = statements.disputeFree({ count: 4 });
    const proof = stmt.prove(T("t"), {
      disputeValues: leaves.map((l) => l.value),
      disputeBlindings: leaves.map((l) => l.blinding),
    });
    expect(
      stmt.verify(T("t"), { disputeCommitments: leaves.map((l) => l.commitment) }, proof)
    ).toBe(true);
  });

  test("NEGATIVE: refuses to build a proof when a dispute is present", () => {
    const leaves = [flagLeaf(0), flagLeaf(1), flagLeaf(0), flagLeaf(0)];
    const stmt = statements.disputeFree({ count: 4 });
    expect(() =>
      stmt.prove(T("t"), {
        disputeValues: leaves.map((l) => l.value),
        disputeBlindings: leaves.map((l) => l.blinding),
      })
    ).toThrow(/does not hold/);
  });

  test("NEGATIVE: a clean proof does not verify against commitments that actually contain a dispute", () => {
    const cleanLeaves = [flagLeaf(0), flagLeaf(0), flagLeaf(0), flagLeaf(0)];
    const stmt = statements.disputeFree({ count: 4 });
    const proof = stmt.prove(T("t"), {
      disputeValues: cleanLeaves.map((l) => l.value),
      disputeBlindings: cleanLeaves.map((l) => l.blinding),
    });
    const dirtyCommitments = [
      flagLeaf(0).commitment,
      flagLeaf(1).commitment,
      flagLeaf(0).commitment,
      flagLeaf(0).commitment,
    ];
    expect(stmt.verify(T("t"), { disputeCommitments: dirtyCommitments }, proof)).toBe(false);
  });
});

describe("zk/statements — completion_count", () => {
  test("verifies count >= minCount", () => {
    const stmt = statements.completionCount({ minCount: 20, count: 25 });
    expect(stmt.verify(T("t"), {}, stmt.prove())).toBe(true);
  });

  test("NEGATIVE: refuses to construct a statement whose stated count is below minCount", () => {
    expect(() => statements.completionCount({ minCount: 20, count: 5 })).toThrow(/>= minCount/);
  });
});

describe("zk/statements — buildStatement", () => {
  test("rejects unknown statement kinds", () => {
    expect(() => statements.buildStatement("not_a_real_statement", {})).toThrow(/unknown/);
  });
});
