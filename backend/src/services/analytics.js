"use strict";

const pool = require("../db/pool");

// Default/fallback parameters when there is no historical data to train on
let modelWeights = {
  budget: 0.005,         // +0.005 days per XLM
  skillsCount: 0.5,     // +0.5 days per required skill
  completedJobs: -0.2,  // -0.2 days per completed job (up to 5 days max)
  rating: -0.8,         // -0.8 days per star above 0
};
let modelBias = 5.0;     // Base duration of 5 days

/**
 * Train the regression model on historical completed jobs.
 * This runs gradient descent to fit parameters to actual job durations.
 */
async function trainRegressionModel() {
  try {
    const { rows } = await pool.query(`
      SELECT j.budget, j.skills, j.created_at, j.updated_at,
             COALESCE(p.completed_jobs, 0) AS completed_jobs,
             COALESCE(p.rating, 4.0) AS rating
      FROM jobs j
      JOIN profiles p ON j.freelancer_address = p.public_key
      WHERE j.status = 'completed' AND j.freelancer_address IS NOT NULL
    `);

    if (rows.length < 3) {
      // Too few completed jobs to train a regression model. Using sensible heuristic defaults.
      return { success: true, message: "Using default heuristic model (insufficient historical data)" };
    }

    const dataset = rows.map((r) => {
      const budget = parseFloat(r.budget) || 0;
      const skillsCount = Array.isArray(r.skills) ? r.skills.length : 0;
      const completedJobs = parseInt(r.completed_jobs, 10) || 0;
      const rating = parseFloat(r.rating) || 4.0;
      
      // Actual duration in days
      const duration = (new Date(r.updated_at) - new Date(r.created_at)) / (1000 * 60 * 60 * 24);

      return {
        x: [budget, skillsCount, completedJobs, rating],
        y: Math.max(0.5, duration), // ensure positive duration
      };
    });

    // Simple multi-variable gradient descent training loop
    let w = [0.005, 0.5, -0.2, -0.8];
    let b = 5.0;
    const lr = 0.00001; // small learning rate to avoid divergence
    const epochs = 1000;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let gradW = [0, 0, 0, 0];
      let gradB = 0;

      for (const item of dataset) {
        const pred = w[0] * item.x[0] + w[1] * item.x[1] + w[2] * item.x[2] + w[3] * item.x[3] + b;
        const error = pred - item.y;

        gradW[0] += error * item.x[0];
        gradW[1] += error * item.x[1];
        gradW[2] += error * item.x[2];
        gradW[3] += error * item.x[3];
        gradB += error;
      }

      // Update weights and bias
      const n = dataset.length;
      w[0] -= (lr / n) * gradW[0];
      w[1] -= (lr / n) * gradW[1];
      // Completed jobs and rating should always help reduce duration (negative weights)
      w[2] = Math.min(0, w[2] - (lr / n) * gradW[2]);
      w[3] = Math.min(0, w[3] - (lr / n) * gradW[3]);
      b -= (lr / n) * gradB;
    }

    // Cache the trained weights
    modelWeights = {
      budget: w[0],
      skillsCount: w[1],
      completedJobs: w[2],
      rating: w[3],
    };
    modelBias = Math.max(1.0, b); // base bias must be at least 1 day

    return {
      success: true,
      message: `Regression model successfully trained on ${rows.length} completed jobs.`,
      parameters: { modelWeights, modelBias },
    };
  } catch (err) {
    console.error("Error training regression model:", err);
    return { success: false, error: err.message };
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
    const { rows: profileRows } = await pool.query(
      `SELECT completed_jobs, rating FROM profiles WHERE public_key = $1`,
      [freelancerAddress]
    );

    if (profileRows.length > 0) {
      completedJobs = parseInt(profileRows[0].completed_jobs, 10) || 0;
      rating = profileRows[0].rating ? parseFloat(profileRows[0].rating) : 4.0;
    }

    // Query historical jobs for on-time completion rate
    const { rows: historyRows } = await pool.query(
      `SELECT deadline, created_at, updated_at
       FROM jobs
       WHERE freelancer_address = $1 AND status = 'completed'`,
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
      confidenceScore = Math.min(95, 80 + Math.min(10, completedJobs) + Math.round((rating - 4.0) * 5));
    } else {
      confidenceScore = 75; // neutral baseline for new freelancers
    }
  }

  // Adjust confidence score based on historical on-time completion rate
  const onTimeRate = totalAssignedJobs > 0 ? (onTimeCompleted / totalAssignedJobs) * 100 : null;
  if (onTimeRate !== null) {
    confidenceScore = Math.round((confidenceScore * 0.6) + (onTimeRate * 0.4));
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
