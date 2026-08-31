"use strict";

const { federationError } = require("./errors");
const { requireOpaqueValue } = require("./security");

const PROTOCOLS = Object.freeze(["saml", "oidc"]);
const ATTRIBUTE_TARGETS = Object.freeze([
  "email",
  "displayName",
  "firstName",
  "lastName",
  "groups",
  "role",
]);
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readAttributePath(attributes, path) {
  const segments = String(path || "").split(".");
  if (
    segments.length === 0 ||
    segments.length > 8 ||
    segments.some((segment) => !segment || FORBIDDEN_PATH_SEGMENTS.has(segment))
  ) {
    throw federationError(400, "INVALID_ATTRIBUTE_MAPPING", "Attribute path is invalid");
  }

  let current = attributes;
  for (const segment of segments) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function normalizeString(value, field, maxLength) {
  if (value == null || value === "") return undefined;
  if (!["string", "number", "boolean"].includes(typeof value)) {
    throw federationError(400, "INVALID_ATTRIBUTE_VALUE", `${field} must be a scalar value`);
  }
  return requireOpaqueValue(String(value).normalize("NFC").trim(), field, maxLength);
}

function mapFederatedAttributes(attributes, mapping) {
  if (!isPlainObject(attributes) || !isPlainObject(mapping)) {
    throw federationError(
      400,
      "INVALID_ATTRIBUTE_MAPPING",
      "Federated attributes and attribute mapping must be objects"
    );
  }

  for (const target of Object.keys(mapping)) {
    if (!ATTRIBUTE_TARGETS.includes(target)) {
      throw federationError(400, "INVALID_ATTRIBUTE_TARGET", `Unsupported target ${target}`);
    }
  }

  const mapped = {};
  for (const target of ATTRIBUTE_TARGETS) {
    if (!mapping[target]) continue;
    if (typeof mapping[target] !== "string") {
      throw federationError(400, "INVALID_ATTRIBUTE_MAPPING", "Attribute path must be a string");
    }
    const value = readAttributePath(attributes, mapping[target]);
    if (value == null) continue;

    if (target === "groups") {
      const groups = Array.isArray(value) ? value : [value];
      mapped.groups = [
        ...new Set(
          groups
            .slice(0, 200)
            .map((group) => normalizeString(group, "group", 256))
            .filter(Boolean)
        ),
      ];
      continue;
    }

    const maxLength = target === "email" ? 320 : 256;
    mapped[target] = normalizeString(value, target, maxLength);
  }

  if (mapped.email) mapped.email = mapped.email.toLocaleLowerCase("en-US");
  return mapped;
}

function parseInstant(value, field) {
  const instant = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw federationError(400, "INVALID_FEDERATED_PRINCIPAL", `${field} is invalid`);
  }
  return instant;
}

function normalizeFederatedPrincipal(input) {
  if (!isPlainObject(input) || !PROTOCOLS.includes(input.protocol)) {
    throw federationError(400, "INVALID_FEDERATED_PRINCIPAL", "Protocol must be saml or oidc");
  }

  const issuedAt = parseInstant(input.issuedAt, "issuedAt");
  const expiresAt = parseInstant(input.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt) {
    throw federationError(400, "INVALID_FEDERATED_PRINCIPAL", "expiresAt must follow issuedAt");
  }

  return Object.freeze({
    protocol: input.protocol,
    organisationId: requireOpaqueValue(input.organisationId, "organisationId", 128),
    providerId: requireOpaqueValue(input.providerId, "providerId", 128),
    issuer: requireOpaqueValue(input.issuer, "issuer", 2048),
    subject: requireOpaqueValue(input.subject, "subject"),
    responseId: requireOpaqueValue(input.responseId, "responseId", 2048),
    assertionId: input.assertionId
      ? requireOpaqueValue(input.assertionId, "assertionId", 2048)
      : undefined,
    audience: requireOpaqueValue(input.audience, "audience", 2048),
    issuedAt,
    expiresAt,
    authenticationContext: normalizeString(
      input.authenticationContext,
      "authenticationContext",
      2048
    ),
    attributes: isPlainObject(input.attributes) ? Object.freeze({ ...input.attributes }) : {},
  });
}

function assertProviderAdapter(adapter, expectedProtocol) {
  const requiredMethods = ["buildAuthenticationRequest", "consumeAuthenticationResponse"];
  if (!adapter || adapter.protocol !== expectedProtocol || !PROTOCOLS.includes(expectedProtocol)) {
    throw federationError(500, "INVALID_PROVIDER_ADAPTER", "Provider adapter protocol mismatch");
  }
  for (const method of requiredMethods) {
    if (typeof adapter[method] !== "function") {
      throw federationError(500, "INVALID_PROVIDER_ADAPTER", `Provider adapter lacks ${method}`);
    }
  }
  return adapter;
}

module.exports = {
  ATTRIBUTE_TARGETS,
  PROTOCOLS,
  assertProviderAdapter,
  isPlainObject,
  mapFederatedAttributes,
  normalizeFederatedPrincipal,
  readAttributePath,
};
