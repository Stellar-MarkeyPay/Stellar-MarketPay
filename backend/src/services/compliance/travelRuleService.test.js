"use strict";

const { buildTravelRulePayload } = require("./travelRuleService");
const { renderReport } = require("./reportingService");

describe("Travel Rule and regulatory report formats", () => {
  const transaction = {
    id: "tx-1",
    amount: "1500.0000000",
    asset: "USDC",
    originator_address: "GORIGINATOR",
    originator_country: "NG",
    beneficiary_address: "GBENEFICIARY",
  };

  it("builds the required originator/beneficiary exchange without extra source fields", () => {
    const payload = buildTravelRulePayload(
      transaction,
      { fullName: "Originator Person", taxId: "not-exchanged" },
      { fullName: "Beneficiary Person", country: "GH" },
      ["fullName", "account", "country"]
    );

    expect(payload).toMatchObject({
      fullName: "Originator Person",
      account: "GORIGINATOR",
      country: "NG",
      beneficiaryName: "Beneficiary Person",
      beneficiaryAccount: "GBENEFICIARY",
    });
    expect(payload).not.toHaveProperty("taxId");
  });

  it("rejects exchange when a policy-required field is absent", () => {
    expect(() =>
      buildTravelRulePayload(transaction, {}, {}, ["fullName", "account", "country"])
    ).toThrow("incomplete");
  });

  it("renders stable SAR JSON and escaped SAR XML", () => {
    const body = {
      reportId: "report-1",
      jurisdiction: "NG",
      subjectReference: "subject-1",
      caseReference: "case-1",
      decision: "file_report",
      narrative: "A & B < threshold",
      evidenceHash: "abc",
      preparedAt: "2026-08-27T00:00:00.000Z",
    };

    expect(JSON.parse(renderReport("SAR_JSON", body))).toEqual(body);
    expect(renderReport("SAR_XML", body)).toContain("A &amp; B &lt; threshold");
  });
});
