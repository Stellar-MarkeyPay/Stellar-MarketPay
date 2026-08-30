/*
 * Check: no-wallclock-tests
 *
 * Tests must not assert on wall-clock-relative output.
 *
 * Incident: two separate time-bomb tests have broken main in this repository.
 * Both passed in review and failed later, on a day nobody had changed the
 * code. A test whose result depends on when it runs is not a test.
 */

"use strict";

const { isTestPath, matchesAny, violation } = require("./helpers");

const RULE = "no-wallclock-tests";

const ASSERTION = /\b(expect|assert|assert_eq!|assert_ne!|should|toBe|toEqual|toMatch)\b|expect\(/;
const CLOCK =
  /\b(Date\.now\(\)|new Date\(\s*\)|Date\(\)|moment\(\s*\)|dayjs\(\s*\)|Utc::now|Local::now|SystemTime::now|time\.time\(\)|datetime\.now)/;

// A frozen clock is exactly the fix this rule asks for, so a line that
// installs one must not itself trip the rule.
const FROZEN =
  /(jest\.(useFakeTimers|setSystemTime)|sinon\.useFakeTimers|vi\.(useFakeTimers|setSystemTime)|MockDate|freeze_time|ledger\.set)/;

function run(context, options) {
  const ignore = options.ignore || [];

  const results = [];
  for (const file of context.changes) {
    if (file.status === "deleted") continue;
    if (!isTestPath(file.path)) continue;
    if (matchesAny(file.path, ignore)) continue;

    for (const { line, text } of file.added) {
      if (FROZEN.test(text)) continue;
      if (!CLOCK.test(text)) continue;
      if (!ASSERTION.test(text)) continue;

      results.push(
        violation(RULE, {
          path: file.path,
          line,
          message:
            `${file.path}:${line} asserts against the current wall clock ` +
            `(${text.trim()}). This test will start failing on a day nobody changed the code.`,
          remediationHint:
            `Freeze time (jest.useFakeTimers / jest.setSystemTime, or an injected clock) and ` +
            `assert against the frozen value.`,
          evidence: text.trim(),
        })
      );
    }
  }
  return results;
}

module.exports = { RULE, run };
