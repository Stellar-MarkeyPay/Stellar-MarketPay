/*
 * Check: storage-compat-ack
 *
 * A change to the shape of a stored type is an on-chain migration. It must
 * carry an explicit acknowledgement that storage compatibility was considered.
 *
 * The check compares the declaration of each stored type before and after the
 * changeset rather than reading the diff, because a `-U0` hunk shows changed
 * lines without the declaration they belong to — and it is the declaration,
 * not the line, that determines whether deployed ledger entries still decode.
 */

"use strict";

const { violation } = require("./helpers");

const RULE = "storage-compat-ack";

/**
 * Extract the member set of `struct Name { .. }` or `enum Name { .. }`.
 *
 * Returns null when the type is absent so a caller can tell "no such type"
 * from "type with no members".
 */
function membersOf(source, typeName) {
  if (!source) return null;
  const declaration = new RegExp(
    `(?:^|\\n)\\s*(?:pub\\s+)?(?:struct|enum)\\s+${typeName}\\b[^{;]*([{;])`
  );
  const match = declaration.exec(source);
  if (!match) return null;
  if (match[1] === ";") return []; // unit struct

  let depth = 0;
  let index = match.index + match[0].length - 1;
  const start = index + 1;
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // Strip comments and attributes before splitting on commas. A doc comment
  // containing a comma would otherwise be split into fragments that no longer
  // start with `///`, and half a sentence would be reported as a struct field.
  const body = source
    .slice(start, index)
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .filter((line) => !/^\s*#\[/.test(line))
    .join("\n");

  const members = [];
  let nesting = 0;
  let buffer = "";
  for (const char of body) {
    if (char === "(" || char === "[" || char === "<" || char === "{") nesting += 1;
    if (char === ")" || char === "]" || char === ">" || char === "}") nesting -= 1;
    if (char === "," && nesting === 0) {
      members.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  members.push(buffer);

  return members
    .map((member) =>
      member
        .replace(/\s+/g, " ")
        // Path qualification is not shape: `soroban_sdk::Vec<Milestone>` and
        // `Vec<Milestone>` encode identically, and treating an import cleanup
        // as a storage migration is how a rule earns a reputation for being
        // wrong.
        .replace(/\b[A-Za-z_][A-Za-z0-9_]*::/g, "")
        .trim()
    )
    .filter(Boolean);
}

function acknowledgementPresent(context, trailer) {
  const marker = new RegExp(`^\\s*${trailer}\\s*:\\s*\\S`, "im");
  if (marker.test(context.commitMessage)) return true;
  if (marker.test(context.prBody)) return true;
  return context.commits.some((commit) => marker.test(commit.message));
}

/**
 * Locate a type's declaration across every configured source.
 *
 * Resolved across all sources rather than per file because a type moving
 * between modules is a refactor, not a storage change — and a per-file
 * comparison reports the move as "removed here, added there", which is two
 * false positives for one harmless commit.
 */
function locate(sources, read, typeName) {
  for (const source of sources) {
    const members = membersOf(read(source), typeName);
    if (members !== null) return { path: source, members };
  }
  return null;
}

function run(context, options) {
  const types = options.types || ["Escrow", "DataKey"];
  const sources = options.sources || [];
  const trailer = options.trailer || "Storage-Compat";

  const changedSources = new Set(context.changes.map((file) => file.path));
  if (!sources.some((source) => changedSources.has(source))) return [];

  /** @type {{type: string, path: string, detail: string}[]} */
  const shapeChanges = [];

  for (const type of types) {
    const before = locate(sources, (source) => context.readBaseFile(source), type);
    const after = locate(sources, (source) => context.readFile(source), type);

    if (!before && !after) continue;
    if (!before) {
      // A type that did not exist before has no ledger entries written with an
      // older layout, so there is nothing to be compatible with. Fields added
      // to a type that *does* already exist still fire, below.
      continue;
    }
    if (!after) {
      shapeChanges.push({ type, path: before.path, detail: `${type} was removed` });
      continue;
    }

    const removed = before.members.filter((member) => !after.members.includes(member));
    const added = after.members.filter((member) => !before.members.includes(member));
    if (removed.length === 0 && added.length === 0) continue;

    const parts = [];
    if (removed.length > 0) parts.push(`removed/changed: ${removed.join(" | ")}`);
    if (added.length > 0) parts.push(`added: ${added.join(" | ")}`);
    shapeChanges.push({ type, path: after.path, detail: parts.join("; ") });
  }

  if (shapeChanges.length === 0) return [];
  if (acknowledgementPresent(context, trailer)) return [];

  return shapeChanges.map((change) =>
    violation(RULE, {
      path: change.path,
      message:
        `${change.path} changes the stored type ${change.type} (${change.detail}) without a ` +
        `${trailer} acknowledgement. Deployed ledger entries were written with the old shape.`,
      remediationHint:
        `Add a "${trailer}: <how existing entries decode, and the migration if they do not>" ` +
        `trailer to a commit in this change, or to the pull request body.`,
      evidence: change.detail,
    })
  );
}

module.exports = { RULE, run, membersOf };
