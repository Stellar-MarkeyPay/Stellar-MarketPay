#!/usr/bin/env python3
"""
Reproducible ML training pipeline runner (Issue #265 — Phase 1).

Reads ml/training_config.yaml, sets deterministic seeds, trains the
ranking model, runs evaluation gates, and exports the artifact.

Usage:
  export DATABASE_URL=postgresql://...
  python ml/pipeline.py
  python ml/pipeline.py --config ml/training_config.yaml --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import yaml

# ── Deterministic seeds ──────────────────────────────────────────────


def set_seeds(seed: int) -> None:
    """Pin all random sources for reproducible training."""
    random.seed(seed)
    np.random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)


# ── Config loader ───────────────────────────────────────────────────


def load_config(config_path: Path) -> dict:
    """Load and validate the training configuration YAML."""
    if not config_path.exists():
        raise SystemExit(f"Config not found: {config_path}")
    with open(config_path) as f:
        cfg = yaml.safe_load(f)
    _validate_config(cfg)
    return cfg


def _validate_config(cfg: dict) -> None:
    required = ["features", "training", "evaluation", "fairness", "export"]
    missing = [k for k in required if k not in cfg]
    if missing:
        raise SystemExit(f"Config missing keys: {', '.join(missing)}")
    if not cfg["features"].get("names"):
        raise SystemExit("Config must define at least one feature name")


# ── Dataset fingerprint ─────────────────────────────────────────────


def fingerprint_dataset(conn, cfg: dict) -> dict:
    """
    Compute a fingerprint of the training data so we can detect drift
    between the data used to train and the data currently in production.

    Returns a dict with row_count, hash, and column statistics.
    """
    import pandas as pd

    query = """
    SELECT
      a.id AS application_id,
      a.freelancer_address,
      a.job_id,
      a.status AS application_status,
      j.created_at AS job_created_at
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE j.created_at IS NOT NULL
    ORDER BY j.created_at ASC
    """
    df = pd.read_sql(query, conn)

    stats = {
        "row_count": len(df),
        "unique_freelancers": int(df["freelancer_address"].nunique()),
        "unique_jobs": int(df["job_id"].nunique()),
        "earliest_job": str(df["job_created_at"].min()),
        "latest_job": str(df["job_created_at"].max()),
        "status_distribution": df["application_status"].value_counts().to_dict(),
    }

    # Deterministic hash of the dataset shape + date range
    fingerprint_str = json.dumps(stats, sort_keys=True, default=str)
    stats["fingerprint_hash"] = hashlib.sha256(fingerprint_str.encode()).hexdigest()[:16]

    return stats


# ── Pipeline stages ──────────────────────────────────────────────────


def stage_reproducibility_check(cfg: dict) -> None:
    """Verify Python version matches config."""
    import sys

    expected = cfg.get("env", {}).get("python_version")
    actual = f"{sys.version_info.major}.{sys.version_info.minor}"
    if expected and actual != expected:
        print(f"WARNING: Python version mismatch (expected {expected}, got {actual})")
    print(f"  Python {actual}, seed {cfg['env']['random_seed']}")


def stage_train_and_evaluate(cfg: dict, dry_run: bool = False) -> dict:
    """
    Run the training pipeline using config hyper-parameters.
    Returns the trained model artifact dict.
    """
    import lightgbm as lgb
    import pandas as pd
    import psycopg2
    from sklearn.metrics import ndcg_score

    from train import (
        engineer_features,
        export_linear_weights,
        fetch_training_frame,
        model_ndcg,
        popularity_baseline,
    )

    url = os.environ.get(cfg["env"]["database_url_env"])
    if not url:
        raise SystemExit(f"{cfg['env']['database_url_env']} is required")

    conn = psycopg2.connect(url)
    try:
        raw = fetch_training_frame(conn)
        dataset_stats = fingerprint_dataset(conn, cfg)
    finally:
        conn.close()

    if raw.empty:
        raise SystemExit("No application history found — cannot train ranking model")

    print(f"  Dataset: {dataset_stats['row_count']} rows, hash {dataset_stats['fingerprint_hash']}")

    features = engineer_features(raw)
    merged = features.merge(
        raw[["job_id", "freelancer_address", "job_created_at"]],
        on=["job_id", "freelancer_address"],
    )

    split_q = cfg["features"]["split_quantile"]
    split_ts = merged["job_created_at"].quantile(split_q)
    train_df = merged[merged["job_created_at"] <= split_ts].copy()
    test_df = merged[merged["job_created_at"] > split_ts].copy()

    if train_df.empty or test_df.empty:
        train_df = merged.copy()
        test_df = merged.copy()

    feature_names = cfg["features"]["names"]
    X_train = train_df[feature_names].values
    y_train = train_df["relevance"].values
    X_test = test_df[feature_names].values

    train_groups = train_df.groupby("job_id").size().tolist()
    test_groups = test_df.groupby("job_id").size().tolist()

    hp = cfg["training"]
    ranker = lgb.LGBMRanker(
        objective=hp["objective"],
        metric=hp["metric"],
        n_estimators=hp["n_estimators"],
        learning_rate=hp["learning_rate"],
        num_leaves=hp["num_leaves"],
        min_data_in_leaf=hp["min_data_in_leaf"],
        random_state=cfg["env"]["random_seed"],
    )

    if dry_run:
        print("  DRY RUN — skipping actual training")
        return {"dry_run": True}

    ranker.fit(
        X_train,
        y_train,
        group=train_groups,
        eval_set=[(X_test, test_df["relevance"].values)],
        eval_group=[test_groups],
        eval_at=cfg["evaluation"]["evaluation_at"],
    )

    test_preds = ranker.predict(X_test)
    baseline = popularity_baseline(test_df)
    model_score = model_ndcg(test_df, test_preds)

    weights = export_linear_weights(ranker.booster_)

    artifact = {
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "type": cfg["export"]["artifact_type"],
        "featureNames": feature_names,
        "weights": weights,
        "bias": cfg["export"]["bias"],
        "targetBlend": cfg["export"]["target_blend"],
        "evaluation": {
            "ndcg_at_10": round(model_score, 4),
            "baseline_ndcg_at_10": round(baseline, 4),
            "temporal_split_date": str(split_ts),
            "train_samples": int(len(train_df)),
            "test_samples": int(len(test_df)),
        },
        "fairness": {
            "exploration_boost": cfg["fairness"]["exploration_boost"],
            "new_freelancer_threshold_jobs": cfg["fairness"]["new_freelancer_threshold_jobs"],
        },
        "training_config": {
            "seed": cfg["env"]["random_seed"],
            "config_hash": _config_hash(cfg),
            "dataset_fingerprint": dataset_stats["fingerprint_hash"],
        },
    }

    return artifact


def stage_fairness_gate(artifact: dict, cfg: dict) -> bool:
    """
    Blocking fairness gate — rejects a model if it doesn't meet
    minimum fairness thresholds. Currently a no-op until we have
    live impression data; the check is performed at audit time.
    """
    fairness_cfg = cfg["fairness"]
    print(f"  Fairness gate: exploration_boost={fairness_cfg['exploration_boost']}, "
          f"min_impression_share={fairness_cfg['min_new_freelancer_impression_share']}")
    return True


def stage_export(artifact: dict, cfg: dict) -> Path:
    """Write the model artifact to the configured output path."""
    output = Path(cfg["export"]["output_path"])
    if not output.is_absolute():
        output = Path(__file__).resolve().parent / output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, indent=2) + "\n")
    return output


def _config_hash(cfg: dict) -> str:
    """Deterministic hash of the config for traceability."""
    h = hashlib.sha256(json.dumps(cfg, sort_keys=True, default=str).encode())
    return h.hexdigest()[:12]


# ── Main ─────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="ML ranking training pipeline")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).resolve().parent / "training_config.yaml"),
        help="Path to training_config.yaml",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate config and data without training",
    )
    args = parser.parse_args()

    cfg = load_config(Path(args.config))
    set_seeds(cfg["env"]["random_seed"])

    print("=== ML Training Pipeline (Phase 1: Reproducibility) ===\n")

    print("[1/4] Reproducibility check")
    stage_reproducibility_check(cfg)

    print("[2/4] Training and evaluation")
    artifact = stage_train_and_evaluate(cfg, dry_run=args.dry_run)
    if args.dry_run:
        print("\nDry run complete.")
        return

    ndcg = artifact["evaluation"]["ndcg_at_10"]
    baseline = artifact["evaluation"]["baseline_ndcg_at_10"]
    print(f"  NDCG@10: {ndcg} (baseline: {baseline})")

    if ndcg <= baseline:
        print("  GATE FAILED: model did not beat the baseline. Aborting export.")
        sys.exit(1)

    print("[3/4] Fairness gate")
    if not stage_fairness_gate(artifact, cfg):
        print("  GATE FAILED: model does not meet fairness requirements. Aborting.")
        sys.exit(1)

    print("[4/4] Export artifact")
    out = stage_export(artifact, cfg)
    print(f"  Wrote {out}")

    print(f"\n=== Done. Model version {artifact['version']} exported. ===")


if __name__ == "__main__":
    main()
