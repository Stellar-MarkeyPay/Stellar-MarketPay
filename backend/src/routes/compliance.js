"use strict";

const express = require("express");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  startVerification,
  getVerificationStatus,
  applyProviderDecision,
  checkTransactionLimit,
  requestDeletion,
  getSubjectByOwner,
} = require("../services/compliance/identityService");
const { screenSubject } = require("../services/compliance/screeningService");
const {
  recordAndEvaluateTransfer,
  getTransaction,
} = require("../services/compliance/monitoringService");
const { verifySelfHostedWallet, getExchange } = require("../services/compliance/travelRuleService");
const {
  publishRuleSet,
  listRuleSets,
  getApplicableRuleSet,
} = require("../services/compliance/policyService");
const { listCases, getCase, updateCase } = require("../services/compliance/caseService");
const {
  createReport,
  getRenderedReport,
  fileReport,
} = require("../services/compliance/reportingService");
const { getAuditTrail, verifyAuditChain } = require("../services/compliance/auditService");
const { runComplianceCycle } = require("../services/compliance/worker");
const { complianceError } = require("../services/compliance/errors");
const { requestGeoSignal } = require("../services/compliance/geoSignals");

const router = express.Router();
const subjectLimiter = createRateLimiter(20, 1);
const transactionLimiter = createRateLimiter(60, 1);
const adminLimiter = createRateLimiter(120, 1);

/**
 * @swagger
 * tags:
 *   - name: Compliance
 *     description: Tiered identity, screening, transaction monitoring, Travel Rule, and reporting
 *
 * /api/compliance/identity/sessions:
 *   post:
 *     summary: Start individual or corporate tiered verification
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       201: { description: Verification session created }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/compliance/identity/status:
 *   get:
 *     summary: Get the authenticated subject's verification tier and expiry
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Verification status }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/compliance/limits/check:
 *   post:
 *     summary: Check an amount against the authenticated subject's tier limit
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Explainable limit decision }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 * /api/compliance/transactions:
 *   post:
 *     summary: Record and evaluate a transfer for monitoring, risk, and Travel Rule controls
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Idempotent replay }
 *       201: { description: Compliance decision recorded }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ComplianceDecision:
 *       type: object
 *       properties:
 *         decision: { type: string }
 *         reasonCode: { type: string }
 *         policyVersion: { type: integer }
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ComplianceCase:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         status: { type: string, enum: [open, triaged, investigating, escalated, decided, closed] }
 *         priority: { type: string, enum: [low, medium, high, critical] }
 *         decision: { type: string, nullable: true }
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     TravelRuleStatus:
 *       type: object
 *       properties:
 *         required: { type: boolean }
 *         status: { type: string }
 *         receiptHash: { type: string, nullable: true }
 */

router.post("/identity/sessions", subjectLimiter, verifyJWT, async (req, res, next) => {
  try {
    const result = await startVerification({
      ...req.body,
      ownerAddress: req.user.publicKey,
      correlationId: req.requestId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.get("/identity/status", subjectLimiter, verifyJWT, async (req, res, next) => {
  try {
    const result = await getVerificationStatus(req.user.publicKey);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/identity:
 *   delete:
 *     summary: Request retained-identity deletion
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       202: { description: Deletion workflow accepted }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.delete("/identity", subjectLimiter, verifyJWT, async (req, res, next) => {
  try {
    const result = await requestDeletion(req.user.publicKey, { correlationId: req.requestId });
    return res.status(202).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/identity/provider-webhook:
 *   post:
 *     summary: Apply a signature-verified KYC provider decision
 *     tags: [Compliance]
 *     parameters:
 *       - in: header
 *         name: X-Provider-Signature
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Provider decision accepted idempotently }
 *       401: { description: Invalid provider signature }
 */
router.post("/identity/provider-webhook", subjectLimiter, async (req, res, next) => {
  try {
    const result = await applyProviderDecision(
      {
        payload: req.body,
        signature: req.get("x-provider-signature"),
        correlationId: req.requestId,
      },
      { rawBody: req.rawBody || JSON.stringify(req.body) }
    );
    if (result.screeningRequired) {
      await screenSubject(result.subjectId, "onboarding", {
        correlationId: req.requestId,
        actor: "identity-provider-webhook",
      });
    }
    return res.json({ success: true, data: { accepted: true } });
  } catch (error) {
    return next(error);
  }
});

router.post("/limits/check", subjectLimiter, verifyJWT, async (req, res, next) => {
  try {
    const result = await checkTransactionLimit(req.user.publicKey, req.body);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post("/transactions", transactionLimiter, verifyJWT, async (req, res, next) => {
  try {
    const geoSignal = requestGeoSignal(req);
    const result = await recordAndEvaluateTransfer(req.user.publicKey, {
      ...req.body,
      ipCountry: geoSignal.ipCountry,
      ipConfidence: geoSignal.ipConfidence,
      proxyDetected: geoSignal.proxyDetected,
      geoSignalSource: geoSignal.source,
      ipAuditToken: geoSignal.ipAuditToken,
      correlationId: req.requestId,
    });
    return res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/transactions/{transactionId}:
 *   get:
 *     summary: Get the authenticated originator's compliance decision
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Transaction compliance status }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/transactions/:transactionId",
  transactionLimiter,
  verifyJWT,
  async (req, res, next) => {
    try {
      const result = await getTransaction(req.params.transactionId, req.user.publicKey);
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @swagger
 * /api/compliance/transactions/{transactionId}/self-hosted-wallet:
 *   post:
 *     summary: Record self-hosted wallet-control evidence
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Wallet-control evidence recorded }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  "/transactions/:transactionId/self-hosted-wallet",
  transactionLimiter,
  verifyJWT,
  async (req, res, next) => {
    try {
      await getTransaction(req.params.transactionId, req.user.publicKey);
      const result = await verifySelfHostedWallet(
        req.params.transactionId,
        { ...req.body, correlationId: req.requestId },
        req.user.publicKey
      );
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @swagger
 * /api/compliance/transactions/{transactionId}/travel-rule:
 *   get:
 *     summary: Get Travel Rule exchange state without encrypted payload data
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Travel Rule status and receipt references }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/transactions/:transactionId/travel-rule",
  transactionLimiter,
  verifyJWT,
  async (req, res, next) => {
    try {
      await getTransaction(req.params.transactionId, req.user.publicKey);
      const result = await getExchange(req.params.transactionId);
      if (!result)
        throw complianceError(404, "EXCHANGE_NOT_FOUND", "Travel Rule exchange not found");
      return res.json({ success: true, data: result });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @swagger
 * /api/compliance/audit:
 *   get:
 *     summary: Get and verify the authenticated subject's compliance audit chain
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Ordered audit events and chain validity }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/audit", subjectLimiter, verifyJWT, async (req, res, next) => {
  try {
    const subject = await getSubjectByOwner(req.user.publicKey);
    if (!subject) return res.json({ success: true, data: { events: [], chainValid: true } });
    const events = await getAuditTrail(subject.id);
    return res.json({ success: true, data: { events, chainValid: verifyAuditChain(events) } });
  } catch (error) {
    return next(error);
  }
});

router.use("/admin", adminLimiter, verifyJWT, requireAdminRole);

/**
 * @swagger
 * /api/compliance/admin/cases:
 *   get:
 *     summary: List the human compliance review queue
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Prioritized case queue }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/cases", async (req, res, next) => {
  try {
    const result = await listCases(req.query);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/cases/{caseId}:
 *   get:
 *     summary: Get alerts and recorded events for one case
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "Case, alerts, and event history" }
 */
router.get("/admin/cases/:caseId", async (req, res, next) => {
  try {
    return res.json({ success: true, data: await getCase(req.params.caseId) });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/cases/{caseId}/actions:
 *   post:
 *     summary: Record an analyst transition or human disposition
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Audited case state }
 *       409: { description: Illegal case transition }
 */
router.post("/admin/cases/:caseId/actions", async (req, res, next) => {
  try {
    const result = await updateCase(
      req.params.caseId,
      { ...req.body, correlationId: req.requestId },
      req.user.publicKey
    );
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/rules:
 *   get:
 *     summary: List versioned jurisdiction policies
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Rule-set versions }
 */
router.get("/admin/rules", async (req, res, next) => {
  try {
    return res.json({ success: true, data: await listRuleSets(req.query.jurisdiction) });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/rules/effective/{jurisdiction}:
 *   get:
 *     summary: Resolve the effective policy for a jurisdiction and instant
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: jurisdiction
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Exact effective policy version }
 */
router.get("/admin/rules/effective/:jurisdiction", async (req, res, next) => {
  try {
    return res.json({
      success: true,
      data: await getApplicableRuleSet(req.params.jurisdiction, req.query.at || new Date()),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/rules:
 *   post:
 *     summary: Publish a four-eyes-reviewed effective policy without deployment
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: New policy version published }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post("/admin/rules", async (req, res, next) => {
  try {
    const result = await publishRuleSet(req.body, req.user.publicKey);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/screenings/{subjectId}:
 *   post:
 *     summary: Run and audit an immediate sanctions/PEP screening
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: subjectId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Screening result and generated cases }
 */
router.post("/admin/screenings/:subjectId", async (req, res, next) => {
  try {
    const result = await screenSubject(req.params.subjectId, "manual", {
      actor: req.user.publicKey,
      correlationId: req.requestId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/reports:
 *   post:
 *     summary: Generate an encrypted jurisdiction report after human decision
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Deterministic report draft created }
 *       409: { description: Human case decision required }
 */
router.post("/admin/reports", async (req, res, next) => {
  try {
    const result = await createReport(
      req.body.caseId,
      { ...req.body, correlationId: req.requestId },
      req.user.publicKey
    );
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/reports/{reportId}/content:
 *   get:
 *     summary: Integrity-check and render a report for analyst review
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: SAR JSON or XML content }
 */
router.get("/admin/reports/:reportId/content", async (req, res, next) => {
  try {
    const result = await getRenderedReport(req.params.reportId, req.user.publicKey);
    res.type(result.metadata.report_type === "SAR_XML" ? "application/xml" : "application/json");
    return res.send(result.content);
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/reports/{reportId}/file:
 *   post:
 *     summary: File an approved report and retain its regulator reference
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Filing receipt recorded }
 */
router.post("/admin/reports/:reportId/file", async (req, res, next) => {
  try {
    const result = await fileReport(req.params.reportId, req.body, req.user.publicKey);
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * @swagger
 * /api/compliance/admin/worker/run:
 *   post:
 *     summary: Run one bounded expiry, re-screening, and retry cycle
 *     tags: [Compliance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Worker cycle counts }
 */
router.post("/admin/worker/run", async (req, res, next) => {
  try {
    return res.json({ success: true, data: await runComplianceCycle({ limit: req.body.limit }) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
