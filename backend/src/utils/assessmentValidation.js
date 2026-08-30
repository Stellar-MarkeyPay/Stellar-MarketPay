/**
 * src/utils/assessmentValidation.js
 * Application-level validation for assessment authoring input, ahead of the
 * matching database CHECK constraints (V16__assessment_authoring).
 */
"use strict";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DIFFICULTIES = ["beginner", "intermediate", "advanced"];

function isIntInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validateSkillConfig(body) {
  if (body.passScore !== undefined && !isIntInRange(body.passScore, 0, 100)) {
    return "passScore must be an integer between 0 and 100";
  }
  if (body.durationSeconds !== undefined && !isIntInRange(body.durationSeconds, 1, 86400)) {
    return "durationSeconds must be a positive integer (max 86400)";
  }
  if (body.cooldownDays !== undefined && !isIntInRange(body.cooldownDays, 0, 3650)) {
    return "cooldownDays must be a non-negative integer";
  }
  if (
    body.questionsPerAttempt !== undefined &&
    body.questionsPerAttempt !== null &&
    !isIntInRange(body.questionsPerAttempt, 1, 500)
  ) {
    return "questionsPerAttempt must be a positive integer or null";
  }
  return null;
}

function validateSkillInput(body = {}) {
  if (typeof body.slug !== "string" || !SLUG_RE.test(body.slug)) {
    return "slug must be 2-40 lowercase letters, numbers, or hyphens";
  }
  if (typeof body.label !== "string" || body.label.trim().length === 0) {
    return "label is required";
  }
  return validateSkillConfig(body);
}

function validateQuestionInput(body = {}) {
  if (typeof body.questionText !== "string" || body.questionText.trim().length === 0) {
    return "questionText is required";
  }
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 6) {
    return "options must be an array of 2-6 strings";
  }
  if (!body.options.every((opt) => typeof opt === "string" && opt.trim().length > 0)) {
    return "each option must be a non-empty string";
  }
  if (
    !Number.isInteger(body.correctOptionIndex) ||
    body.correctOptionIndex < 0 ||
    body.correctOptionIndex >= body.options.length
  ) {
    return "correctOptionIndex must be a valid index into options";
  }
  if (body.difficulty !== undefined && !DIFFICULTIES.includes(body.difficulty)) {
    return `difficulty must be one of: ${DIFFICULTIES.join(", ")}`;
  }
  if (
    body.tags !== undefined &&
    (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === "string"))
  ) {
    return "tags must be an array of strings";
  }
  return null;
}

module.exports = { validateSkillInput, validateSkillConfig, validateQuestionInput, DIFFICULTIES };
