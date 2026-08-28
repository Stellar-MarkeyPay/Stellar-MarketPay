"use strict";

const express = require("express");
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  requiredFields,
  startVerification,
  getVerificationStatus,
  requestDeletion,
} = require("../services/compliance/identityService");
const { complianceError } = require("../services/compliance/errors");

const router = express.Router();
const limiter = createRateLimiter(30, 1);

function assertOwnAccount(req) {
  const account = req.body?.account || req.query?.account;
  if (account && account !== req.user.publicKey) {
    throw complianceError(
      403,
      "SEP12_ACCOUNT_MISMATCH",
      "SEP-12 account must match the authenticated account"
    );
  }
  return req.user.publicKey;
}

function sep12Status(status) {
  return (
    {
      unverified: "NEEDS_INFO",
      pending: "PENDING",
      needs_input: "NEEDS_INFO",
      verified: "ACCEPTED",
      expired: "NEEDS_INFO",
      rejected: "REJECTED",
    }[status] || "NEEDS_INFO"
  );
}

function canonicalIdentity(body, subjectType) {
  if (subjectType === "corporate") {
    return {
      companyName: body.organization_name || body.companyName,
      registrationNumber: body.organization_registration_number || body.registrationNumber,
      registeredAddress: body.organization_address || body.registeredAddress,
      incorporationCountry: String(
        body.organization_country || body.country_code || ""
      ).toUpperCase(),
      directors: body.directors || [],
      beneficialOwners: body.beneficial_owners || body.beneficialOwners || [],
      authorityToAct: body.authority_to_act || body.authorityToAct,
      sourceOfFunds: body.source_of_funds || body.sourceOfFunds,
    };
  }
  return {
    fullName:
      body.full_name ||
      [body.first_name, body.middle_name, body.last_name].filter(Boolean).join(" "),
    dateOfBirth: body.birth_date || body.dateOfBirth,
    residentialAddress: body.address || body.residentialAddress,
    countryCode: String(body.country_code || body.countryCode || "").toUpperCase(),
    governmentId: body.id_type
      ? { type: body.id_type, number: body.id_number || null }
      : body.governmentId,
    liveness: body.liveness || null,
    sourceOfFunds: body.source_of_funds || body.sourceOfFunds,
    taxResidence: body.tax_residence || body.taxResidence,
  };
}

/**
 * @swagger
 * /api/sep12/info:
 *   get:
 *     summary: SEP-12 customer field requirements supported by MarketPay
 *     tags: [Compliance]
 *     responses:
 *       200: { description: SEP-12 field definitions }
 * /api/sep12/customer:
 *   get:
 *     summary: Get SEP-12 customer status
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: SEP-12 customer status }
 *   put:
 *     summary: Submit or update SEP-12 customer information
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       202: { description: Verification pending }
 *   delete:
 *     summary: Request deletion of SEP-12 customer information
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       202: { description: Deletion workflow accepted }
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Sep12CustomerStatus:
 *       type: string
 *       enum: [NEEDS_INFO, PENDING, ACCEPTED, REJECTED]
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Sep12Field:
 *       type: object
 *       properties:
 *         description: { type: string }
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Sep12DeletionStatus:
 *       type: string
 *       enum: [REQUESTED, RETAINED, PROVIDER_PENDING, DELETING, COMPLETED, REJECTED]
 */

router.get("/info", limiter, (req, res) => {
  void req;
  return res.json({
    types: {
      individual: { fields: requiredFields("individual", 2) },
      organization: { fields: requiredFields("corporate", 3) },
    },
  });
});

router.get("/customer", limiter, verifyJWT, async (req, res, next) => {
  try {
    const ownerAddress = assertOwnAccount(req);
    const status = await getVerificationStatus(ownerAddress);
    const verificationStatus = status.verificationStatus || "unverified";
    const response = {
      id: status.id || null,
      status: sep12Status(verificationStatus),
      provided_fields: status.activeSession?.provided_fields || [],
    };
    if (["unverified", "needs_input", "expired"].includes(verificationStatus)) {
      response.fields = Object.fromEntries(
        requiredFields(
          status.subjectType || "individual",
          Math.max(1, status.verificationTier || 1)
        ).map((field) => [field, { description: field }])
      );
    }
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.put("/customer", limiter, verifyJWT, async (req, res, next) => {
  try {
    const ownerAddress = assertOwnAccount(req);
    const subjectType = req.body.type === "organization" ? "corporate" : "individual";
    const requestedTier = Number(req.body.requested_tier || (subjectType === "corporate" ? 3 : 2));
    const result = await startVerification({
      ownerAddress,
      subjectType,
      requestedTier,
      identity: canonicalIdentity(req.body, subjectType),
      idempotencyKey: req.get("idempotency-key"),
      correlationId: req.requestId,
    });
    return res.status(202).json({ id: result.session.id, status: "PENDING" });
  } catch (error) {
    return next(error);
  }
});

router.delete("/customer", limiter, verifyJWT, async (req, res, next) => {
  try {
    const result = await requestDeletion(assertOwnAccount(req), { correlationId: req.requestId });
    return res.status(202).json({ id: result.id, status: result.status.toUpperCase() });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
