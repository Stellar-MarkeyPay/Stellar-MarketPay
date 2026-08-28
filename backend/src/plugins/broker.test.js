"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue({}),
}));

const pool = require("../db/pool");
const { createBroker, BrokerDeniedError } = require("./broker");

describe("plugin broker — permission enforcement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("allows a call when the required scope is granted", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "job-1", title: "A job" }] });
    const call = createBroker({ pluginId: "p1", pluginName: "P1", grantedScopes: ["read:jobs"] });
    const result = await call("jobs.get", { jobId: "job-1" });
    expect(result).toEqual({ id: "job-1", title: "A job" });
  });

  test("NEGATIVE: denies a call when the required scope is not granted", async () => {
    const call = createBroker({ pluginId: "p1", pluginName: "P1", grantedScopes: [] });
    await expect(call("jobs.get", { jobId: "job-1" })).rejects.toBeInstanceOf(BrokerDeniedError);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("NEGATIVE: rejects an unrecognized method outright", async () => {
    const call = createBroker({
      pluginId: "p1",
      pluginName: "P1",
      grantedScopes: [
        "read:jobs",
        "read:applications",
        "read:profile",
        "write:notifications",
        "network:api.example.com",
      ],
    });
    await expect(call("fs.readFile", { path: "/etc/passwd" })).rejects.toBeInstanceOf(
      BrokerDeniedError
    );
  });

  test("network.fetch is denied without a matching network:<host> grant", async () => {
    const call = createBroker({
      pluginId: "p1",
      pluginName: "P1",
      grantedScopes: ["network:allowed.example.com"],
    });
    await expect(
      call("network.fetch", { url: "https://evil.example.com/steal" })
    ).rejects.toBeInstanceOf(BrokerDeniedError);
  });

  test("write:notifications is required for notifications.send", async () => {
    const denied = createBroker({ pluginId: "p1", pluginName: "P1", grantedScopes: [] });
    await expect(
      denied("notifications.send", { recipientAddress: "GABC", message: "hi" })
    ).rejects.toBeInstanceOf(BrokerDeniedError);

    const allowed = createBroker({
      pluginId: "p1",
      pluginName: "P1",
      grantedScopes: ["write:notifications"],
    });
    const result = await allowed("notifications.send", { recipientAddress: "GABC", message: "hi" });
    expect(result).toEqual({ sent: true });
  });
});
