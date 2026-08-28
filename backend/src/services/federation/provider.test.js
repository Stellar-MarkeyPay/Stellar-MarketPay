"use strict";

const {
  assertProviderAdapter,
  mapFederatedAttributes,
  normalizeFederatedPrincipal,
  readAttributePath,
} = require("./provider");

describe("protocol-neutral federation provider contract", () => {
  it("normalizes the result shared by SAML and OIDC adapters", () => {
    const principal = normalizeFederatedPrincipal({
      protocol: "saml",
      organisationId: "org-1",
      providerId: "provider-1",
      issuer: "https://idp.example.test/metadata",
      subject: "subject-123",
      responseId: "response-1",
      assertionId: "assertion-1",
      audience: "https://marketpay.example.test/saml/metadata/org-1",
      issuedAt: "2026-08-28T05:00:00.000Z",
      expiresAt: "2026-08-28T05:05:00.000Z",
      authenticationContext: "urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport",
      attributes: { mail: "member@example.test" },
    });

    expect(principal.protocol).toBe("saml");
    expect(principal.issuedAt).toEqual(new Date("2026-08-28T05:00:00.000Z"));
    expect(Object.isFrozen(principal)).toBe(true);
  });

  it("rejects malformed lifetimes and incomplete principals", () => {
    const valid = {
      protocol: "oidc",
      organisationId: "org-1",
      providerId: "provider-1",
      issuer: "https://idp.example.test",
      subject: "subject-123",
      responseId: "token-1",
      audience: "client-1",
      issuedAt: "2026-08-28T05:05:00.000Z",
      expiresAt: "2026-08-28T05:00:00.000Z",
    };
    expect(() => normalizeFederatedPrincipal(valid)).toThrow("expiresAt must follow issuedAt");
    expect(() => normalizeFederatedPrincipal({ ...valid, protocol: "oauth" })).toThrow(
      "Protocol must be saml or oidc"
    );
  });

  it("maps configured JIT attributes and normalizes email and groups", () => {
    const mapped = mapFederatedAttributes(
      {
        claims: {
          mail: "STAFF@Example.Test",
          name: "Staff Member",
          groups: ["engineering", "engineering", "reviewers"],
        },
      },
      {
        email: "claims.mail",
        displayName: "claims.name",
        groups: "claims.groups",
      }
    );

    expect(mapped).toEqual({
      email: "staff@example.test",
      displayName: "Staff Member",
      groups: ["engineering", "reviewers"],
    });
  });

  it("does not traverse prototype-sensitive or unconfigured paths", () => {
    expect(() => readAttributePath({}, "__proto__.polluted")).toThrow("Attribute path is invalid");
    expect(() => mapFederatedAttributes({}, { walletSeed: "claims.seed" })).toThrow(
      "Unsupported target walletSeed"
    );
  });

  it("requires adapters to implement the shared request/response boundary", () => {
    const adapter = {
      protocol: "oidc",
      buildAuthenticationRequest: jest.fn(),
      consumeAuthenticationResponse: jest.fn(),
    };
    expect(assertProviderAdapter(adapter, "oidc")).toBe(adapter);
    expect(() => assertProviderAdapter({ protocol: "oidc" }, "oidc")).toThrow(
      "Provider adapter lacks buildAuthenticationRequest"
    );
  });
});
