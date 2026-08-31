import assert from "node:assert/strict";
import test from "node:test";
import { isGeneratedCommitMessage } from "../cli.mjs";

test("generated Git lifecycle messages bypass conventional-commit linting", () => {
  assert.equal(isGeneratedCommitMessage("Merge branch 'main'", {}), true);
  assert.equal(isGeneratedCommitMessage('Revert "feat: example"', {}), true);
  assert.equal(isGeneratedCommitMessage("fixup! feat: example", {}), true);
  assert.equal(isGeneratedCommitMessage("anything", { merge: true }), true);
  assert.equal(isGeneratedCommitMessage("feat(frontend): add page", {}), false);
});
