/*
 * Check: signed-commits
 *
 * Commits reaching a protected branch must carry a verifiable signature.
 *
 * A policy engine is only as trustworthy as the commits it evaluates. Author
 * identity in git is a self-declared string; without a signature, "who wrote
 * the change that moved the escrow funds" has no answer that survives
 * scrutiny.
 *
 * The check reads `%G?` from git, so it reports what the *verifier's* keyring
 * says, not what the commit claims. Locally that keyring is the contributor's
 * own, which is why enforcement lives in CI and in branch protection; the
 * local run exists to tell someone their signing setup is broken before they
 * push twenty commits with it.
 */

"use strict";

const { violation } = require("./helpers");

const RULE = "signed-commits";

// git's %G? codes.
const STATUS = {
  G: { ok: true, description: "good signature" },
  U: { ok: true, description: "good signature, untrusted key" },
  X: { ok: false, description: "good signature that has since expired" },
  Y: { ok: false, description: "good signature made by an expired key" },
  R: { ok: false, description: "good signature made by a revoked key" },
  B: { ok: false, description: "bad signature" },
  E: { ok: false, description: "signature could not be checked (missing key)" },
  N: { ok: false, description: "no signature" },
};

function run(context, options) {
  const acceptUntrusted = options.acceptUntrusted !== false;
  const results = [];

  for (const commit of context.commits) {
    const code = commit.signature || "N";
    const status = STATUS[code] || { ok: false, description: `unknown status "${code}"` };
    const ok = status.ok && (acceptUntrusted || code === "G");
    if (ok) continue;

    const short = commit.sha ? commit.sha.slice(0, 8) : "(unknown)";
    results.push(
      violation(RULE, {
        path: null,
        message: `Commit ${short} ("${commit.subject}") by ${commit.authorName} has ${status.description}.`,
        remediationHint:
          `Enrol a signing key once with docs/COMMIT_SIGNING.md (npm run policy:signing-setup), ` +
          `then re-sign this range with: git rebase --exec "git commit --amend --no-edit -S" ` +
          `<base>`,
        evidence: code,
      })
    );
  }

  return results;
}

module.exports = { RULE, run, STATUS };
