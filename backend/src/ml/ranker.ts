/**
 * In-process ranker for exported ML model weights (linear / LambdaMART-style blend).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { FEATURE_NAMES } = require("./featureEngineering");

const DEFAULT_MODEL_PATH = path.join(__dirname, "defaultModel.json");

let cachedModel: any = null;
let cachedModelPath: any = null;
let cachedModelMtime = 0;

function sigmoid(x: any) {
  return 1 / (1 + Math.exp(-x));
}

function loadModel(modelPath: any) {
  const resolved = modelPath || process.env.ML_RANKING_MODEL_PATH || DEFAULT_MODEL_PATH;

  try {
    const stat = fs.statSync(resolved);
    if (cachedModel && cachedModelPath === resolved && stat.mtimeMs === cachedModelMtime) {
      return cachedModel;
    }

    const raw = fs.readFileSync(resolved, "utf8");
    cachedModel = JSON.parse(raw);
    cachedModelPath = resolved;
    cachedModelMtime = stat.mtimeMs;
    return cachedModel;
  } catch {
    if (cachedModel) return cachedModel;
    try {
      const raw = fs.readFileSync(DEFAULT_MODEL_PATH, "utf8");
      cachedModel = JSON.parse(raw);
      cachedModelPath = DEFAULT_MODEL_PATH;
      return cachedModel;
    } catch {
      // Model file completely unavailable — return a minimal default
      // so the system can degrade to deterministic fallback
      return {
        version: "unavailable",
        type: "fallback",
        weights: {},
        bias: 0,
        targetBlend: { completion_prob: 0.5, expected_rating: 0.3, time_to_completion: 0.2 },
        fairness: { exploration_boost: 0.12, new_freelancer_threshold_jobs: 3 },
        evaluation: { ndcg_at_10: 0, baseline_ndcg_at_10: 0 },
      };
    }
  }
}

function scoreFeatures(features: any, model: any) {
  const weights = model.weights || {};
  let linear = Number(model.bias) || 0;

  for (const name of FEATURE_NAMES) {
    const value = Number(features[name]) || 0;
    linear += (Number(weights[name]) || 0) * value;
  }

  const completionProb = sigmoid(linear);
  const expectedRating = (Number(features.expected_rating_signal) || 0.5) * 5;
  const timeSignal = Number(features.time_to_completion_signal) || 0.5;

  const blend = model.targetBlend || {
    completion_prob: 0.5,
    expected_rating: 0.3,
    time_to_completion: 0.2,
  };

  const composite =
    blend.completion_prob * completionProb +
    blend.expected_rating * (expectedRating / 5) +
    blend.time_to_completion * timeSignal;

  return {
    score: composite,
    completionProb,
    expectedRating,
    timeToCompletionDays: Math.round((1 - timeSignal) * 60),
    matchScore: Math.round(composite * 100),
  };
}

function applyExplorationBoost(score: any, completedJobs: any, model: any) {
  const fairness = model.fairness || {};
  const threshold = fairness.new_freelancer_threshold_jobs ?? 3;
  const boost = fairness.exploration_boost ?? 0.12;

  if ((completedJobs || 0) < threshold) {
    return score + boost;
  }
  return score;
}

function rankItems(items: any, modelPath: any) {
  const model = loadModel(modelPath);

  const scored = items.map((item: any) => {
    const base = scoreFeatures(item.features, model);
    const adjustedScore = applyExplorationBoost(base.score, item.completedJobs, model);

    return {
      ...item,
      ...base,
      score: adjustedScore,
      matchScore: Math.round(Math.min(adjustedScore, 1) * 100),
      isExploration:
        (item.completedJobs || 0) < (model.fairness?.new_freelancer_threshold_jobs ?? 3),
    };
  });

  scored.sort((a: any, b: any) => b.score - a.score);
  return { ranked: scored, model };
}

function getModelMetadata(modelPath: any) {
  const model = loadModel(modelPath);
  return {
    version: model.version,
    type: model.type,
    evaluation: model.evaluation,
    fairness: model.fairness,
    trainingConfig: model.training_config || null,
  };
}

function resetModelCacheForTests() {
  cachedModel = null;
  cachedModelPath = null;
  cachedModelMtime = 0;
}

function isModelUnavailable() {
  return cachedModel?.version === "unavailable";
}

module.exports = {
  loadModel,
  scoreFeatures,
  rankItems,
  getModelMetadata,
  isModelUnavailable,
  resetModelCacheForTests,
};

export {};
