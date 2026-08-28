"use strict";

const { requireAdminRole, requireJwtSecret } = require("./auth");

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("JWT secret configuration", () => {
  it("exits with a fatal error when JWT_SECRET is missing", () => {
    const originalSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    const mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    const mockError = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      requireJwtSecret();
    } catch {
      // expected
    }

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith("FATAL: JWT_SECRET environment variable is required");

    mockExit.mockRestore();
    mockError.mockRestore();
    if (originalSecret) process.env.JWT_SECRET = originalSecret;
  });
});

describe("requireAdminRole", () => {
  afterEach(() => {
    delete process.env.ADMIN_WALLET_ADDRESSES;
  });

  it("allows a verified JWT with an admin role", () => {
    const req = { user: { publicKey: "GADMIN", role: "admin" } };
    const res = createMockResponse();
    const next = jest.fn();

    requireAdminRole(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a non-admin JWT even when the public key is listed as an admin address", () => {
    process.env.ADMIN_WALLET_ADDRESSES = "GADMIN";
    const req = { user: { publicKey: "GADMIN", role: "user" } };
    const res = createMockResponse();
    const next = jest.fn();

    requireAdminRole(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden: Admin access required" });
  });

  it("rejects requests without a verified user", () => {
    const req = {};
    const res = createMockResponse();
    const next = jest.fn();

    requireAdminRole(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });
});

export {};
