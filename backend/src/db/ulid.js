/**
 * src/db/ulid.js
 *
 * Monotonic ULID (Universally Unique Lexicographically Sortable Identifier) Generator.
 * Provides 128-bit collision-free identifiers across distributed regions without coordination locks:
 * - 48 bits: Millisecond UNIX timestamp (sortable for ~10,889 years).
 * - 80 bits: Cryptographically secure entropy + region/node encoding + monotonic increments per millisecond.
 * - Encoded in 26 characters using Crockford's Base32 alphabet.
 */
"use strict";

const crypto = require("crypto");

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = 26;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = 0;
let lastRandom = new Uint8Array(10);

/**
 * Encode an integer timestamp into Crockford Base32 (10 chars).
 * @param {number} time - Milliseconds since Unix epoch
 * @returns {string}
 */
function encodeTime(time) {
  let chars = "";
  let current = time;
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = current % 32;
    chars = CROCKFORD_BASE32.charAt(mod) + chars;
    current = Math.floor(current / 32);
  }
  return chars;
}

/**
 * Encode random bytes into Crockford Base32 (16 chars for 10 bytes / 80 bits).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function encodeRandom(bytes) {
  let chars = "";
  // 10 bytes = 80 bits = 16 * 5 bits
  let buffer = 0;
  let bitCount = 0;

  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      const index = (buffer >> bitCount) & 0x1f;
      chars += CROCKFORD_BASE32.charAt(index);
    }
  }
  if (bitCount > 0) {
    const index = (buffer << (5 - bitCount)) & 0x1f;
    chars += CROCKFORD_BASE32.charAt(index);
  }
  return chars.slice(0, RANDOM_LEN);
}

/**
 * Increment the 10-byte random component monotonically.
 * @param {Uint8Array} bytes
 */
function incrementRandom(bytes) {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] < 255) {
      bytes[i]++;
      return;
    }
    bytes[i] = 0;
  }
  // Roll over
  crypto.randomFillSync(bytes);
}

/**
 * Generate a monotonic ULID string.
 * @param {number} [seedTime] - Optional timestamp in ms (defaults to Date.now())
 * @param {string|number} [regionNodeTag] - Optional region/node tag to prefix entropy
 * @returns {string} 26-character ULID
 */
function generateUlid(seedTime, regionNodeTag) {
  const now = typeof seedTime === "number" && Number.isFinite(seedTime) ? seedTime : Date.now();

  if (now === lastTime) {
    incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = crypto.randomBytes(10);

    // If region/node tag provided, mix into the top 16 bits of randomness
    if (regionNodeTag) {
      const tagHash = crypto.createHash("sha256").update(String(regionNodeTag)).digest();
      lastRandom[0] = tagHash[0];
      lastRandom[1] = tagHash[1];
    }
  }

  const timePart = encodeTime(now);
  const randomPart = encodeRandom(lastRandom);
  return timePart + randomPart;
}

/**
 * Validate whether a string is a valid 26-character Crockford Base32 ULID.
 * @param {string} str
 * @returns {boolean}
 */
function isValidUlid(str) {
  if (typeof str !== "string" || str.length !== ENCODING_LEN) {
    return false;
  }
  return /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/i.test(str);
}

/**
 * Extract the timestamp in milliseconds from a ULID.
 * @param {string} ulid
 * @returns {number}
 */
function extractTimestamp(ulid) {
  if (!isValidUlid(ulid)) {
    throw new Error(`Invalid ULID: ${ulid}`);
  }
  const timePart = ulid.slice(0, TIME_LEN).toUpperCase();
  let time = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const char = timePart[i];
    const val = CROCKFORD_BASE32.indexOf(char);
    if (val === -1) throw new Error(`Invalid character in ULID: ${char}`);
    time = time * 32 + val;
  }
  return time;
}

/**
 * Lexicographical comparison for ULIDs.
 * Returns -1 if a < b, 1 if a > b, 0 if equal.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareUlids(a, b) {
  const cleanA = String(a).toUpperCase();
  const cleanB = String(b).toUpperCase();
  if (cleanA < cleanB) return -1;
  if (cleanA > cleanB) return 1;
  return 0;
}

module.exports = {
  generateUlid,
  isValidUlid,
  extractTimestamp,
  compareUlids,
  CROCKFORD_BASE32,
};
