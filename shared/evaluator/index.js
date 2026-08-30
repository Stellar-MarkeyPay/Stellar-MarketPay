/**
 * shared/evaluator/index.js
 * CommonJS entry point for the shared flag evaluator.
 * Used by backend services via require("../../../shared/evaluator").
 */
"use strict";

const evaluator = require("./evaluator");

module.exports = {
  fnv1a: evaluator.fnv1a,
  percentageBucket: evaluator.percentageBucket,
  evaluateFlag: evaluator.evaluateFlag,
  evaluateFlags: evaluator.evaluateFlags,
};
