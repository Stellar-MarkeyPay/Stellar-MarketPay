"use strict";

const ped = require("./pedersen");
const bls = require("./bls12381");
const merkle = require("./merkle");

function buildLeaves(n, subject = "GSUBJECT") {
  const leaves = [];
  for (let i = 0; i < n; i += 1) {
    const c = (v) => bls.serialize(ped.commit(BigInt(v), ped.randomBlinding()));
    leaves.push(
      merkle.encodeLeaf({
        index: i,
        revoked: false,
        subject,
        commitments: { score: c(400 + i), amount: c(100 * i), dispute: c(0) },
      })
    );
  }
  return leaves;
}

describe("zk/merkle", () => {
  test("empty tree has a defined root", () => {
    expect(merkle.computeRoot([]).equals(merkle.emptyRoot())).toBe(true);
  });

  test.each([1, 2, 3, 4, 5, 7, 8, 16, 17, 33, 64])(
    "every leaf has a verifying inclusion proof for a tree of size %i",
    (n) => {
      const leaves = buildLeaves(n);
      const root = merkle.computeRoot(leaves).toString("hex");
      for (let i = 0; i < n; i += 1) {
        const proof = merkle.inclusionProof(leaves, i);
        expect(merkle.verifyInclusion(leaves[i], proof, root)).toBe(true);
      }
    }
  );

  test("NEGATIVE: a tampered leaf fails inclusion against the original root", () => {
    const leaves = buildLeaves(7);
    const root = merkle.computeRoot(leaves).toString("hex");
    const tampered = Buffer.from(leaves[3]);
    tampered[tampered.length - 10] ^= 0xff;
    expect(merkle.verifyInclusion(tampered, merkle.inclusionProof(leaves, 3), root)).toBe(false);
  });

  test("NEGATIVE: an inclusion proof for the wrong index does not verify a different leaf", () => {
    const leaves = buildLeaves(7);
    const root = merkle.computeRoot(leaves).toString("hex");
    expect(merkle.verifyInclusion(leaves[3], merkle.inclusionProof(leaves, 4), root)).toBe(false);
  });

  test("NEGATIVE: revoking a leaf (flipping its revoked bit) changes the root", () => {
    const leaves = buildLeaves(5);
    const rootBefore = merkle.computeRoot(leaves).toString("hex");
    const revokedLeaves = [...leaves];
    // Re-encode leaf 2 as revoked, holding its commitments fixed.
    const original = leaves[2];
    // Flip only the revoked byte (offset = domain(23) + index(4) = 27).
    const revoked = Buffer.from(original);
    revoked[27] = 1;
    revokedLeaves[2] = revoked;
    const rootAfter = merkle.computeRoot(revokedLeaves).toString("hex");
    expect(rootAfter).not.toBe(rootBefore);
  });

  test("NEGATIVE: two different subjects with numerically identical commitments produce leaves that do not cross-verify", () => {
    const c = bls.serialize(ped.commit(500n, ped.randomBlinding()));
    const leafA = merkle.encodeLeaf({
      index: 0,
      revoked: false,
      subject: "GSUBJECT_A",
      commitments: { score: c, amount: c, dispute: c },
    });
    const leafB = merkle.encodeLeaf({
      index: 0,
      revoked: false,
      subject: "GSUBJECT_B",
      commitments: { score: c, amount: c, dispute: c },
    });
    expect(leafA.equals(leafB)).toBe(false);
  });
});
