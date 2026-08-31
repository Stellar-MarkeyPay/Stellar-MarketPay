/*
 * policy/engine/diff.js
 *
 * Unified-diff parser.
 *
 * The engine needs three things out of a diff that `--name-status` alone does
 * not give: which lines were added, which were removed, and where in the new
 * file the added lines landed. Rules such as `no-wallclock-tests` and
 * `no-secrets` report a file *and a line*, and a rule that cannot name the
 * line produces the "just a rule identifier" failure message the policy
 * catalogue forbids.
 *
 * Diffs are generated with `-U0` so a hunk contains only changed lines; the
 * hunk header then gives an exact new-file line number for every addition.
 */

"use strict";

const FILE_HEADER = /^diff --git a\/(.*) b\/(.*)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * @typedef {Object} AddedLine
 * @property {number} line   1-indexed line number in the new file
 * @property {string} text   line content without the leading '+'
 *
 * @typedef {Object} RemovedLine
 * @property {number} line   1-indexed line number in the old file
 * @property {string} text   line content without the leading '-'
 *
 * @typedef {Object} ChangedFile
 * @property {string} path            path in the new tree (old tree if deleted)
 * @property {string|null} oldPath    previous path for renames, else null
 * @property {"added"|"modified"|"deleted"|"renamed"} status
 * @property {boolean} binary
 * @property {AddedLine[]} added
 * @property {RemovedLine[]} removed
 */

/**
 * Parse a `git diff -U0` payload into ChangedFile records.
 *
 * @param {string} raw
 * @returns {ChangedFile[]}
 */
function parseDiff(raw) {
  /** @type {ChangedFile[]} */
  const files = [];
  /** @type {ChangedFile|null} */
  let current = null;
  let newLine = 0;
  let oldLine = 0;

  const lines = String(raw || "").split("\n");

  for (const line of lines) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      current = {
        path: header[2],
        oldPath: null,
        status: "modified",
        binary: false,
        added: [],
        removed: [],
      };
      files.push(current);
      newLine = 0;
      oldLine = 0;
      continue;
    }
    if (!current) continue;

    if (line.startsWith("new file mode")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      current.status = "deleted";
      // For a deletion the b/ side is /dev/null; report the path that existed.
      current.path = current.oldPath || current.path;
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.oldPath = line.slice("rename from ".length);
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length);
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      continue;
    }

    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      continue;
    }

    // Ignore the ---/+++ path lines; they are not content.
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;

    if (line.startsWith("+")) {
      current.added.push({ line: newLine, text: line.slice(1) });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      current.removed.push({ line: oldLine, text: line.slice(1) });
      oldLine += 1;
      continue;
    }
  }

  return files;
}

module.exports = { parseDiff };
