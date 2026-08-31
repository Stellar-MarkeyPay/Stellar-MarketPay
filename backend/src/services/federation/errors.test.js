"use strict";

const { FederationError, federationError } = require("./errors");

describe("federation errors", () => {
  it("carries a stable HTTP status, machine code and optional details", () => {
    const error = federationError(409, "FEDERATED_IDENTITY_CONFLICT", "Identity already linked", {
      providerId: "provider-1",
    });

    expect(error).toBeInstanceOf(FederationError);
    expect(error).toMatchObject({
      name: "FederationError",
      status: 409,
      code: "FEDERATED_IDENTITY_CONFLICT",
      message: "Identity already linked",
      details: { providerId: "provider-1" },
    });
  });
});
