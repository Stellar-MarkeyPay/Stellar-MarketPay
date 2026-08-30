"use strict";

const { randomUUID } = require("crypto");
const axios = require("axios");
const pool = require("../../db/pool");
const { getCryptoVault } = require("./cryptoVault");
const { getCase } = require("./caseService");
const { getApplicableRuleSet } = require("./policyService");
const { appendAuditEvent } = require("./auditService");
const { canonicalize, sha256 } = require("./canonical");
const { assertCompliance, complianceError } = require("./errors");

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderReport(reportType, body) {
  if (reportType === "SAR_JSON") return `${canonicalize(body)}\n`;
  if (reportType === "SAR_XML") {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<SuspiciousActivityReport schemaVersion="1">',
      `  <ReportId>${escapeXml(body.reportId)}</ReportId>`,
      `  <Jurisdiction>${escapeXml(body.jurisdiction)}</Jurisdiction>`,
      `  <SubjectReference>${escapeXml(body.subjectReference)}</SubjectReference>`,
      `  <CaseReference>${escapeXml(body.caseReference)}</CaseReference>`,
      `  <Decision>${escapeXml(body.decision)}</Decision>`,
      `  <Narrative>${escapeXml(body.narrative)}</Narrative>`,
      `  <EvidenceHash>${escapeXml(body.evidenceHash)}</EvidenceHash>`,
      `  <PreparedAt>${escapeXml(body.preparedAt)}</PreparedAt>`,
      "</SuspiciousActivityReport>",
      "",
    ].join("\n");
  }
  throw complianceError(400, "UNSUPPORTED_REPORT_FORMAT", "Unsupported report format");
}

async function createReport(caseId, input, actor, options = {}) {
  const db = options.db || pool;
  const vault = options.vault || getCryptoVault();
  const complianceCase = await getCase(caseId, db);
  assertCompliance(
    complianceCase.decision === "file_report" || complianceCase.status === "decided",
    409,
    "CASE_DECISION_REQUIRED",
    "A recorded human decision is required before report generation"
  );
  const subjectResult = await db.query("SELECT * FROM compliance_subjects WHERE id = $1", [
    complianceCase.subject_id,
  ]);
  const subject = subjectResult.rows[0];
  const policy = await getApplicableRuleSet(
    input.jurisdiction || subject.country_code || "DEFAULT",
    new Date(),
    db
  );
  const reportType = input.reportType || policy.rules.reports[0];
  assertCompliance(
    policy.rules.reports.includes(reportType),
    400,
    "REPORT_NOT_ALLOWED",
    "Report format is not enabled by jurisdiction policy"
  );
  const transactionResult = await db.query(
    `SELECT id, amount, asset, beneficiary_address, occurred_at, status
       FROM compliance_transactions
      WHERE originator_subject_id = $1
      ORDER BY occurred_at DESC
      LIMIT 100`,
    [subject.id]
  );
  const evidenceHash = sha256({
    alerts: complianceCase.alerts.map((alert) => ({ id: alert.id, evidence: alert.evidence })),
    events: complianceCase.events,
    transactions: transactionResult.rows,
  });
  const reportId = randomUUID();
  const body = {
    reportId,
    reportType,
    jurisdiction: policy.jurisdiction,
    subjectReference: subject.id,
    subjectType: subject.subject_type,
    caseReference: complianceCase.id,
    decision: complianceCase.decision,
    narrative: String(input.narrative || complianceCase.decision_reason || "").trim(),
    activity: transactionResult.rows,
    evidenceHash,
    policyVersion: policy.version,
    preparedAt: new Date().toISOString(),
    preparedBy: actor,
  };
  assertCompliance(
    body.narrative.length >= 20,
    400,
    "NARRATIVE_REQUIRED",
    "Report narrative is too short"
  );
  const rendered = renderReport(reportType, body);
  const context = { reportId, recordType: "regulatory-report", schemaVersion: 1 };
  const envelope = vault.encrypt({ body, rendered }, context);
  const contentHash = sha256(rendered);
  const { rows } = await db.query(
    `INSERT INTO compliance_reports (
       id, case_id, report_type, jurisdiction, report_envelope, report_key_id,
       renderer_version, content_hash, prepared_by
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'sar-renderer-v1', $7, $8)
     RETURNING id, case_id, report_type, jurisdiction, status, renderer_version,
               content_hash, prepared_by, created_at`,
    [
      reportId,
      caseId,
      reportType,
      policy.jurisdiction,
      JSON.stringify(envelope),
      envelope.keyId,
      contentHash,
      actor,
    ]
  );
  await appendAuditEvent(
    {
      subjectId: subject.id,
      actorType: "analyst",
      actorId: actor,
      action: "report.generated",
      objectType: "compliance_report",
      objectId: reportId,
      correlationId: input.correlationId || randomUUID(),
      policyJurisdiction: policy.jurisdiction,
      policyVersion: policy.version,
      reasonCode: reportType,
      decision: "draft",
      evidenceHash: contentHash,
      metadata: { caseId, rendererVersion: "sar-renderer-v1" },
    },
    db
  );
  return rows[0];
}

async function getRenderedReport(reportId, actor, options = {}) {
  const db = options.db || pool;
  const vault = options.vault || getCryptoVault();
  const { rows } = await db.query("SELECT * FROM compliance_reports WHERE id = $1", [reportId]);
  const report = rows[0];
  if (!report) throw complianceError(404, "REPORT_NOT_FOUND", "Compliance report not found");
  const decrypted = vault.decrypt(report.report_envelope, {
    reportId: report.id,
    recordType: "regulatory-report",
    schemaVersion: 1,
  });
  assertCompliance(
    sha256(decrypted.rendered) === report.content_hash,
    500,
    "REPORT_INTEGRITY_FAILED",
    "Stored report failed its integrity check"
  );
  await appendAuditEvent(
    {
      subjectId: null,
      actorType: "analyst",
      actorId: actor,
      action: "report.accessed",
      objectType: "compliance_report",
      objectId: reportId,
      correlationId: randomUUID(),
      reasonCode: "REPORT_REVIEW",
      decision: "read",
      evidenceHash: report.content_hash,
      metadata: {},
    },
    db
  );
  return { metadata: report, content: decrypted.rendered };
}

async function fileReport(reportId, input, actor, options = {}) {
  const db = options.db || pool;
  const report = await getRenderedReport(reportId, actor, options);
  const endpoint = options.reportingUrl || process.env.REGULATORY_REPORTING_URL;
  let filingReference = input.filingReference || null;
  if (endpoint) {
    const response = await axios.post(endpoint, report.content, {
      headers: {
        "Content-Type":
          report.metadata.report_type === "SAR_XML" ? "application/xml" : "application/json",
        Authorization: process.env.REGULATORY_REPORTING_API_KEY
          ? `Bearer ${process.env.REGULATORY_REPORTING_API_KEY}`
          : undefined,
        "Idempotency-Key": reportId,
      },
      timeout: 15000,
    });
    filingReference = response.data?.reference || response.headers["x-filing-reference"];
  }
  assertCompliance(
    filingReference,
    400,
    "FILING_REFERENCE_REQUIRED",
    "A filing reference is required"
  );
  const { rows } = await db.query(
    `UPDATE compliance_reports
        SET status = 'filed', approved_by = $2, filing_reference = $3,
            filed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'approved')
      RETURNING id, case_id, report_type, jurisdiction, status, content_hash,
                filing_reference, approved_by, filed_at`,
    [reportId, actor, filingReference]
  );
  if (!rows[0]) throw complianceError(409, "REPORT_ALREADY_FINAL", "Report is already final");
  const subjectResult = await db.query(
    `SELECT c.subject_id
       FROM compliance_cases c
      WHERE c.id = $1`,
    [rows[0].case_id]
  );
  await appendAuditEvent(
    {
      subjectId: subjectResult.rows[0]?.subject_id || null,
      actorType: "analyst",
      actorId: actor,
      action: "report.filed",
      objectType: "compliance_report",
      objectId: reportId,
      correlationId: input.correlationId || randomUUID(),
      policyJurisdiction: rows[0].jurisdiction,
      reasonCode: "REGULATORY_FILING",
      decision: "filed",
      evidenceHash: rows[0].content_hash,
      metadata: { filingReference },
    },
    db
  );
  return rows[0];
}

module.exports = { renderReport, createReport, getRenderedReport, fileReport };
