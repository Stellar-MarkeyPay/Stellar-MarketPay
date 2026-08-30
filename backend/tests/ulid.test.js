"use strict";

const { generateUlid, isValidUlid, extractTimestamp, compareUlids } = require("../src/db/ulid");

describe("Monotonic ULID Generator", () => {
  it("generates valid 26-character Crockford Base32 ULIDs", () => {
    const ulid = generateUlid();
    expect(ulid).toHaveLength(26);
    expect(isValidUlid(ulid)).toBe(true);
  });

  it("extracts accurate timestamps from generated ULIDs", () => {
    const now = 1756500000000; // Fixed timestamp
    const ulid = generateUlid(now);
    const extracted = extractTimestamp(ulid);
    expect(extracted).toBe(now);
  });

  it("preserves lexicographical sort order across distinct timestamps", () => {
    const t1 = 1756500000000;
    const t2 = 1756500005000;
    const ulid1 = generateUlid(t1);
    const ulid2 = generateUlid(t2);

    expect(compareUlids(ulid1, ulid2)).toBe(-1);
    expect(compareUlids(ulid2, ulid1)).toBe(1);
    expect(ulid1 < ulid2).toBe(true);
  });

  it("generates monotonically strictly increasing ULIDs within the same millisecond", () => {
    const now = Date.now();
    const count = 1000;
    const ulids = [];

    for (let i = 0; i < count; i++) {
      ulids.push(generateUlid(now));
    }

    expect(ulids).toHaveLength(count);

    for (let i = 1; i < count; i++) {
      expect(compareUlids(ulids[i - 1], ulids[i])).toBe(-1);
      expect(ulids[i - 1] < ulids[i]).toBe(true);
    }
  });

  it("correctly handles region and node tags in entropy", () => {
    const uPrimary = generateUlid(undefined, "primary-cluster:node-0");
    const uSecondary = generateUlid(undefined, "secondary-cluster:node-0");

    expect(isValidUlid(uPrimary)).toBe(true);
    expect(isValidUlid(uSecondary)).toBe(true);
    expect(uPrimary).not.toBe(uSecondary);
  });

  it("rejects malformed ULID strings", () => {
    expect(isValidUlid("too-short")).toBe(false);
    expect(isValidUlid("123456789012345678901234567890")).toBe(false); // 30 chars
    expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
    expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toBe(false); // 'I' is illegal in Crockford Base32
    expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAL")).toBe(false); // 'L' is illegal
    expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAO")).toBe(false); // 'O' is illegal
    expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAU")).toBe(false); // 'U' is illegal
  });
});
