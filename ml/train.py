#!/usr/bin/env python3
"""
Train a LambdaMART-style learning-to-rank model for freelancer-job matching.

Uses a temporal train/test split (older jobs for training, newer for evaluation)
and exports weights to backend/src/ml/defaultModel.json for Node.js serving.

Usage:
  export DATABASE_URL=postgresql://...
  python ml/train.py
  python ml/train.py --output backend/src/ml/defaultModel.json

For reproducible runs, use pipeline.py which reads training_config.yaml:
  python ml/pipeline.py
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from sklearn.metrics import ndcg_score

FEATURE_NAMES = [
    "skill_overlap",
    "freelancer_completion_rate",
    "category_match_rate",
    "freelancer_rating_norm",
    "budget_fit",
    "job_recency",
    "response_time_score",
    "progress_frequency",
    "client_rating_norm",
    "expected_rating_signal",
    "time_to_completion_signal",
]

load_dotenv()


def _set_seeds(seed: int = 42):
    """Pin random seeds for deterministic training."""
    random.seed(seed)
    np.random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is required")
    return psycopg2.connect(url)


def skill_overlap(f_skills, j_skills):
    f_set = {s.lower() for s in (f_skills or [])}
    j_skills = [s.lower() for s in (j_skills or [])]
    if not j_skills:
        return 0.5
    return sum(1 for s in j_skills if s in f_set) / len(j_skills)


def normalize_rating(rating):
    if rating is None or (isinstance(rating, float) and math.isnan(rating)):
        return 0.5
    return max(0.0, min(1.0, float(rating) / 5.0))


def fetch_training_frame(conn) -> pd.DataFrame:
    query = """
    SELECT
      a.id AS application_id,
      a.freelancer_address,
      a.job_id,
      a.status AS application_status,
      a.bid_amount,
      a.created_at AS applied_at,
      j.category,
      j.budget,
      j.skills AS job_skills,
      j.status AS job_status,
      j.created_at AS job_created_at,
      j.updated_at AS job_updated_at,
      j.client_address,
      fp.skills AS freelancer_skills,
      fp.completed_jobs,
      fp.rating AS freelancer_rating,
      fp.created_at AS freelancer_created_at,
      cp.rating AS client_rating,
      (
        SELECT AVG(stars)::float FROM ratings r WHERE r.rated_address = a.freelancer_address
      ) AS avg_freelancer_stars,
      (
        SELECT COUNT(*)::int FROM progress_updates pu
        JOIN jobs jj ON jj.id = pu.job_id
        WHERE pu.author_address = a.freelancer_address AND jj.status = 'completed'
      ) AS progress_updates,
      (
        SELECT AVG(EXTRACT(EPOCH FROM (a2.created_at - jj.created_at)) / 3600.0)
        FROM applications a2
        JOIN jobs jj ON jj.id = a2.job_id
        WHERE a2.freelancer_address = a.freelancer_address
      ) AS avg_response_hours,
      (
        SELECT AVG(EXTRACT(EPOCH FROM (jj.updated_at - jj.created_at)) / 86400.0)
        FROM jobs jj
        WHERE jj.freelancer_address = a.freelancer_address AND jj.status = 'completed'
      ) AS avg_completion_days,
      (
        SELECT COUNT(*) FILTER (WHERE jj.status = 'completed')::float
          / NULLIF(COUNT(*), 0)
        FROM applications ax
        JOIN jobs jj ON jj.id = ax.job_id
        WHERE ax.freelancer_address = a.freelancer_address AND ax.status = 'accepted'
      ) AS completion_rate,
      (
        SELECT COUNT(*) FILTER (WHERE jj.status = 'completed' AND jj.category = j.category)::float
          / NULLIF(COUNT(*), 0)
        FROM applications ax
        JOIN jobs jj ON jj.id = ax.job_id
        WHERE ax.freelancer_address = a.freelancer_address AND ax.status = 'accepted'
      ) AS category_match_rate
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    JOIN profiles fp ON fp.public_key = a.freelancer_address
    LEFT JOIN profiles cp ON cp.public_key = j.client_address
    WHERE j.created_at IS NOT NULL
    ORDER BY j.created_at ASC
    """
    return pd.read_sql(query, conn)


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, row in df.iterrows():
        budget = float(row["budget"] or 0)
        bid = float(row["bid_amount"] or 0)
        budget_fit = 0.5
        if budget > 0 and bid > 0:
            budget_fit = max(0.0, 1.0 - min(abs(bid - budget) / budget, 1.0))

        days_old = (pd.Timestamp.utcnow() - pd.to_datetime(row["job_created_at"])).days
        job_recency = math.exp(-max(days_old, 0) / 30)

        avg_hours = float(row["avg_response_hours"] or 0)
        response_time_score = 0.5 if avg_hours <= 0 else max(0.0, 1.0 - avg_hours / 168)

        completed = int(row["completed_jobs"] or 0)
        progress_freq = min(float(row["progress_updates"] or 0) / max(completed, 1) / 5, 1.0)

        avg_days = float(row["avg_completion_days"] or 14)
        time_signal = max(0.0, 1.0 - min(avg_days / 60, 1.0))

        accepted = row["application_status"] == "accepted"
        completed_job = row["job_status"] == "completed"
        stars = float(row["avg_freelancer_stars"] or 0)

        relevance = 0.0
        if accepted and completed_job:
            relevance = 1.0
        elif accepted:
            relevance = 0.6
        elif row["application_status"] == "pending":
            relevance = 0.2

        rows.append(
            {
                "job_id": row["job_id"],
                "freelancer_address": row["freelancer_address"],
                "job_created_at": row["job_created_at"],
                "relevance": relevance,
                "skill_overlap": skill_overlap(row["freelancer_skills"], row["job_skills"]),
                "freelancer_completion_rate": float(row["completion_rate"] or 0),
                "category_match_rate": float(row["category_match_rate"] or 0.5),
                "freelancer_rating_norm": normalize_rating(row["freelancer_rating"]),
                "budget_fit": budget_fit,
                "job_recency": job_recency,
                "response_time_score": response_time_score,
                "progress_frequency": progress_freq,
                "client_rating_norm": normalize_rating(row["client_rating"]),
                "expected_rating_signal": normalize_rating(stars if stars else None),
                "time_to_completion_signal": time_signal,
            }
        )

    return pd.DataFrame(rows)


def popularity_baseline(df: pd.DataFrame) -> float:
    """NDCG@10 for popularity/recency baseline within each job group."""
    scores = []
    for _, group in df.groupby("job_id"):
        if len(group) < 2:
            continue
        y_true = group["relevance"].values.reshape(1, -1)
        recency = pd.to_datetime(group["job_created_at"]).astype(int).values
        y_score = recency.reshape(1, -1)
        k = min(10, group.shape[0])
        scores.append(ndcg_score(y_true, y_score, k=k))
    return float(np.mean(scores)) if scores else 0.0


def model_ndcg(df: pd.DataFrame, preds: np.ndarray) -> float:
    scores = []
    grouped = df.copy()
    grouped["_pred"] = preds
    for _, group in grouped.groupby("job_id"):
        if len(group) < 2:
            continue
        y_true = group["relevance"].values.reshape(1, -1)
        y_score = group["_pred"].values.reshape(1, -1)
        k = min(10, group.shape[0])
        scores.append(ndcg_score(y_true, y_score, k=k))
    return float(np.mean(scores)) if scores else 0.0


def export_linear_weights(model: lgb.Booster) -> dict:
    importances = model.feature_importance(importance_type="gain")
    total = float(importances.sum()) or 1.0
    weights = {name: round(float(g) / total, 4) for name, g in zip(FEATURE_NAMES, importances)}
    return weights


def train(output_path: Path, split_quantile: float = 0.8, seed: int = 42):
    _set_seeds(seed)

    conn = connect()
    try:
        raw = fetch_training_frame(conn)
    finally:
        conn.close()

    if raw.empty:
        raise SystemExit("No application history found — cannot train ranking model")

    features = engineer_features(raw)
    merged = features.merge(raw[["job_id", "freelancer_address", "job_created_at"]], on=["job_id", "freelancer_address"])

    split_ts = merged["job_created_at"].quantile(split_quantile)
    train_df = merged[merged["job_created_at"] <= split_ts].copy()
    test_df = merged[merged["job_created_at"] > split_ts].copy()

    if train_df.empty or test_df.empty:
        train_df = merged.copy()
        test_df = merged.copy()

    X_train = train_df[FEATURE_NAMES].values
    y_train = train_df["relevance"].values
    X_test = test_df[FEATURE_NAMES].values

    train_groups = train_df.groupby("job_id").size().tolist()
    test_groups = test_df.groupby("job_id").size().tolist()

    ranker = lgb.LGBMRanker(
        objective="lambdarank",
        metric="ndcg",
        n_estimators=120,
        learning_rate=0.08,
        num_leaves=31,
        min_data_in_leaf=5,
        random_state=seed,
    )

    ranker.fit(
        X_train,
        y_train,
        group=train_groups,
        eval_set=[(X_test, test_df["relevance"].values)],
        eval_group=[test_groups],
        eval_at=[10],
    )

    test_preds = ranker.predict(X_test)
    baseline = popularity_baseline(test_df)
    model_score = model_ndcg(test_df, test_preds)

    weights = export_linear_weights(ranker.booster_)
    artifact = {
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "type": "linear",
        "featureNames": FEATURE_NAMES,
        "weights": weights,
        "bias": -0.05,
        "targetBlend": {
            "completion_prob": 0.5,
            "expected_rating": 0.3,
            "time_to_completion": 0.2,
        },
        "evaluation": {
            "ndcg_at_10": round(model_score, 4),
            "baseline_ndcg_at_10": round(baseline, 4),
            "temporal_split_date": str(split_ts),
            "train_samples": int(len(train_df)),
            "test_samples": int(len(test_df)),
        },
        "fairness": {
            "exploration_boost": 0.12,
            "new_freelancer_threshold_jobs": 3,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(artifact, indent=2) + "\n")

    print(f"Exported model to {output_path}")
    print(f"NDCG@10: {model_score:.4f} (baseline: {baseline:.4f})")
    if model_score <= baseline:
        print("WARNING: model did not beat popularity baseline on held-out split")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train ML ranking model")
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parents[1] / "backend/src/ml/defaultModel.json"),
    )
    parser.add_argument("--split-quantile", type=float, default=0.8)
    parser.add_argument("--seed", type=int, default=42, help="Random seed for deterministic training")
    args = parser.parse_args()
    train(Path(args.output), args.split_quantile, args.seed)
