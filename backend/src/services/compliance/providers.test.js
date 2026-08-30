"use strict";

const crypto = require("crypto");
const {
  HttpKycProvider,
  ReferenceKycProvider,
  ReferenceScreeningProvider,
  ReferenceTravelRuleProvider,
} = require("./providers");

describe("compliance provider contracts", () => {
  it("verifies HTTP provider webhooks with timing-safe HMAC and normalizes decisions", () => {
    const provider = new HttpKycProvider({
      name: "fixture-kyc",
      baseURL: "https://provider.invalid",
      webhookSecret: "webhook-secret",
    });
    const body = JSON.stringify({ sessionId: "session-1", status: "verified", tier: 2 });
    const signature = crypto.createHmac("sha256", "webhook-secret").update(body).digest("hex");

    expect(provider.verifyWebhook(body, `sha256=${signature}`)).toBe(true);
    expect(provider.verifyWebhook(body, `sha256=${"0".repeat(64)}`)).toBe(false);
    expect(provider.normalizeWebhook(JSON.parse(body))).toMatchObject({
      providerSessionRef: "session-1",
      status: "verified",
      tier: 2,
    });
  });

  it("keeps deterministic reference adapters within the same normalized contract", async () => {
    const kyc = new ReferenceKycProvider();
    const screening = new ReferenceScreeningProvider();
    const travelRule = new ReferenceTravelRuleProvider();

    await expect(kyc.createSession({ requestedTier: 2 })).resolves.toMatchObject({
      provider: "reference-kyc",
      status: "pending",
      documentStatus: "required",
      livenessStatus: "required",
    });
    await expect(screening.screen({ subjectRef: "subject-1" })).resolves.toMatchObject({
      status: "clear",
      matches: [],
    });
    await expect(travelRule.discover("counterparty-fi")).resolves.toMatchObject({
      reachable: true,
    });
  });
});
