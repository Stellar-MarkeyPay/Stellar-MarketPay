"use strict";

const mockQuery = jest.fn();

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

const { trainRegressionModel, predictJobCompletion } = require("./analytics");

describe("analytics service", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("trainRegressionModel", () => {
    it("uses heuristic defaults when there is insufficient history", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await trainRegressionModel();

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/insufficient historical data/i);
    });

    it("trains on completed jobs when enough history exists", async () => {
      const created = new Date("2026-01-01T00:00:00Z");
      const completed = new Date("2026-01-11T00:00:00Z");
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            budget: "100",
            skills: ["Rust", "Soroban"],
            created_at: created,
            updated_at: completed,
            completed_jobs: 5,
            rating: "4.5",
          },
          {
            budget: "200",
            skills: ["Node"],
            created_at: created,
            updated_at: completed,
            completed_jobs: 10,
            rating: "4.8",
          },
          {
            budget: "150",
            skills: ["React"],
            created_at: created,
            updated_at: completed,
            completed_jobs: 2,
            rating: "3.9",
          },
        ],
      });

      const result = await trainRegressionModel();

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/trained on 3 completed jobs/i);
      expect(result.parameters.modelBias).toBeGreaterThan(0);
    });
  });

  describe("predictJobCompletion", () => {
    it("returns duration, completion date, and confidence score", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ completed_jobs: 8, rating: "4.7" }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              deadline: "2026-12-31T23:59:59Z",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-05T00:00:00Z",
            },
          ],
        });

      const prediction = await predictJobCompletion(
        {
          budget: "500",
          skills: ["Rust", "Soroban"],
          category: "Smart Contracts",
          deadline: "2026-12-31T23:59:59Z",
        },
        "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
      );

      expect(prediction.estimatedDurationDays).toBeGreaterThan(0);
      expect(prediction.estimatedCompletionDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(prediction.confidenceScore).toBeGreaterThanOrEqual(30);
      expect(prediction.confidenceScore).toBeLessThanOrEqual(99);
      expect(prediction.freelancerStats.completedJobs).toBe(8);
      expect(prediction.freelancerStats.onTimeRate).toBe(100);
    });

    it("returns neutral confidence for unknown freelancers", async () => {
      const prediction = await predictJobCompletion({
        budget: "100",
        skills: ["Design"],
        category: "Design",
      });

      expect(prediction.confidenceScore).toBe(75);
      expect(prediction.freelancerStats.completedJobs).toBe(0);
      expect(prediction.freelancerStats.onTimeRate).toBeNull();
    });
  });
});
