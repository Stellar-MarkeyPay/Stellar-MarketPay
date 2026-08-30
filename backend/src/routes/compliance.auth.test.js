"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../services/compliance/identityService", () => ({
  startVerification: jest.fn().mockResolvedValue({ session: { id: "session-1" } }),
  getVerificationStatus: jest.fn().mockResolvedValue({ verificationStatus: "unverified" }),
  applyProviderDecision: jest.fn().mockResolvedValue({ screeningRequired: false }),
  checkTransactionLimit: jest.fn().mockResolvedValue({ allowed: true }),
  requestDeletion: jest.fn().mockResolvedValue({ id: "delete-1", status: "requested" }),
  getSubjectByOwner: jest.fn().mockResolvedValue(null),
  requiredFields: jest.fn().mockReturnValue(["fullName"]),
}));
jest.mock("../services/compliance/screeningService", () => ({
  screenSubject: jest.fn().mockResolvedValue({ status: "clear" }),
}));
jest.mock("../services/compliance/monitoringService", () => ({
  recordAndEvaluateTransfer: jest.fn().mockResolvedValue({ idempotentReplay: false }),
  getTransaction: jest.fn().mockResolvedValue({ id: "tx-1" }),
}));
jest.mock("../services/compliance/travelRuleService", () => ({
  verifySelfHostedWallet: jest.fn().mockResolvedValue({ status: "self_hosted_verified" }),
  getExchange: jest.fn().mockResolvedValue({ status: "pending" }),
}));
jest.mock("../services/compliance/policyService", () => ({
  publishRuleSet: jest.fn().mockResolvedValue({ version: 2 }),
  listRuleSets: jest.fn().mockResolvedValue([]),
  getApplicableRuleSet: jest.fn().mockResolvedValue({ version: 1 }),
}));
jest.mock("../services/compliance/caseService", () => ({
  listCases: jest.fn().mockResolvedValue([]),
  getCase: jest.fn().mockResolvedValue({ id: "case-1" }),
  updateCase: jest.fn().mockResolvedValue({ id: "case-1", status: "decided" }),
}));
jest.mock("../services/compliance/reportingService", () => ({
  createReport: jest.fn().mockResolvedValue({ id: "report-1" }),
  getRenderedReport: jest.fn().mockResolvedValue({
    metadata: { report_type: "SAR_JSON" },
    content: "{}\n",
  }),
  fileReport: jest.fn().mockResolvedValue({ id: "report-1", status: "filed" }),
}));
jest.mock("../services/compliance/auditService", () => ({
  getAuditTrail: jest.fn().mockResolvedValue([]),
  verifyAuditChain: jest.fn().mockReturnValue(true),
}));
jest.mock("../services/compliance/worker", () => ({
  runComplianceCycle: jest.fn().mockResolvedValue({ screenings: 0 }),
}));

const complianceRouter = require("./compliance");
const sep12Router = require("./sep12");

const app = express();
app.use(express.json());
app.use("/api/compliance", complianceRouter);
app.use("/api/sep12", sep12Router);
app.use((error, req, res, next) => {
  void req;
  void next;
  res.status(error.status || 500).json({ error: error.message });
});

const userToken = jwt.sign({ publicKey: "GUSER", role: "user" }, process.env.JWT_SECRET);
const adminToken = jwt.sign({ publicKey: "GADMIN", role: "admin" }, process.env.JWT_SECRET);

const subjectMutations = [
  ["post", "/api/compliance/identity/sessions", {}],
  ["delete", "/api/compliance/identity", {}],
  ["post", "/api/compliance/transactions", {}],
  ["post", "/api/compliance/transactions/tx-1/self-hosted-wallet", {}],
  ["put", "/api/sep12/customer", {}],
  ["delete", "/api/sep12/customer", {}],
];

const adminMutations = [
  ["post", "/api/compliance/admin/cases/case-1/actions", {}],
  ["post", "/api/compliance/admin/rules", {}],
  ["post", "/api/compliance/admin/screenings/subject-1", {}],
  ["post", "/api/compliance/admin/reports", {}],
  ["post", "/api/compliance/admin/reports/report-1/file", {}],
  ["post", "/api/compliance/admin/worker/run", {}],
];

describe("compliance authorization matrix", () => {
  it.each([...subjectMutations, ...adminMutations])(
    "%s %s rejects an unauthenticated state change",
    async (method, path, body) => {
      const response = await request(app)[method](path).send(body);
      expect(response.status).toBe(401);
    }
  );

  it.each(adminMutations)("%s %s rejects a non-admin state change", async (method, path, body) => {
    const agent = request(app);
    const response = await agent[method](path)
      .set("Authorization", `Bearer ${userToken}`)
      .send(body);
    expect(response.status).toBe(403);
  });

  it.each(adminMutations)("%s %s reaches the handler for an admin", async (method, path, body) => {
    const agent = request(app);
    const response = await agent[method](path)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(body);
    expect(response.status).toBeLessThan(400);
  });

  it("prevents SEP-12 customer data access for another account", async () => {
    const response = await request(app)
      .get("/api/sep12/customer")
      .set("Authorization", `Bearer ${userToken}`)
      .query({ account: "GOTHER" });
    expect(response.status).toBe(403);
  });
});
