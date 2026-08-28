"use strict";

const warehousePool = require("../db/warehouse/warehousePool");

// Default/fallback parameters when there is no historical data to train on
let modelWeights = {
  budget: 0.005, // +0.005 days per XLM
  skillsCount: 0.5, // +0.5 days per required skill
  completedJobs: -0.2, // -0.2 days per completed job (up to 5 days max)
  rating: -0.8, // -0.8 days per star above 0
};
let modelBias = 5.0; // Base duration of 5 days

/**
 * Train the regression model on historical completed jobs.
 * This runs gradient descent to fit parameters to actual job durations.
 */
async function trainRegressionModel() {
  try {
    const { rows } = await warehousePool.query(`
      SELECT
        j.budget,
        j.skills,
        j.created_at,
        j.updated_at,
        COALESCE(p.completed_jobs, 0) AS completed_jobs,
        COALESCE(p.rating, 4.0) AS rating
      FROM silver_jobs j
      JOIN silver_profiles p
        ON j.freelancer_address = p.public_key
      WHERE j.status = 'completed'
        AND j.freelancer_address IS NOT NULL
    `);

    if (rows.length < 3) {
      return {
        success: true,
        message: "Using default heuristic model (insufficient historical data)",
        parameters: {
          modelWeights,
          modelBias,
        },
      };
    }

    const dataset = rows.map((r) => {
      const budget = Number(r.budget) || 0;

      let skillsCount = 0;

      if (Array.isArray(r.skills)) {
        skillsCount = r.skills.length;
      } else if (typeof r.skills === "string") {
        skillsCount = r.skills
          .replace(/[{}]/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean).length;
      }

      const completedJobs = Number(r.completed_jobs) || 0;
      const rating = Number(r.rating) || 4.0;

      const createdAt = new Date(r.created_at);
      const updatedAt = new Date(r.updated_at);

      const duration =
        (updatedAt.getTime() - createdAt.getTime()) /
        (1000 * 60 * 60 * 24);

      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(
          `Invalid job duration for job: ${r.id || "unknown"}`
        );
      }

      return {
        x: [budget, skillsCount, completedJobs, rating],
        y: Math.max(0.5, duration),
      };
    });

    /*
     * Normalize features before gradient descent.
     *
     * Budget has a much larger numerical scale than the other
     * features. Without normalization, gradient descent can
     * diverge and produce NaN values.
     */
    const featureCount = 4;
    const means = new Array(featureCount).fill(0);
    const stds = new Array(featureCount).fill(1);

    for (const item of dataset) {
      for (let i = 0; i < featureCount; i++) {
        means[i] += item.x[i];
      }
    }

    for (let i = 0; i < featureCount; i++) {
      means[i] /= dataset.length;
    }

    for (const item of dataset) {
      for (let i = 0; i < featureCount; i++) {
        const diff = item.x[i] - means[i];
        stds[i] += diff * diff;
      }
    }

    for (let i = 0; i < featureCount; i++) {
      stds[i] = Math.sqrt(stds[i] / dataset.length);

      // Prevent division by zero for constant features.
      if (!Number.isFinite(stds[i]) || stds[i] === 0) {
        stds[i] = 1;
      }
    }

    const normalizedDataset = dataset.map((item) => ({
      x: item.x.map(
        (value, i) => (value - means[i]) / stds[i]
      ),
      y: item.y,
    }));

    /*
     * Gradient descent on normalized features.
     */
    let w = [0, 0, 0, 0];
    let b =
      normalizedDataset.reduce((sum, item) => sum + item.y, 0) /
      normalizedDataset.length;

    const lr = 0.01;
    const epochs = 5000;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const gradW = [0, 0, 0, 0];
      let gradB = 0;

      for (const item of normalizedDataset) {
        const prediction =
          w[0] * item.x[0] +
          w[1] * item.x[1] +
          w[2] * item.x[2] +
          w[3] * item.x[3] +
          b;

        const error = prediction - item.y;

        for (let i = 0; i < featureCount; i++) {
          gradW[i] += error * item.x[i];
        }

        gradB += error;
      }

      const n = normalizedDataset.length;

      for (let i = 0; i < featureCount; i++) {
        w[i] -= (lr / n) * gradW[i];
      }

      b -= (lr / n) * gradB;

      // Fail loudly if numerical instability occurs.
      if (
        !w.every(Number.isFinite) ||
        !Number.isFinite(b)
      ) {
        throw new Error(
          `Gradient descent produced non-finite values at epoch ${epoch}`
        );
      }
    }

    /*
     * Convert normalized coefficients back to raw feature units
     * so predictJobCompletion() can continue using raw job values.
     */
    const rawWeights = w.map(
      (weight, i) => weight / stds[i]
    );

    let rawBias =
      b -
      rawWeights.reduce(
        (sum, weight, i) => sum + weight * means[i],
        0
      );

    /*
     * Keep completed jobs and rating as factors that cannot
     * increase predicted duration.
     */
    rawWeights[2] = Math.min(0, rawWeights[2]);
    rawWeights[3] = Math.min(0, rawWeights[3]);

    if (
      !rawWeights.every(Number.isFinite) ||
      !Number.isFinite(rawBias)
    ) {
      throw new Error(
        "Model training produced non-finite weights or bias"
      );
    }

    modelWeights = {
      budget: rawWeights[0],
      skillsCount: rawWeights[1],
      completedJobs: rawWeights[2],
      rating: rawWeights[3],
    };

    modelBias = Math.max(1.0, rawBias);

    return {
      success: true,
      message:
        `Regression model successfully trained on ${rows.length} completed jobs.`,
      parameters: {
        modelWeights,
        modelBias,
      },
    };
  } catch (err) {
    console.error("Error training regression model:", err);

    return {
      success: false,
      error: err.message,
    };
  }
}


/**
 * Predicts job completion metrics for a freelancer and a job.
 *
 * @param {Object} job - Job details (budget, skills, deadline, category)
 * @param {string} [freelancerAddress] - Optional freelancer public key
 * @returns {Promise<Object>} Predictive analytics metrics
 */
async function predictJobCompletion(job, freelancerAddress = null) {
  let completedJobs = 0;
  let rating = 4.0;
  let onTimeCompleted = 0;
  let totalAssignedJobs = 0;

  if (freelancerAddress) {
    // Query freelancer profile info
    const { rows: profileRows } = await warehousePool.query(
      `SELECT completed_jobs, rating
       FROM silver_profiles
       WHERE public_key = $1`,
      [freelancerAddress]
    );

    if (profileRows.length > 0) {
      completedJobs = parseInt(profileRows[0].completed_jobs, 10) || 0;
      rating = profileRows[0].rating ? parseFloat(profileRows[0].rating) : 4.0;
    }

    // Query historical jobs for on-time completion rate
    const { rows: historyRows } = await warehousePool.query(
      `SELECT deadline, created_at, updated_at
       FROM silver_jobs
       WHERE freelancer_address = $1
         AND status = 'completed'`,
      [freelancerAddress]
    );

    totalAssignedJobs = historyRows.length;
    for (const h of historyRows) {
      if (!h.deadline) {
        onTimeCompleted++;
      } else {
        const deadline = new Date(h.deadline);
        const completedAt = new Date(h.updated_at);
        if (completedAt <= deadline) {
          onTimeCompleted++;
        }
      }
    }
  }

  const budget = parseFloat(job.budget) || 0;
  const skillsCount = Array.isArray(job.skills) ? job.skills.length : 0;

  // Run multi-variable linear regression prediction
  let predictedDuration =
    modelWeights.budget * budget +
    modelWeights.skillsCount * skillsCount +
    modelWeights.completedJobs * Math.min(25, completedJobs) +
    modelWeights.rating * rating +
    modelBias;

  // Add category-specific adjustments
  if (job.category) {
    const cat = job.category.toLowerCase();
    if (cat.includes("contract") || cat.includes("audit") || cat.includes("security")) {
      predictedDuration += 3.0; // complex domains take longer
    } else if (cat.includes("writing") || cat.includes("design")) {
      predictedDuration -= 1.5; // content/creative tasks are generally faster
    }
  }

  // Ensure reasonable bounds
  predictedDuration = Math.max(1.0, parseFloat(predictedDuration.toFixed(1)));

  // Calculate estimated completion date
  const estimatedCompletionDate = new Date();
  estimatedCompletionDate.setDate(estimatedCompletionDate.getDate() + Math.ceil(predictedDuration));

  // Determine expected duration if deadline is set
  let expectedDurationDays = null;
  let confidenceScore = 85; // baseline confidence score

  if (job.deadline) {
    const deadlineDate = new Date(job.deadline);
    const timeDiff = deadlineDate - new Date();
    expectedDurationDays = Math.max(0.1, timeDiff / (1000 * 60 * 60 * 24));

    const ratio = predictedDuration / expectedDurationDays;
    if (ratio <= 1.0) {
      // Well within deadline: confidence scales up to 98%
      confidenceScore = Math.round(98 - ratio * 15);
    } else {
      // Over deadline: confidence decreases rapidly
      confidenceScore = Math.max(15, Math.round(80 - (ratio - 1.0) * 100));
    }
  } else {
    // If no deadline is set, base confidence on freelancer history
    if (completedJobs > 0) {
      confidenceScore = Math.min(
        95,
        80 + Math.min(10, completedJobs) + Math.round((rating - 4.0) * 5)
      );
    } else {
      confidenceScore = 75; // neutral baseline for new freelancers
    }
  }

  // Adjust confidence score based on historical on-time completion rate
  const onTimeRate = totalAssignedJobs > 0 ? (onTimeCompleted / totalAssignedJobs) * 100 : null;
  if (onTimeRate !== null) {
    confidenceScore = Math.round(confidenceScore * 0.6 + onTimeRate * 0.4);
  }

  // Final clamps
  confidenceScore = Math.max(30, Math.min(99, confidenceScore));

  return {
    estimatedDurationDays: predictedDuration,
    estimatedCompletionDate: estimatedCompletionDate.toISOString(),
    confidenceScore,
    freelancerStats: {
      completedJobs,
      rating: parseFloat(rating.toFixed(2)),
      onTimeRate: onTimeRate !== null ? Math.round(onTimeRate) : null,
    },
  };
}

module.exports = {
  trainRegressionModel,
  predictJobCompletion,
};
