/**
 * src/zk/bls12381.js
 *
 * Minimal, dependency-free BLS12-381 G1 arithmetic (Issue #319).
 *
 * Why hand-rolled: the on-chain verifier is a Soroban contract, and
 * soroban-sdk 22 exposes BLS12-381 G1 as *host functions* (`g1_add`,
 * `g1_mul`, `g1_msm`). Using the same curve off-chain means one proof format
 * verifies identically in the browser, in the API and in the contract. No npm
 * package in the lockfile provides this curve, and adding a large unaudited
 * dependency to the trust base of a reputation system is worse than 300 lines
 * we can read.
 *
 * Scope: G1 only. No pairings, no G2 — the proof system (Pedersen commitments
 * + Chaum–Pedersen sigma protocols) is pairing-free by design.
 *
 * Encoding matches soroban-sdk's `G1Affine` exactly:
 *   96 bytes = be(x) || be(y), each 48 bytes.
 *   Bit 1 (0x40) of byte 0 is the infinity flag; all other bytes then zero.
 *
 * SECURITY NOTE — timing: scalar multiplication is a fixed-window ladder, not
 * a constant-time one. Secret scalars (Pedersen blinding factors) are handled
 * here. On the browser proving path the attacker would need local timing
 * access, which already implies a lost device. On the hosted proving service
 * this is a documented residual risk; see docs/ADR-010.
 */
"use strict";

// ─── Field / group constants ─────────────────────────────────────────────────

/** Base field modulus. */
const P =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

/** Scalar field modulus (order of G1). */
const R = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/** G1 cofactor: |E(Fp)| = h * r. */
const H1 = 0x396c8c005555e1568c00aaab0000aaabn;

/** Curve equation: y^2 = x^3 + 4. */
const CURVE_B = 4n;

/** (p + 1) / 4 — square-root exponent, valid because p ≡ 3 (mod 4). */
const SQRT_EXP = (P + 1n) / 4n;

const FP_BYTES = 48;
const G1_BYTES = 96;
const FR_BYTES = 32;

// ─── Fp arithmetic ───────────────────────────────────────────────────────────

function fpMod(a) {
  const m = a % P;
  return m < 0n ? m + P : m;
}

const fpAdd = (a, b) => {
  const s = a + b;
  return s >= P ? s - P : s;
};

const fpSub = (a, b) => {
  const d = a - b;
  return d < 0n ? d + P : d;
};

const fpMul = (a, b) => (a * b) % P;
const fpSqr = (a) => (a * a) % P;
const fpNeg = (a) => (a === 0n ? 0n : P - a);

function fpPow(base, exp) {
  let result = 1n;
  let b = base % P;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

/** Modular inverse via the binary extended Euclidean algorithm. */
function fpInv(a) {
  if (a === 0n) throw new Error("bls12381: inverse of zero");
  let [oldR, r] = [fpMod(a), P];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return fpMod(oldS);
}

/** Square root if one exists, else null. p ≡ 3 (mod 4) so this is a single exp. */
function fpSqrt(a) {
  const candidate = fpPow(a, SQRT_EXP);
  return fpSqr(candidate) === fpMod(a) ? candidate : null;
}

// ─── Fr (scalar field) arithmetic ────────────────────────────────────────────

function frMod(a) {
  const m = a % R;
  return m < 0n ? m + R : m;
}

const frAdd = (a, b) => frMod(a + b);
const frSub = (a, b) => frMod(a - b);
const frMul = (a, b) => frMod(a * b);
const frNeg = (a) => frMod(-a);

function frInv(a) {
  const x = frMod(a);
  if (x === 0n) throw new Error("bls12381: inverse of zero scalar");
  let [oldR, r] = [x, R];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return frMod(oldS);
}

// ─── Points ──────────────────────────────────────────────────────────────────
//
// Internally Jacobian: (X : Y : Z) represents affine (X/Z^2, Y/Z^3).
// Z === 0n is the point at infinity.

const INFINITY = Object.freeze({ x: 1n, y: 1n, z: 0n });

const isInfinity = (p) => p.z === 0n;

function jacobian(x, y, z) {
  return { x, y, z };
}

/** Point doubling — dbl-2009-l (a = 0). */
function double(p) {
  if (isInfinity(p)) return INFINITY;
  const A = fpSqr(p.x);
  const B = fpSqr(p.y);
  const C = fpSqr(B);
  let D = fpSub(fpSqr(fpAdd(p.x, B)), fpAdd(A, C));
  D = fpAdd(D, D);
  const E = fpAdd(fpAdd(A, A), A);
  const F = fpSqr(E);
  const x3 = fpSub(F, fpAdd(D, D));
  let eightC = fpAdd(C, C);
  eightC = fpAdd(eightC, eightC);
  eightC = fpAdd(eightC, eightC);
  const y3 = fpSub(fpMul(E, fpSub(D, x3)), eightC);
  const z3 = fpMul(fpAdd(p.y, p.y), p.z);
  return z3 === 0n ? INFINITY : jacobian(x3, y3, z3);
}

/** Point addition — add-2007-bl. */
function add(p, q) {
  if (isInfinity(p)) return q;
  if (isInfinity(q)) return p;

  const z1z1 = fpSqr(p.z);
  const z2z2 = fpSqr(q.z);
  const u1 = fpMul(p.x, z2z2);
  const u2 = fpMul(q.x, z1z1);
  const s1 = fpMul(fpMul(p.y, q.z), z2z2);
  const s2 = fpMul(fpMul(q.y, p.z), z1z1);

  if (u1 === u2) {
    // Same x: either a doubling or p = -q.
    return s1 === s2 ? double(p) : INFINITY;
  }

  const h = fpSub(u2, u1);
  const i = fpSqr(fpAdd(h, h));
  const j = fpMul(h, i);
  const rr = fpAdd(fpSub(s2, s1), fpSub(s2, s1));
  const v = fpMul(u1, i);
  const x3 = fpSub(fpSub(fpSqr(rr), j), fpAdd(v, v));
  const s1j2 = fpMul(fpAdd(s1, s1), j);
  const y3 = fpSub(fpMul(rr, fpSub(v, x3)), s1j2);
  const z3 = fpMul(fpMul(fpSub(fpSqr(fpAdd(p.z, q.z)), fpAdd(z1z1, z2z2)), 1n), h);
  return z3 === 0n ? INFINITY : jacobian(x3, y3, z3);
}

function negate(p) {
  return isInfinity(p) ? INFINITY : jacobian(p.x, fpNeg(p.y), p.z);
}

function subtract(p, q) {
  return add(p, negate(q));
}

const WINDOW_BITS = 4;
const WINDOW_SIZE = 1 << WINDOW_BITS;

/**
 * Scalar multiplication, fixed 4-bit window.
 *
 * The scalar is reduced mod r first, so callers may pass negative or oversized
 * BigInts safely (the range-proof code relies on this).
 */
function multiply(point, scalar) {
  const k = frMod(scalar);
  if (k === 0n || isInfinity(point)) return INFINITY;
  if (k === 1n) return point;

  // Precompute [0]P .. [15]P.
  const table = [INFINITY, point];
  for (let i = 2; i < WINDOW_SIZE; i += 1) {
    table.push(add(table[i - 1], point));
  }

  // Walk the scalar most-significant window first.
  const bits = k.toString(2);
  const padded = "0".repeat((WINDOW_BITS - (bits.length % WINDOW_BITS)) % WINDOW_BITS) + bits;

  let acc = INFINITY;
  for (let i = 0; i < padded.length; i += WINDOW_BITS) {
    if (!isInfinity(acc)) {
      for (let d = 0; d < WINDOW_BITS; d += 1) acc = double(acc);
    }
    const digit = parseInt(padded.slice(i, i + WINDOW_BITS), 2);
    if (digit !== 0) acc = add(acc, table[digit]);
  }
  return acc;
}

/**
 * Multi-scalar multiplication: sum(scalars[i] * points[i]).
 *
 * Straightforward accumulate — the on-chain path uses the host `g1_msm`, this
 * one only has to agree with it numerically, not match its performance.
 */
function msm(points, scalars) {
  if (points.length !== scalars.length) {
    throw new Error("bls12381: msm length mismatch");
  }
  let acc = INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    acc = add(acc, multiply(points[i], scalars[i]));
  }
  return acc;
}

function toAffine(p) {
  if (isInfinity(p)) return { x: 0n, y: 0n, infinity: true };
  const zInv = fpInv(p.z);
  const zInv2 = fpSqr(zInv);
  const zInv3 = fpMul(zInv2, zInv);
  return { x: fpMul(p.x, zInv2), y: fpMul(p.y, zInv3), infinity: false };
}

function fromAffine(x, y) {
  return jacobian(x, y, 1n);
}

function equals(p, q) {
  if (isInfinity(p) || isInfinity(q)) return isInfinity(p) && isInfinity(q);
  const a = toAffine(p);
  const b = toAffine(q);
  return a.x === b.x && a.y === b.y;
}

function isOnCurve(x, y) {
  return fpSqr(y) === fpAdd(fpMul(fpSqr(x), x), CURVE_B);
}

/** r*P === O, i.e. P is in the prime-order subgroup rather than the full curve. */
function isInSubgroup(p) {
  return isInfinity(multiply(p, R));
}

// ─── Serialization (soroban-sdk G1Affine compatible) ─────────────────────────

const INFINITY_FLAG = 0x40;

function fpToBytes(value) {
  const buf = Buffer.alloc(FP_BYTES);
  let v = value;
  for (let i = FP_BYTES - 1; i >= 0; i -= 1) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function bytesToFp(buf) {
  let v = 0n;
  for (const byte of buf) v = (v << 8n) | BigInt(byte);
  return v;
}

/** Serialize to the 96-byte uncompressed encoding used by soroban-sdk. */
function serialize(p) {
  if (isInfinity(p)) {
    const buf = Buffer.alloc(G1_BYTES);
    buf[0] = INFINITY_FLAG;
    return buf;
  }
  const a = toAffine(p);
  return Buffer.concat([fpToBytes(a.x), fpToBytes(a.y)]);
}

/**
 * Parse the 96-byte encoding, rejecting anything that is not a valid
 * prime-order G1 point. Every point that arrives inside a proof goes through
 * here: skipping the subgroup check is the classic way to make a
 * "zero-knowledge" verifier accept nonsense.
 */
function deserialize(input, { skipSubgroupCheck = false } = {}) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length !== G1_BYTES) {
    throw new Error(`bls12381: expected ${G1_BYTES} bytes, got ${buf.length}`);
  }

  const flags = buf[0] & 0xe0;
  if (flags & 0x80) throw new Error("bls12381: compressed encoding not supported");
  if (flags & 0x20) throw new Error("bls12381: sort flag must be unset");

  if (flags & INFINITY_FLAG) {
    const rest = Buffer.from(buf);
    rest[0] &= ~INFINITY_FLAG;
    if (!rest.equals(Buffer.alloc(G1_BYTES))) {
      throw new Error("bls12381: infinity encoding must be all-zero");
    }
    return INFINITY;
  }

  const x = bytesToFp(buf.subarray(0, FP_BYTES));
  const y = bytesToFp(buf.subarray(FP_BYTES, G1_BYTES));
  if (x >= P || y >= P) throw new Error("bls12381: coordinate not reduced mod p");
  if (!isOnCurve(x, y)) throw new Error("bls12381: point not on curve");

  const point = fromAffine(x, y);
  if (!skipSubgroupCheck && !isInSubgroup(point)) {
    throw new Error("bls12381: point not in prime-order subgroup");
  }
  return point;
}

// ─── Scalar serialization ────────────────────────────────────────────────────

function frToBytes(value) {
  const buf = Buffer.alloc(FR_BYTES);
  let v = frMod(value);
  for (let i = FR_BYTES - 1; i >= 0; i -= 1) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function bytesToFr(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length !== FR_BYTES) {
    throw new Error(`bls12381: expected ${FR_BYTES} scalar bytes, got ${buf.length}`);
  }
  let v = 0n;
  for (const byte of buf) v = (v << 8n) | BigInt(byte);
  if (v >= R) throw new Error("bls12381: scalar not reduced mod r");
  return v;
}

// ─── Nothing-up-my-sleeve generator derivation ───────────────────────────────

const { createHash } = require("crypto");

/**
 * Derive a generator deterministically from a label.
 *
 * Try-and-increment on x, then clear the cofactor. Deterministic and
 * re-derivable by anyone from the label alone, which is the whole point: no
 * generator here has a known discrete log relative to another, and there is no
 * trusted setup to trust.
 */
function deriveGenerator(label, domain = "MarketPay/ZKREP/G1/v1") {
  for (let counter = 0; counter < 256; counter += 1) {
    // 48 bytes of candidate x from two chained SHA-256 blocks.
    const seed = `${domain}|${label}|${counter}`;
    const h1 = createHash("sha256").update(seed).digest();
    const h2 = createHash("sha256")
      .update(Buffer.concat([h1, Buffer.from("x")]))
      .digest();
    const x = bytesToFp(Buffer.concat([h1, h2]).subarray(0, FP_BYTES)) % P;

    const rhs = fpAdd(fpMul(fpSqr(x), x), CURVE_B);
    const y = fpSqrt(rhs);
    if (y === null) continue;

    // Canonical branch: the lexicographically smaller root.
    const yCanonical = y > P - y ? P - y : y;
    const candidate = multiply(fromAffine(x, yCanonical), H1);
    if (!isInfinity(candidate)) return candidate;
  }
  throw new Error(`bls12381: failed to derive generator for label ${label}`);
}

module.exports = {
  // constants
  P,
  R,
  H1,
  CURVE_B,
  FP_BYTES,
  G1_BYTES,
  FR_BYTES,
  INFINITY,
  // Fp
  fpAdd,
  fpSub,
  fpMul,
  fpSqr,
  fpNeg,
  fpInv,
  fpPow,
  fpSqrt,
  fpMod,
  // Fr
  frAdd,
  frSub,
  frMul,
  frNeg,
  frInv,
  frMod,
  frToBytes,
  bytesToFr,
  // group
  add,
  subtract,
  negate,
  double,
  multiply,
  msm,
  equals,
  isInfinity,
  isOnCurve,
  isInSubgroup,
  toAffine,
  fromAffine,
  serialize,
  deserialize,
  deriveGenerator,
};
