"use strict";

const crypto = require("crypto");
const axios = require("axios");
const { randomUUID } = require("crypto");
const { canonicalize, sha256 } = require("./canonical");
const { complianceError } = require("./errors");

class ReferenceKycProvider {
  constructor() {
    this.name = "reference-kyc";
  }

  async createSession(input) {
    return {
      provider: this.name,
      reference: randomUUID(),
      status: "pending",
      documentStatus: input.requestedTier >= 2 ? "required" : "not_required",
      livenessStatus: input.requestedTier >= 2 ? "required" : "not_required",
      redirectUrl: null,
    };
  }

  async deleteSubject() {
    return { accepted: true, reference: randomUUID() };
  }

  verifyWebhook(rawBody, signature) {
    return Boolean(rawBody && signature === "reference-valid");
  }

  normalizeWebhook(payload) {
    return payload;
  }
}

class ReferenceScreeningProvider {
  constructor() {
    this.name = "reference-screening";
  }

  async screen(input) {
    return {
      provider: this.name,
      reference: randomUUID(),
      status: "clear",
      listVersion: `reference-${new Date().toISOString().slice(0, 10)}`,
      matches: [],
      resultHash: sha256({ subjectRef: input.subjectRef, status: "clear", matches: [] }),
    };
  }
}

class ReferenceOnchainProvider {
  constructor() {
    this.name = "reference-onchain";
  }

  async assessAddress(address) {
    return {
      provider: this.name,
      address,
      score: 0,
      categories: [],
      evidenceHash: sha256({ address, score: 0, categories: [] }),
    };
  }
}

class ReferenceTravelRuleProvider {
  constructor() {
    this.name = "reference-travel-rule";
  }

  async discover(institution) {
    return institution
      ? { reachable: true, endpoint: `reference://${institution}` }
      : { reachable: false };
  }

  async send(input) {
    return {
      provider: this.name,
      reference: randomUUID(),
      status: "sent",
      receiptHash: sha256({ transactionId: input.transactionId, payload: input.payload }),
    };
  }
}

class HttpComplianceProvider {
  constructor({ name, baseURL, apiKey, webhookSecret, timeoutMs = 10000 }) {
    if (!baseURL) throw new Error(`${name} baseURL is required`);
    this.name = name;
    this.webhookSecret = webhookSecret;
    this.client = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: { Authorization: apiKey ? `Bearer ${apiKey}` : undefined },
    });
  }

  async request(method, path, data, idempotencyKey) {
    try {
      const response = await this.client.request({
        method,
        url: path,
        data,
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      });
      return response.data;
    } catch (error) {
      throw complianceError(502, "PROVIDER_ERROR", `${this.name} request failed`, {
        providerStatus: error.response?.status || null,
      });
    }
  }

  verifyWebhook(rawBody, signature) {
    if (!this.webhookSecret || !signature) return false;
    const expected = crypto.createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const received = String(signature).replace(/^sha256=/, "");
    return (
      expected.length === received.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
    );
  }
}

class HttpKycProvider extends HttpComplianceProvider {
  async createSession(input) {
    const data = await this.request("post", "/verification-sessions", input, input.idempotencyKey);
    return {
      provider: this.name,
      reference: data.id,
      status: data.status || "pending",
      documentStatus: data.documentStatus || "required",
      livenessStatus: data.livenessStatus || "required",
      redirectUrl: data.redirectUrl || null,
    };
  }

  async deleteSubject(providerCustomerRef) {
    const data = await this.request(
      "delete",
      `/customers/${encodeURIComponent(providerCustomerRef)}`
    );
    return { accepted: true, reference: data.reference || providerCustomerRef };
  }

  normalizeWebhook(payload) {
    return {
      providerSessionRef: payload.sessionId,
      providerCustomerRef: payload.customerId || null,
      status: payload.status,
      tier: payload.tier,
      countryCode: payload.countryCode,
      legalName: payload.legalName,
      documentStatus: payload.documentStatus,
      livenessStatus: payload.livenessStatus,
      reasons: payload.reasons || [],
      resultHash: sha256(payload),
    };
  }
}

class HttpScreeningProvider extends HttpComplianceProvider {
  async screen(input) {
    const data = await this.request("post", "/screenings", input, input.idempotencyKey);
    const normalized = {
      provider: this.name,
      reference: data.id,
      status: data.status,
      listVersion: data.listVersion || null,
      matches: (data.matches || []).map((match) => ({
        category: match.category,
        listName: match.listName,
        matchScore: Number(match.score),
        matchedNameMasked: match.maskedName || null,
        providerMatchRef: match.id || null,
        evidence: match.evidence || {},
      })),
    };
    return { ...normalized, resultHash: sha256(normalized) };
  }
}

class HttpOnchainProvider extends HttpComplianceProvider {
  async assessAddress(address) {
    const data = await this.request("post", "/addresses/assess", { address });
    const normalized = {
      provider: this.name,
      address,
      score: Number(data.score) || 0,
      categories: data.categories || [],
    };
    return { ...normalized, evidenceHash: sha256(normalized) };
  }
}

class HttpTravelRuleProvider extends HttpComplianceProvider {
  async discover(institution) {
    return this.request("get", `/institutions/${encodeURIComponent(institution)}`);
  }

  async send(input) {
    const data = await this.request("post", "/transfers", input, input.transactionId);
    return {
      provider: this.name,
      reference: data.id,
      status: data.status || "sent",
      receiptHash: data.receiptHash || sha256(canonicalize(data)),
    };
  }
}

function createComplianceProviders(env = process.env) {
  const kyc = env.KYC_PROVIDER_URL
    ? new HttpKycProvider({
        name: env.KYC_PROVIDER_NAME || "kyc-http",
        baseURL: env.KYC_PROVIDER_URL,
        apiKey: env.KYC_PROVIDER_API_KEY,
        webhookSecret: env.KYC_PROVIDER_WEBHOOK_SECRET,
      })
    : new ReferenceKycProvider();
  const screening = env.SCREENING_PROVIDER_URL
    ? new HttpScreeningProvider({
        name: env.SCREENING_PROVIDER_NAME || "screening-http",
        baseURL: env.SCREENING_PROVIDER_URL,
        apiKey: env.SCREENING_PROVIDER_API_KEY,
      })
    : new ReferenceScreeningProvider();
  const onchain = env.ONCHAIN_RISK_PROVIDER_URL
    ? new HttpOnchainProvider({
        name: env.ONCHAIN_RISK_PROVIDER_NAME || "onchain-http",
        baseURL: env.ONCHAIN_RISK_PROVIDER_URL,
        apiKey: env.ONCHAIN_RISK_PROVIDER_API_KEY,
      })
    : new ReferenceOnchainProvider();
  const travelRule = env.TRAVEL_RULE_PROVIDER_URL
    ? new HttpTravelRuleProvider({
        name: env.TRAVEL_RULE_PROVIDER_NAME || "travel-rule-http",
        baseURL: env.TRAVEL_RULE_PROVIDER_URL,
        apiKey: env.TRAVEL_RULE_PROVIDER_API_KEY,
      })
    : new ReferenceTravelRuleProvider();
  return { kyc, screening, onchain, travelRule };
}

module.exports = {
  ReferenceKycProvider,
  ReferenceScreeningProvider,
  ReferenceOnchainProvider,
  ReferenceTravelRuleProvider,
  HttpKycProvider,
  HttpScreeningProvider,
  HttpOnchainProvider,
  HttpTravelRuleProvider,
  createComplianceProviders,
};
