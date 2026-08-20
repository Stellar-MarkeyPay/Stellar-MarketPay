# ML Ranking Model (Issue #89)

Predictive learning-to-rank for freelancer–job matching.

## Overview

| Component           | Location                                         |
| ------------------- | ------------------------------------------------ |
| Training pipeline   | `ml/train.py`                                    |
| Fairness audit      | `ml/fairness_audit.py`                           |
| Feature engineering | `backend/src/ml/featureEngineering.js`           |
| In-process ranker   | `backend/src/ml/ranker.js`                       |
| Serving API         | `backend/src/routes/ranking.js`                  |
| Shadow-mode storage | `ml_ranking_shadow_events` table (V15 migration) |

## Prediction targets

Each (freelancer, job) pair is scored on:

1. **Completion probability** — derived from historical acceptance + job completion outcomes
2. **Expected rating** — freelancer's average stars from `ratings`
3. **Time-to-completion** — historical duration from job creation to completion

These are blended into a composite ranking score (LambdaMART-style training via LightGBM).

## Features

- Skill-tag overlap
- Freelancer completion rate and category-specific track record
- Budget fit vs historical bid amounts
- Job recency
- Response-time patterns (application latency)
- Progress update frequency
- Client reputation

## Training

```bash
cd ml
pip install -r requirements.txt
export DATABASE_URL=postgresql://user:pass@localhost:5432/marketpay
python train.py --output ../backend/src/ml/defaultModel.json
```

Training uses a **temporal split** (default: 80% oldest jobs → train, 20% newest → evaluate) to prevent leakage.

Offline metric: **NDCG@10** compared against a popularity/recency baseline.

## Fairness audit

```bash
python ml/fairness_audit.py
```

Compares impression share for new vs established freelancers. Mitigation is built into serving:

- `exploration_boost` in model config for thin-history freelancers
- `ML_RANKING_EXPLORATION_BUDGET` (default 15%) reserves ranking slots for exploration

## Serving

| Endpoint                              | Description                  |
| ------------------------------------- | ---------------------------- |
| `GET /api/ranking/jobs/:publicKey`    | Ranked jobs for a freelancer |
| `GET /api/ranking/freelancers/:jobId` | Ranked freelancers for a job |
| `GET /api/ranking/health`             | Model + config status        |
| `GET /api/ranking/shadow-stats`       | Shadow-mode comparison stats |
| `GET /api/ranking/fairness-audit`     | Live fairness exposure audit |

### Environment variables

| Variable                            | Default                            | Description                               |
| ----------------------------------- | ---------------------------------- | ----------------------------------------- |
| `ML_RANKING_ENABLED`                | `true`                             | Set `false` to force baseline fallback    |
| `ML_RANKING_SHADOW_MODE`            | `false`                            | Log ML vs baseline rankings               |
| `ML_RANKING_LATENCY_BUDGET_MS`      | `200`                              | Warn threshold for p95 monitoring         |
| `ML_RANKING_COLD_START_MIN_HISTORY` | `2`                                | Min completed jobs before ML ranking      |
| `ML_RANKING_EXPLORATION_BUDGET`     | `0.15`                             | Fraction of slots reserved for new talent |
| `ML_RANKING_MODEL_PATH`             | `backend/src/ml/defaultModel.json` | Exported model artifact                   |

### Cold-start fallback

Users with fewer than `ML_RANKING_COLD_START_MIN_HISTORY` completed jobs receive the existing skill-match / recency baseline (`recommendationService`) instead of ML scores.

## Shadow mode / A-B

Enable shadow mode to log both ML and baseline rankings without changing user-visible order:

```bash
ML_RANKING_SHADOW_MODE=true
```

Query `/api/ranking/shadow-stats` after a bake-in period to compare ranking distributions and downstream match outcomes.
