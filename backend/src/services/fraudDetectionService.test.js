"use strict";

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const {
  analyzeBidEvent,
  getJobFraudStats,
  resetFraudDetectionStateForTests,
} = require("./fraudDetectionService");

describe("fraudDetectionService", () => {
  const jobId = "job-fraud-1";
  const freelancerAddress =
    "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

  beforeEach(() => {
    jest.useRealTimers();
    pool.reset();
    resetFraudDetectionStateForTests();
  });

  it("accepts normal bids without flags", async () => {
    const result = await analyzeBidEvent({
      jobId,
      applicationId: "app-normal-1",
      freelancerAddress,
      bidAmount: "100",
      jobBudget: "150",
    });

    expect(result.flagged).toBe(false);
    expect(result.riskScore).toBe(0);
    expect(result.rules).toEqual([]);
    expect(result.job.recentBidCount).toBe(1);
    expect(result.freelancer.recentBidCount).toBe(1);
  });

  it("flags freelancer bid spam above the rolling-window limit", async () => {
    for (let index = 0; index < 5; index += 1) {
      await analyzeBidEvent({
        jobId,
        applicationId: `app-spam-${index}`,
        freelancerAddress,
        bidAmount: "100",
      });
    }

    const result = await analyzeBidEvent({
      jobId,
      applicationId: "app-spam-5",
      freelancerAddress,
      bidAmount: "101",
    });

    expect(result.flagged).toBe(true);
    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleCode: "FREELANCER_BID_SPAM" }),
      ]),
    );
    expect(result.freelancer.recentBidCount).toBe(6);
  });

  it("flags job bid spam above the rolling-window limit", async () => {
    for (let index = 0; index < 20; index += 1) {
      await analyzeBidEvent({
        jobId,
        applicationId: `app-job-spam-${index}`,
        freelancerAddress: `G${String(index).padStart(55, "A")}`,
        bidAmount: "100",
      });
    }

    const result = await analyzeBidEvent({
      jobId,
      applicationId: "app-job-spam-20",
      freelancerAddress: "GCCCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
      bidAmount: "100",
    });

    expect(result.flagged).toBe(true);
    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleCode: "JOB_BID_SPAM" }),
      ]),
    );
    expect(result.job.recentBidCount).toBe(21);
  });

  it("flags bids that are extreme against the job budget", async () => {
    const highBid = await analyzeBidEvent({
      jobId,
      applicationId: "app-high-bid",
      freelancerAddress,
      bidAmount: "400",
      jobBudget: "100",
    });

    expect(highBid.flagged).toBe(true);
    expect(highBid.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleCode: "EXTREME_HIGH_BID" }),
      ]),
    );

    const lowBid = await analyzeBidEvent({
      jobId: "job-low-bid",
      applicationId: "app-low-bid",
      freelancerAddress,
      bidAmount: "2",
      jobBudget: "100",
    });

    expect(lowBid.flagged).toBe(true);
    expect(lowBid.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleCode: "EXTREME_LOW_BID" }),
      ]),
    );
  });

  it("flags statistical amount outliers among recent job bids", async () => {
    const normalJobId = "job-stats";

    await analyzeBidEvent({
      jobId: normalJobId,
      applicationId: "app-stats-1",
      freelancerAddress: "GDDDDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
      bidAmount: "100",
    });
    await analyzeBidEvent({
      jobId: normalJobId,
      applicationId: "app-stats-2",
      freelancerAddress: "GEEEEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
      bidAmount: "105",
    });
    await analyzeBidEvent({
      jobId: normalJobId,
      applicationId: "app-stats-3",
      freelancerAddress: "GFFFFFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
      bidAmount: "98",
    });

    const result = await analyzeBidEvent({
      jobId: normalJobId,
      applicationId: "app-stats-outlier",
      freelancerAddress: "GGGGGGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
      bidAmount: "250",
    });

    expect(result.flagged).toBe(true);
    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleCode: "BID_AMOUNT_OUTLIER" }),
      ]),
    );
    expect(result.job.max).toBe("250.0000000");
  });

  it("returns rolling job fraud stats and prunes old bids", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    await analyzeBidEvent({
      jobId,
      applicationId: "app-stats-window-1",
      freelancerAddress,
      bidAmount: "100",
    });
    await analyzeBidEvent({
      jobId,
      applicationId: "app-stats-window-2",
      freelancerAddress: "GCCCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
      bidAmount: "110",
    });

    expect(getJobFraudStats(jobId).recentBidCount).toBe(2);

    jest.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));

    expect(getJobFraudStats(jobId).recentBidCount).toBe(0);
  });
});
