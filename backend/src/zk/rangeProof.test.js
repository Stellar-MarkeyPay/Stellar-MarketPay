"use strict";

const bls = require("./bls12381");
const ped = require("./pedersen");
const { Transcript } = require("./transcript");
const rangeProof = require("./rangeProof");

const T = (label) => new Transcript(label);

describe("zk/rangeProof", () => {
  test.each([
    [0n, 8],
    [1n, 8],
    [5n, 8],
    [255n, 8],
    [100n, 32],
    [0n, 1],
    [1n, 1],
    [65535n, 16],
  ])("proves and verifies value=%s bitWidth=%i", (value, bitWidth) => {
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(value, blinding);
    const proof = rangeProof.prove(T("t"), { value, blinding, bitWidth });
    expect(rangeProof.verify(T("t"), commitment, proof)).toBe(true);
  });

  test("serializes and deserializes without changing verification outcome", () => {
    const value = 42n;
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(value, blinding);
    const proof = rangeProof.prove(T("t"), { value, blinding, bitWidth: 16 });
    const roundTripped = rangeProof.deserializeProof(rangeProof.serializeProof(proof));
    expect(rangeProof.verify(T("t"), commitment, roundTripped)).toBe(true);
  });

  test("rejects a value outside the stated range at proof time", () => {
    expect(() =>
      rangeProof.prove(T("t"), { value: 256n, blinding: ped.randomBlinding(), bitWidth: 8 })
    ).toThrow(/out of stated range/);
    expect(() =>
      rangeProof.prove(T("t"), { value: -1n, blinding: ped.randomBlinding(), bitWidth: 8 })
    ).toThrow(/out of stated range/);
  });

  test("NEGATIVE: a proof for one value does not verify against a commitment to a different value", () => {
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(300n, blinding); // out of an 8-bit range
    const proof = rangeProof.prove(T("t"), { value: 44n, blinding, bitWidth: 8 }); // commit(44, blinding) != commitment
    expect(rangeProof.verify(T("t"), commitment, proof)).toBe(false);
  });

  test("NEGATIVE: mutating a bit response breaks verification", () => {
    const value = 10n;
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(value, blinding);
    const proof = rangeProof.prove(T("t"), { value, blinding, bitWidth: 8 });
    const mutated = {
      ...proof,
      bitProofs: proof.bitProofs.map((bp, i) => (i === 0 ? { ...bp, z0: bp.z0 + 1n } : bp)),
    };
    expect(rangeProof.verify(T("t"), commitment, mutated)).toBe(false);
  });

  test("NEGATIVE: branch challenges that do not sum to the transcript challenge are rejected", () => {
    const value = 3n;
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(value, blinding);
    const proof = rangeProof.prove(T("t"), { value, blinding, bitWidth: 8 });
    const mutated = {
      ...proof,
      bitProofs: proof.bitProofs.map((bp, i) =>
        i === 0 ? { ...bp, e0: bls.frAdd(bp.e0, 1n) } : bp
      ),
    };
    expect(rangeProof.verify(T("t"), commitment, mutated)).toBe(false);
  });

  test("NEGATIVE: a proof is not replayable across a different Fiat-Shamir context", () => {
    const value = 3n;
    const blinding = ped.randomBlinding();
    const commitment = ped.commit(value, blinding);
    const proof = rangeProof.prove(T("context-a"), { value, blinding, bitWidth: 8 });
    expect(rangeProof.verify(T("context-b"), commitment, proof)).toBe(false);
  });

  test("NEGATIVE: forging a proof for a value composed of an oversized bit decomposition wraps mod r and is rejected as out of range", () => {
    // Simulates an attacker trying to prove "value in [0, 2^32)" for a
    // negative difference by handing prove() the value already reduced mod r
    // (the only way it could end up "in range" numerically as a BigInt).
    const wrapped = bls.frMod(-10n);
    expect(() =>
      rangeProof.prove(T("t"), { value: wrapped, blinding: ped.randomBlinding(), bitWidth: 32 })
    ).toThrow(/out of stated range/);
  });

  test("verify() never throws on malformed input, only returns false", () => {
    const commitment = ped.commit(1n, ped.randomBlinding());
    expect(
      rangeProof.verify(T("t"), commitment, { bitWidth: 8, bitCommitments: [], bitProofs: [] })
    ).toBe(false);
    expect(rangeProof.verify(T("t"), commitment, null)).toBe(false);
  });
});
