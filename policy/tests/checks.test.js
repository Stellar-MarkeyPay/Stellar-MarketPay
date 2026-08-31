/*
 * policy/tests/checks.test.js
 *
 * Both outcomes for every rule in the catalogue.
 *
 * The failing case proves the rule fires; the passing case proves it does not
 * fire on ordinary work. A rule with only the first test is a rule that will
 * be disabled the week it blocks something legitimate, and a rule with only
 * the second silently stops enforcing the day a refactor breaks it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { file, context, runRule } = require("./helpers");

const CONTRACT = "contracts/marketpay-contract/src/lib.rs";

test("contract-entrypoint-tests: fires when an entrypoint changes with no test", () => {
  const findings = runRule(
    "contract-entrypoint-tests",
    context({
      changes: [
        file(CONTRACT, {
          added: ["    pub fn release_escrow(env: Env, id: u64) -> Result<(), Error> {"],
          addedFrom: 120,
        }),
      ],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /release_escrow/);
  assert.ok(findings[0].remediationHint, "must name the fix, not just the rule");
});

test("contract-entrypoint-tests: fires when an entrypoint is removed", () => {
  const findings = runRule(
    "contract-entrypoint-tests",
    context({
      changes: [file(CONTRACT, { removed: ["    pub fn approve_multisig(env: Env) {"] })],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /approve_multisig/);
});

test("contract-entrypoint-tests: passes when a test changes alongside", () => {
  const findings = runRule(
    "contract-entrypoint-tests",
    context({
      changes: [
        file(CONTRACT, { added: ["    pub fn release_escrow(env: Env, id: u64) {"] }),
        file("contracts/marketpay-contract/tests/v2_escrow.rs", { added: ["    // covered"] }),
      ],
    })
  );
  assert.deepEqual(findings, []);
});

test("contract-entrypoint-tests: passes for a non-entrypoint edit", () => {
  const findings = runRule(
    "contract-entrypoint-tests",
    context({ changes: [file(CONTRACT, { added: ["// a comment"] })] })
  );
  assert.deepEqual(findings, []);
});

const ESCROW_BEFORE = `
#[contracttype]
pub struct Escrow {
    pub client: Address,
    pub freelancer: Address,
    pub amount: i128,
}
`;
const ESCROW_AFTER = `
#[contracttype]
pub struct Escrow {
    pub client: Address,
    pub freelancer: Address,
}
`;

test("storage-compat-ack: fires when a stored field disappears without acknowledgement", () => {
  const findings = runRule(
    "storage-compat-ack",
    context({
      changes: [file(CONTRACT, { removed: ["    pub amount: i128,"] })],
      baseContents: { [CONTRACT]: ESCROW_BEFORE },
      contents: { [CONTRACT]: ESCROW_AFTER },
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /Escrow/);
  assert.match(findings[0].message, /amount/);
});

test("storage-compat-ack: passes when a commit carries the trailer", () => {
  const findings = runRule(
    "storage-compat-ack",
    context({
      changes: [file(CONTRACT, { removed: ["    pub amount: i128,"] })],
      baseContents: { [CONTRACT]: ESCROW_BEFORE },
      contents: { [CONTRACT]: ESCROW_AFTER },
      commits: [
        {
          sha: "abc",
          subject: "feat(escrow): drop amount",
          message:
            "feat(escrow): drop amount\n\nStorage-Compat: v1 entries are read through EscrowV1 " +
            "and migrated lazily on first touch.\n",
        },
      ],
    })
  );
  assert.deepEqual(findings, []);
});

test("storage-compat-ack: passes when the stored shape is untouched", () => {
  const findings = runRule(
    "storage-compat-ack",
    context({
      changes: [file(CONTRACT, { added: ["// unrelated"] })],
      baseContents: { [CONTRACT]: ESCROW_BEFORE },
      contents: { [CONTRACT]: `${ESCROW_BEFORE}\n// unrelated` },
    })
  );
  assert.deepEqual(findings, []);
});

test("cargo-lock-integrity: fires when the lock is deleted", () => {
  const findings = runRule(
    "cargo-lock-integrity",
    context({
      changes: [file("contracts/marketpay-contract/Cargo.lock", { status: "deleted" })],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /deleted/);
});

test("cargo-lock-integrity: fires when the lock moves without its manifest", () => {
  const findings = runRule(
    "cargo-lock-integrity",
    context({
      changes: [file("contracts/marketpay-contract/Cargo.lock", { added: ['version = "3.0.0"'] })],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /Cargo\.toml did not/);
});

test("cargo-lock-integrity: fires on a new unbounded requirement", () => {
  const findings = runRule(
    "cargo-lock-integrity",
    context({
      changes: [
        file("contracts/marketpay-contract/Cargo.toml", {
          added: ['ed25519-dalek = ">=2.0.0"'],
          addedFrom: 14,
        }),
      ],
    })
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 14);
  assert.match(findings[0].message, /unbounded/);
});

test("cargo-lock-integrity: passes for a bounded bump with both files", () => {
  const findings = runRule(
    "cargo-lock-integrity",
    context({
      changes: [
        file("contracts/marketpay-contract/Cargo.toml", {
          added: ['ed25519-dalek = ">=2.0.0, <3"'],
        }),
        file("contracts/marketpay-contract/Cargo.lock", { added: ['version = "2.1.1"'] }),
      ],
    })
  );
  assert.deepEqual(findings, []);
});

const MIGRATIONS = "backend/src/db/migrations";

test("migration-down-tested: fires on an up migration with no down", () => {
  const findings = runRule(
    "migration-down-tested",
    context({
      changes: [
        file(`${MIGRATIONS}/V90__thing.up.sql`, { status: "added", added: ["CREATE TABLE"] }),
      ],
      files: [],
    })
  );
  assert.ok(findings.some((finding) => /no matching/.test(finding.message)));
});

test("migration-down-tested: fires when the migration set changes with no test", () => {
  const findings = runRule(
    "migration-down-tested",
    context({
      changes: [
        file(`${MIGRATIONS}/V90__thing.up.sql`, { status: "added", added: ["CREATE TABLE x()"] }),
        file(`${MIGRATIONS}/V90__thing.down.sql`, { status: "added", added: ["DROP TABLE x"] }),
      ],
      files: [],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /no migration test/);
});

test("migration-down-tested: passes with a down migration and a test", () => {
  const findings = runRule(
    "migration-down-tested",
    context({
      changes: [
        file(`${MIGRATIONS}/V90__thing.up.sql`, { status: "added", added: ["CREATE TABLE x()"] }),
        file(`${MIGRATIONS}/V90__thing.down.sql`, { status: "added", added: ["DROP TABLE x"] }),
        file("backend/src/db/migrate.test.js", { added: ["  it('rolls V90 back', ...)"] }),
      ],
      files: [],
    })
  );
  assert.deepEqual(findings, []);
});

test("migration-down-tested: fires when a down migration is deleted", () => {
  const findings = runRule(
    "migration-down-tested",
    context({
      changes: [file(`${MIGRATIONS}/V90__thing.down.sql`, { status: "deleted" })],
      files: [],
    })
  );
  // Two findings, and both are true: the rollback is gone, and nothing in the
  // changeset ran a migration test to notice.
  assert.equal(findings.length, 2);
  assert.ok(findings.some((finding) => /no rollback/.test(finding.message)));
  assert.ok(findings.some((finding) => /no migration test/.test(finding.message)));
});

test("new-module-tests: fires on a new untested service", () => {
  const findings = runRule(
    "new-module-tests",
    context({
      changes: [file("backend/src/services/payoutService.js", { status: "added" })],
      files: [],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].remediationHint, /payoutService\.test\.js/);
});

test("new-module-tests: passes when the test arrives with it", () => {
  const findings = runRule(
    "new-module-tests",
    context({
      changes: [
        file("backend/src/services/payoutService.js", { status: "added" }),
        file("backend/src/services/payoutService.test.js", { status: "added" }),
      ],
      files: [],
    })
  );
  assert.deepEqual(findings, []);
});

test("new-module-tests: does not fire on edits to existing untested modules", () => {
  const findings = runRule(
    "new-module-tests",
    context({
      changes: [file("backend/src/services/legacyService.js", { added: ["// tweak"] })],
      files: [],
    })
  );
  assert.deepEqual(findings, []);
});

test("no-wallclock-tests: fires on an assertion against Date.now()", () => {
  const findings = runRule(
    "no-wallclock-tests",
    context({
      changes: [
        file("backend/src/services/retainerService.test.js", {
          added: ["    expect(new Date(row.effectiveAt).getTime()).toBeGreaterThan(Date.now());"],
          addedFrom: 919,
        }),
      ],
    })
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 919);
});

test("no-wallclock-tests: passes when the clock is frozen", () => {
  const findings = runRule(
    "no-wallclock-tests",
    context({
      changes: [
        file("backend/src/services/retainerService.test.js", {
          added: [
            "    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));",
            "    expect(row.effectiveAt).toBe('2026-01-08T00:00:00.000Z');",
          ],
        }),
      ],
    })
  );
  assert.deepEqual(findings, []);
});

test("no-wallclock-tests: ignores non-test files", () => {
  const findings = runRule(
    "no-wallclock-tests",
    context({
      changes: [
        file("backend/src/services/retainerService.js", {
          added: ["  expect(x).toBeGreaterThan(Date.now());"],
        }),
      ],
    })
  );
  assert.deepEqual(findings, []);
});

test("no-root-scripts: fires on a script added at the root", () => {
  const findings = runRule(
    "no-root-scripts",
    context({ changes: [file("append_type.py", { status: "added" })] })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].remediationHint, /scripts\//);
});

test("no-root-scripts: passes for the same script under scripts/", () => {
  const findings = runRule(
    "no-root-scripts",
    context({ changes: [file("scripts/append_type.py", { status: "added" })] })
  );
  assert.deepEqual(findings, []);
});

test("no-secrets: fires on an AWS access key id", () => {
  const findings = runRule(
    "no-secrets",
    context({
      changes: [
        file("backend/src/config.js", {
          added: ['const key = "AKIAIOSFODNN7EXAMPLE";'],
          addedFrom: 7,
        }),
      ],
    })
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 7);
  assert.match(findings[0].message, /AWS access key id/);
});

test("no-secrets: fires on a high-entropy credential assignment", () => {
  const findings = runRule(
    "no-secrets",
    context({
      changes: [
        file("backend/src/config.js", {
          added: ['const apiKey = "hT4kQ92zXbLm7Rd0PvYw3NcFgJ6sAeUiZq8Bt1Ho";'],
        }),
      ],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /high-entropy/);
});

test("no-secrets: passes on documentation placeholders", () => {
  const findings = runRule(
    "no-secrets",
    context({
      changes: [
        file("k8s/backend-deployment.yaml", {
          added: [
            "  DATABASE_URL: postgresql://stellarwork:change-me@marketpay-postgres:5432/app",
            "  JWT_SECRET: change-me",
            "  API_TOKEN: ${BACKEND_API_TOKEN}",
          ],
        }),
      ],
    })
  );
  assert.deepEqual(findings, []);
});

test("no-secrets: passes on an allowlisted literal", () => {
  const findings = runRule(
    "no-secrets",
    context({
      changes: [
        file("frontend/tests/e2e/api/personas.ts", {
          added: [
            'const ADMIN_SECRET = "SBRZLLKDXS4YFK7MKVC3YFNZA3B3DTD4OQBO3ZZOLYT753L6YVPRSB7W";',
          ],
        }),
      ],
    })
  );
  assert.deepEqual(findings, []);
});

test("no-secrets: still fires on a different Stellar seed in the same file", () => {
  const findings = runRule(
    "no-secrets",
    context({
      changes: [
        file("frontend/tests/e2e/api/personas.ts", {
          added: ['const OTHER = "SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4";'],
        }),
      ],
    })
  );
  assert.equal(findings.length, 1);
});

test("signed-commits: fires on an unsigned commit", () => {
  const findings = runRule(
    "signed-commits",
    context({
      commits: [{ sha: "deadbeefcafe", signature: "N", subject: "feat: thing", authorName: "Ada" }],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /no signature/);
});

test("signed-commits: fires on a bad signature", () => {
  const findings = runRule(
    "signed-commits",
    context({
      commits: [{ sha: "deadbeef", signature: "B", subject: "feat: thing", authorName: "Ada" }],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /bad signature/);
});

test("signed-commits: passes on a good signature", () => {
  const findings = runRule(
    "signed-commits",
    context({
      commits: [{ sha: "deadbeef", signature: "G", subject: "feat: thing", authorName: "Ada" }],
    })
  );
  assert.deepEqual(findings, []);
});

test("no-secrets: passes on a loopback development DSN", () => {
  const findings = runRule(
    "no-secrets",
    context({
      changes: [
        file("backend/.env.example", {
          added: ["DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/app"],
        }),
      ],
    })
  );
  assert.deepEqual(findings, []);
});

test("no-secrets: fires on the same DSN pointed at a real host", () => {
  const findings = runRule(
    "no-secrets",
    context({
      changes: [
        file("backend/.env.production", {
          added: [
            "DATABASE_URL=postgresql://stellarwork:g7Qx2vLpNz@db.marketpay.internal:5432/app",
          ],
        }),
      ],
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /database URL/);
});

test("hook-integrity: fires when a governed file is missing from the manifest", () => {
  const findings = runRule(
    "hook-integrity",
    context({
      changes: [file(".husky/post-checkout", { status: "added", added: ["echo hi"] })],
      contents: {
        "policy/integrity.json": JSON.stringify({ algorithm: "sha256", files: {} }),
      },
    })
  );
  assert.ok(findings.some((finding) => /not recorded/.test(finding.message)));
});

test("hook-integrity: fires when a recorded digest no longer matches", () => {
  const findings = runRule(
    "hook-integrity",
    context({
      changes: [],
      contents: {
        "policy/integrity.json": JSON.stringify({
          algorithm: "sha256",
          files: { ".husky/pre-commit": "0".repeat(64) },
        }),
        ".husky/pre-commit": "npx lint-staged\n",
      },
    })
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /does not match the digest/);
});

test("hook-integrity: passes when the recorded digest is current", () => {
  const crypto = require("node:crypto");
  const hook = "npx lint-staged\n";
  const findings = runRule(
    "hook-integrity",
    context({
      changes: [],
      contents: {
        "policy/integrity.json": JSON.stringify({
          algorithm: "sha256",
          files: { ".husky/pre-commit": crypto.createHash("sha256").update(hook).digest("hex") },
        }),
        ".husky/pre-commit": hook,
      },
    })
  );
  assert.deepEqual(findings, []);
});

test("storage-compat-ack: passes when only path qualification changes", () => {
  const before = "#[contracttype]\npub struct Escrow {\n  pub items: soroban_sdk::Vec<Item>,\n}\n";
  const after = "#[contracttype]\npub struct Escrow {\n  pub items: Vec<Item>,\n}\n";
  const findings = runRule(
    "storage-compat-ack",
    context({
      changes: [file(CONTRACT, { added: ["  pub items: Vec<Item>,"] })],
      baseContents: { [CONTRACT]: before },
      contents: { [CONTRACT]: after },
    })
  );
  assert.deepEqual(findings, []);
});

test("storage-compat-ack: passes when a stored type only moves between modules", () => {
  const declaration = "#[contracttype]\npub struct Escrow {\n  pub client: Address,\n}\n";
  const findings = runRule(
    "storage-compat-ack",
    context({
      changes: [
        file(CONTRACT, { removed: ["pub struct Escrow {"] }),
        file("contracts/marketpay-contract/src/escrow.rs", { added: ["pub struct Escrow {"] }),
      ],
      baseContents: { [CONTRACT]: declaration },
      contents: { "contracts/marketpay-contract/src/escrow.rs": declaration },
    })
  );
  assert.deepEqual(findings, []);
});

test("storage-compat-ack: does not fire on a newly declared stored type", () => {
  const after = "#[contracttype]\npub struct EscrowV3 {\n  pub client: Address,\n}\n";
  const findings = runRule(
    "storage-compat-ack",
    context({
      changes: [file(CONTRACT, { status: "modified", added: ["pub struct EscrowV3 {"] })],
      baseContents: { [CONTRACT]: "" },
      contents: { [CONTRACT]: after },
    })
  );
  assert.deepEqual(findings, []);
});
