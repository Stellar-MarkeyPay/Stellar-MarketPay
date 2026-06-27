"use strict";

const {
  buildVerificationProof,
  parseGitHubQuery,
  parseWebsiteQuery,
  verifyGitHubCommit,
  verifyWebsiteStatus,
  verifyOracleQuery,
} = require("./github_oracle");

describe("github_oracle service", () => {
  const githubQuery =
    "github:stellar:marketpay:commit:abcdef1234567890abcdef1234567890abcdef12";

  it("builds deterministic verification proofs", () => {
    const proofA = buildVerificationProof(githubQuery);
    const proofB = buildVerificationProof(githubQuery);

    expect(proofA).toEqual(proofB);
    expect(proofA).toHaveLength(32);
  });

  it("parses GitHub oracle queries", () => {
    expect(parseGitHubQuery(githubQuery)).toEqual({
      owner: "stellar",
      repo: "marketpay",
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
    });
  });

  it("parses website oracle queries", () => {
    expect(parseWebsiteQuery("website:https://example.com:status:200")).toEqual({
      url: "https://example.com",
      statusCode: 200,
    });
  });

  it("verifies GitHub commits via API", async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        status: 200,
        data: { sha: "abcdef1234567890abcdef1234567890abcdef12deadbeef" },
      }),
    };

    const proof = await verifyGitHubCommit(githubQuery, httpClient);

    expect(httpClient.get).toHaveBeenCalledWith(
      "https://api.github.com/repos/stellar/marketpay/commits/abcdef1234567890abcdef1234567890abcdef12",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
        }),
      }),
    );
    expect(proof).toEqual(buildVerificationProof(githubQuery));
  });

  it("verifies website status codes", async () => {
    const query = "website:https://example.com:status:200";
    const httpClient = {
      get: jest.fn().mockResolvedValue({ status: 200 }),
    };

    const proof = await verifyWebsiteStatus(query, httpClient);

    expect(httpClient.get).toHaveBeenCalledWith("https://example.com", expect.any(Object));
    expect(proof).toEqual(buildVerificationProof(query));
  });

  it("dispatches by oracle type", async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        status: 200,
        data: { sha: "abcdef1234567890abcdef1234567890abcdef12deadbeef" },
      }),
    };

    const proof = await verifyOracleQuery("github", githubQuery, httpClient);
    expect(proof).toEqual(buildVerificationProof(githubQuery));
  });
});
