"use strict";

const ped = require("./pedersen");
const { Transcript } = require("./transcript");
const equalityProof = require("./equalityProof");

const T = (label) => new Transcript(label);

describe("zk/equalityProof", () => {
  test("proves and verifies a commitment to zero", () => {
    const blinding = ped.randomBlinding();
    const commitment = ped.commitZero(blinding);
    const proof = equalityProof.prove(T("t"), { commitment, target: 0n, blinding });
    expect(equalityProof.verify(T("t"), commitment, 0n, proof)).toBe(true);
  });

  test("proves and verifies a commitment to an arbitrary public value", () => {
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(77n, blinding);
    const proof = equalityProof.prove(T("t"), { commitment, target: 77n, blinding });
    expect(equalityProof.verify(T("t"), commitment, 77n, proof)).toBe(true);
  });

  test("serializes and deserializes without changing verification outcome", () => {
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(5n, blinding);
    const proof = equalityProof.prove(T("t"), { commitment, target: 5n, blinding });
    const roundTripped = equalityProof.deserializeProof(equalityProof.serializeProof(proof));
    expect(equalityProof.verify(T("t"), commitment, 5n, roundTripped)).toBe(true);
  });

  test("NEGATIVE: a commitment to a nonzero value does not verify a claim of zero", () => {
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(3n, blinding);
    // Even honestly generated, the proof is *for* target=0 against a
    // commitment that does not open to 0 — it must not verify.
    const proof = equalityProof.prove(T("t"), { commitment, target: 0n, blinding });
    expect(equalityProof.verify(T("t"), commitment, 0n, proof)).toBe(false);
  });

  test("NEGATIVE: a proof is not reusable against a different commitment to the same value", () => {
    const blinding = ped.randomBlinding();
    const c1 = ped.commit(77n, blinding);
    const c2 = ped.commit(77n, ped.randomBlinding());
    const proof = equalityProof.prove(T("t"), { commitment: c1, target: 77n, blinding });
    expect(equalityProof.verify(T("t"), c2, 77n, proof)).toBe(false);
  });

  test("NEGATIVE: a proof is not replayable across a different Fiat-Shamir context", () => {
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(1n, blinding);
    const proof = equalityProof.prove(T("context-a"), { commitment, target: 1n, blinding });
    expect(equalityProof.verify(T("context-b"), commitment, 1n, proof)).toBe(false);
  });

  test("verify() never throws on malformed input, only returns false", () => {
    const commitment = ped.commit(1n, ped.randomBlinding());
    expect(equalityProof.verify(T("t"), commitment, 0n, {})).toBe(false);
    expect(equalityProof.verify(T("t"), commitment, 0n, null)).toBe(false);
  });
});
