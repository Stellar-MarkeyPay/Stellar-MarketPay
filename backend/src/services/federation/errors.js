"use strict";

class FederationError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "FederationError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function federationError(status, code, message, details) {
  return new FederationError(status, code, message, details);
}

module.exports = { FederationError, federationError };
