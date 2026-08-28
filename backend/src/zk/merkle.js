/**
 * src/zk/merkle.js
 *
 * RFC 6962 Merkle tree over rating commitments (Issue #319).
 *
 * The tree is what makes a rating immutable once issued. The aggregate
 * Pedersen commitments are what a proof is actually about, but they are just
 * points — nothing stops an issuer from quietly recomputing them. The Merkle
 * root pins the exact multiset of leaves that produced them, and the root is
 * anchored on-chain, so:
 *
 *   - a client who left a rating can check their leaf is in the tree
 *     (inclusion proof) and that the root containing it was anchored;
 *   - the issuer cannot retroactively drop or edit a rating without producing
 *     a different root, which is visible to everyone;
 *   - a revocation is an explicit, auditable new root rather than a silent
 *     deletion.
 *
 * RFC 6962 hashing (distinct 0x00/0x01 prefixes, split at the largest power of
 * two below n) is used rather than "duplicate the last node", which admits
 * two different leaf sets with the same root.
 */
"use strict";

const { createHash } = require("crypto");

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);
const LEAF_DOMAIN = Buffer.from("MarketPay/ZKREP/leaf/v1", "utf8");

function sha256(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/** Hash of the empty tree. */
function emptyRoot() {
  return sha256(Buffer.alloc(0));
}

/**
 * Canonical leaf bytes for one issued rating.
 *
 * `index` is the append position, which is also the ordering the "recent N"
 * scopes rely on. `revoked` is part of the leaf so that revoking a rating
 * changes the root — a revocation is a new tree, not an erasure. `subject`
 * binds the leaf to whose history it belongs, so a leaf (and its inclusion
 * proof) cannot be replayed under a different subject's tree even if two
 * subjects happened to receive numerically identical commitments.
 */
function encodeLeaf({ index, revoked, subject, commitments }) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(index, 0);
  header.writeUInt8(revoked ? 1 : 0, 4);
  return Buffer.concat([
    LEAF_DOMAIN,
    header,
    sha256(Buffer.from(String(subject), "utf8")),
    commitments.score,
    commitments.amount,
    commitments.dispute,
  ]);
}

function hashLeaf(leafBytes) {
  return sha256(LEAF_PREFIX, leafBytes);
}

function hashNode(left, right) {
  return sha256(NODE_PREFIX, left, right);
}

/** Largest power of two strictly less than n. */
function splitPoint(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Merkle root over already-hashed leaves. */
function rootFromLeafHashes(leafHashes) {
  if (leafHashes.length === 0) return emptyRoot();
  if (leafHashes.length === 1) return leafHashes[0];
  const k = splitPoint(leafHashes.length);
  return hashNode(
    rootFromLeafHashes(leafHashes.slice(0, k)),
    rootFromLeafHashes(leafHashes.slice(k))
  );
}

/** Merkle root over leaf byte-strings. */
function computeRoot(leaves) {
  return rootFromLeafHashes(leaves.map(hashLeaf));
}

/**
 * Audit path for leaf `index`: the sibling hashes needed to recompute the
 * root, ordered leaf-upward, each tagged with the side it sits on.
 */
function inclusionProof(leaves, index) {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`merkle: index ${index} out of range (${leaves.length} leaves)`);
  }
  const leafHashes = leaves.map(hashLeaf);
  const path = [];

  function walk(hashes, offset, target) {
    if (hashes.length <= 1) return;
    const k = splitPoint(hashes.length);
    const left = hashes.slice(0, k);
    const right = hashes.slice(k);
    if (target < offset + k) {
      path.push({ side: "right", hash: rootFromLeafHashes(right).toString("hex") });
      walk(left, offset, target);
    } else {
      path.push({ side: "left", hash: rootFromLeafHashes(left).toString("hex") });
      walk(right, offset + k, target);
    }
  }

  walk(leafHashes, 0, index);
  // `walk` records siblings root-downward; verification consumes them
  // leaf-upward.
  path.reverse();
  return { index, leafCount: leaves.length, path };
}

/** Recompute a root from a leaf and its audit path. */
function verifyInclusion(leafBytes, proof, expectedRootHex) {
  let current = hashLeaf(leafBytes);
  for (const step of proof.path) {
    const sibling = Buffer.from(step.hash, "hex");
    current = step.side === "left" ? hashNode(sibling, current) : hashNode(current, sibling);
  }
  return current.toString("hex") === expectedRootHex;
}

module.exports = {
  sha256,
  emptyRoot,
  encodeLeaf,
  hashLeaf,
  hashNode,
  computeRoot,
  inclusionProof,
  verifyInclusion,
};
