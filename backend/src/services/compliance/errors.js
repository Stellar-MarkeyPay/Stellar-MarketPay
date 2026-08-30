"use strict";

function complianceError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assertCompliance(condition, status, code, message, details) {
  if (!condition) throw complianceError(status, code, message, details);
}

module.exports = { complianceError, assertCompliance };
