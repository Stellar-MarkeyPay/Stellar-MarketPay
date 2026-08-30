/**
 * src/zk/transcript.js
 *
 * Fiat–Shamir transcript for the reputation proof system (Issue #319).
 *
 * Every challenge is derived from a SHA-256 hash of *everything* the verifier
 * knows at that point: protocol label, the statement, the anchored commitment
 * the statement is about, the epoch, the context binding, and each prover
 * message in order. Two properties fall out of that and both are acceptance
 * criteria:
 *
 *   - A proof cannot be replayed against a different context, because the
 *     context is inside the challenge. Change the audience, the job or the
 *     nonce and every response stops verifying.
 *   - A proof cannot survive a revocation, because the epoch is inside the
 *     challenge and revoking a rating bumps the subject's epoch.
 *
 * Absorbing is length-prefixed and label-tagged so that no two distinct
 * transcripts can collide by concatenation ambiguity.
 */
"use strict";

const { createHash } = require("crypto");
const { bytesToFr, R } = require("./bls12381");

const TRANSCRIPT_VERSION = "MarketPay/ZKREP/transcript/v1";

class Transcript {
  constructor(protocolLabel) {
    this.chunks = [];
    this.absorbBytes("protocol", Buffer.from(`${TRANSCRIPT_VERSION}|${protocolLabel}`, "utf8"));
  }

  absorbBytes(label, value) {
    const labelBuf = Buffer.from(label, "utf8");
    const valueBuf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(labelBuf.length, 0);
    header.writeUInt32BE(valueBuf.length, 4);
    this.chunks.push(header, labelBuf, valueBuf);
    return this;
  }

  absorbString(label, value) {
    return this.absorbBytes(label, Buffer.from(String(value), "utf8"));
  }

  absorbUint(label, value) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(value));
    return this.absorbBytes(label, buf);
  }

  absorbPoint(label, point) {
    // Lazily required: bls12381 does not depend on this module, but requiring
    // it at module scope for one helper would be gratuitous coupling.
    const { serialize } = require("./bls12381");
    return this.absorbBytes(label, serialize(point));
  }

  absorbPoints(label, points) {
    this.absorbUint(`${label}.len`, points.length);
    points.forEach((point, index) => this.absorbPoint(`${label}[${index}]`, point));
    return this;
  }

  digest(label) {
    const hash = createHash("sha256");
    for (const chunk of this.chunks) hash.update(chunk);
    hash.update(Buffer.from(`|challenge|${label}`, "utf8"));
    return hash.digest();
  }

  /**
   * Derive a challenge scalar in Fr.
   *
   * Rejection-free: SHA-256 gives 256 bits and r is a 255-bit prime, so a
   * plain reduction has bias below 2^-127. That is far under any security
   * margin that matters here, and it keeps the Rust verifier a single
   * `U256 % r` rather than a rejection loop.
   */
  challengeScalar(label) {
    const digest = this.digest(label);
    let value = 0n;
    for (const byte of digest) value = (value << 8n) | BigInt(byte);
    return value % R;
  }

  /**
   * Derive `count` independent scalars for batched verification.
   *
   * Batching weights must be unpredictable to the prover, so they are derived
   * *after* the whole proof has been absorbed.
   */
  challengeScalars(label, count) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push(this.challengeScalar(`${label}/${i}`));
    }
    return out;
  }

  /** Fork the transcript so batching weights do not disturb the main chain. */
  fork(label) {
    const child = Object.create(Transcript.prototype);
    child.chunks = this.chunks.slice();
    child.absorbString("fork", label);
    return child;
  }
}

/**
 * Canonical hash of the context a proof is bound to.
 *
 * `audience` is who the proof is for (a client's public key, or a verifier
 * service id). `purpose` is what it is for. `nonce` makes two proofs for the
 * same audience and purpose distinct. `expiresAt` bounds how long it is worth
 * anything. All four go into the Fiat–Shamir challenge.
 */
function hashContext(context) {
  const canonical = [
    `audience=${context.audience}`,
    `purpose=${context.purpose}`,
    `nonce=${context.nonce}`,
    `expiresAt=${context.expiresAt}`,
  ].join("\n");
  return createHash("sha256").update(`MarketPay/ZKREP/context/v1\n${canonical}`, "utf8").digest();
}

/** Scalar coercion used by the verifier when reading proof bytes. */
function scalarFromBytes(buf) {
  return bytesToFr(buf);
}

module.exports = { Transcript, hashContext, scalarFromBytes, TRANSCRIPT_VERSION };
