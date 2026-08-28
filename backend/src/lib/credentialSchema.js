"use strict";

/**
 * backend/src/lib/credentialSchema.js
 *
 * JSON Schema definitions for each credential type this platform issues.
 * Used for validation at issuance time and by verifiers to check structure.
 */

const CREDENTIAL_SCHEMAS = {
  EngagementCredential: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "EngagementCredential",
    description:
      "Attests that the subject completed a freelance engagement on Stellar MarketPay.",
    type: "object",
    required: ["engagementId", "engagementTitle", "completedAt"],
    properties: {
      engagementId: {
        type: "string",
        description: "Platform engagement/job ID",
      },
      engagementTitle: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        description: "Title of the completed engagement",
      },
      completedAt: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 date when the engagement was completed",
      },
      rating: {
        type: "number",
        minimum: 1,
        maximum: 5,
        description: "Client rating for the freelancer (1-5)",
      },
      budget: {
        type: "number",
        minimum: 0,
        description: "Engagement budget in XLM",
      },
      freelancerSkills: {
        type: "array",
        items: { type: "string" },
        description: "Skills demonstrated in this engagement",
      },
    },
  },

  SkillCredential: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "SkillCredential",
    description:
      "Attests that the subject has a verified skill on Stellar MarketPay.",
    type: "object",
    required: ["skillName", "verifiedAt"],
    properties: {
      skillName: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "Name of the verified skill",
      },
      verifiedAt: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 date when the skill was verified",
      },
      evidenceCount: {
        type: "integer",
        minimum: 1,
        description:
          "Number of engagements used as evidence for this skill verification",
      },
      proficiencyLevel: {
        type: "string",
        enum: ["beginner", "intermediate", "advanced", "expert"],
        description: "Assessed proficiency level",
      },
    },
  },

  CertificationCredential: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "CertificationCredential",
    description:
      "Attests that the subject holds a platform-issued certification.",
    type: "object",
    required: ["certificationName", "certificationId", "issuedAt"],
    properties: {
      certificationName: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Name of the certification",
      },
      certificationId: {
        type: "string",
        description: "Platform-unique certification identifier",
      },
      issuedAt: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 date when the certification was issued",
      },
      expiresAt: {
        type: "string",
        format: "date-time",
        description: "ISO 8601 date when the certification expires (if applicable)",
      },
      criteria: {
        type: "string",
        description: "Description of the criteria met to earn this certification",
      },
    },
  },
};

/**
 * Validate credential claims against the schema for its type.
 * @param {string} typeName - e.g. "EngagementCredential"
 * @param {object} claims - The credential subject claims
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateClaims(typeName, claims) {
  const schema = CREDENTIAL_SCHEMAS[typeName];
  if (!schema) {
    return { valid: false, errors: [`Unknown credential type: ${typeName}`] };
  }

  const errors = [];
  for (const field of schema.required || []) {
    if (claims[field] === undefined || claims[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Get the schema definition for a credential type.
 * @param {string} typeName
 * @returns {object|null}
 */
function getSchema(typeName) {
  return CREDENTIAL_SCHEMAS[typeName] || null;
}

/**
 * List all supported credential type names.
 * @returns {string[]}
 */
function listTypes() {
  return Object.keys(CREDENTIAL_SCHEMAS);
}

module.exports = {
  CREDENTIAL_SCHEMAS,
  validateClaims,
  getSchema,
  listTypes,
};
