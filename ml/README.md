# ML Ranking Model

Predictive learning-to-rank for freelancer–job matching.

**Issue #265 — Productionise the ML pipeline**

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Training (Python)                                              │
│  training_config.yaml → pipeline.py → model artifact + registry │
└────────────────────────┬────────────────────────────────────────┘
                         │ exports model artifact
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Serving (Node.js, in-process)                                  │
│  featureStore.js ← feature_contract.json → ranker.js            │
│  modelRegistry.js ← registry.json → mlRankingService.js         │
│  driftMonitor.js → alerts                                       │
└────────────────────────┬────────────────────────────────────────┘
                         │ API routes
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                             │
│  /pages/jobs, /pages/freelancers                                │
└─────────────────────────────────────────────────────────────────┘
```

## Components

| Component           | Location                                         |
| ------------------- | ------------------------------------------------ |
| Training config     | `ml/training_config.yaml`                        |
| Feature contract    | `ml/feature_contract.json`                       |
| Pipeline runner     | `ml/pipeline.py`                                 |
| Training script     | `ml/train.py`                                    |
| Fairness audit      | `ml/fairness_audit.py`                           |
| Feature store       | `backend/src/ml/featureStore.js`                 |
| Feature engineering | `backend/src/ml/featureEngineering.js`           |
| In-process ranker   | `backend/src/ml/ranker.js`                       |
| Model registry      | `backend/src/ml/modelRegistry.js`                |
| Drift monitor       | `backend/src/ml/driftMonitor.js`                 |
| Serving API         | `backend/src/services/mlRankingService.js`       |
| API routes          | `backend/src/routes/ranking.js`                  |
| Shadow-mode storage | `ml_ranking_shadow_events` table (V15 migration) |

## Features (11)

All features are defined in `ml/feature_contract.json` — the single source of truth for training and serving.

| Feature                   | Description                         |
| ------------------------- | ----------------------------------- |
| `skill_overlap`           | Fraction of job skills matching     |
| `freelancer_completion_rate` | Historical completion rate       |
| `category_match_rate`     | Category-specific completion rate   |
| `freelancer_rating_norm`  | Normalized freelancer rating        |
| `budget_fit`              | Bid-to-budget ratio                 |
| `job_recency`             | Exponential decay by job age        |
| `response_time_score`     | Application response latency        |
| `progress_frequency`      | Progress updates per job            |
| `client_rating_norm`      | Client's normalized rating          |
| `expected_rating_signal`  | Average stars from ratings          |
| `time_to_completion_signal` | Historical completion speed       |

## Training

### Quick start

```bash
cd ml
pip install -r requirements.txt
export DATABASE_URL=postgresql://user:pass@localhost:5432/marketpay
python pipeline.py
```

### Reproducible runs

The pipeline reads `training_config.yaml` and sets deterministic seeds:

```bash
python pipeline.py --config ml/training_config.yaml
python pipeline.py --dry-run  # validate without training
```

Every model artifact records:
- The config hash (for traceability)
- The dataset fingerprint (to detect drift)
- The random seed used

### Standalone training

```bash
python train.py --output ../backend/src/ml/defaultModel.json --seed 42
```

## Model Registry

Models are versioned and tracked in `ml/models/registry.json`:

- **Staging** → newly registered, not yet promoted
- **Production** → actively serving traffic
- **Archived** → superseded or rolled back

### Promotion gate

A model must pass both:
1. **Evaluation gate**: `ndcg_at_10 > baseline_ndcg_at_10`
2. **Fairness gate**: new freelancer impression share >= 10%

### Rollback

```bash
# Via API
POST /api/ranking/rollback/{version}

# Via code
const { rollbackModel } = require("./ml/modelRegistry");
rollbackModel("2025.08.22");
```

## Drift Monitoring

The drift monitor tracks:
- **Prediction drift**: PSI (Population Stability Index) on live score distributions
- **Feature drift**: Statistical tests on input feature distributions

### Configuration

| Env var                      | Default | Description                       |
| ---------------------------- | ------- | --------------------------------- |
| `ML_DRIFT_KS_THRESHOLD`      | `0.15`  | Maximum KS statistic before alert |
| `ML_DRIFT_PSI_THRESHOLD`     | `0.2`   | Maximum PSI before alert          |
| `ML_DRIFT_MIN_SAMPLES`       | `100`   | Minimum samples for detection     |
| `ML_DRIFT_WINDOW_HOURS`      | `24`    | Look-back window for drift        |

### API

```
GET /api/ranking/drift          → drift check results
GET /api/ranking/model-registry → model history and status
```

## Fairness Audit

```bash
python ml/fairness_audit.py
```

Compares impression share for new vs established freelancers. Mitigation is built into serving:

- `exploration_boost` in model config for thin-history freelancers
- `ML_RANKING_EXPLORATION_BUDGET` (default 15%) reserves ranking slots for exploration

### API

```
GET /api/ranking/fairness-audit → live fairness exposure audit
```

## Serving

| Endpoint                              | Description                  |
| ------------------------------------- | ---------------------------- |
| `GET /api/ranking/jobs/:publicKey`    | Ranked jobs for a freelancer |
| `GET /api/ranking/freelancers/:jobId` | Ranked freelancers for a job |
| `GET /api/ranking/health`             | Model + config status        |
| `GET /api/ranking/shadow-stats`       | Shadow-mode comparison stats |
| `GET /api/ranking/fairness-audit`     | Live fairness exposure audit |
| `GET /api/ranking/drift`              | Drift monitoring status      |
| `GET /api/ranking/model-registry`     | Model version history        |
| `POST /api/ranking/rollback/:version` | Roll back to a model version |

### Environment variables

| Variable                            | Default                            | Description                               |
| ----------------------------------- | ---------------------------------- | ----------------------------------------- |
| `ML_RANKING_ENABLED`                | `true`                             | Set `false` to force baseline fallback    |
| `ML_RANKING_SHADOW_MODE`            | `false`                            | Log ML vs baseline rankings               |
| `ML_RANKING_LATENCY_BUDGET_MS`      | `200`                              | Warn threshold for p95 monitoring         |
| `ML_RANKING_COLD_START_MIN_HISTORY` | `2`                                | Min completed jobs before ML ranking      |
| `ML_RANKING_EXPLORATION_BUDGET`     | `0.15`                             | Fraction of slots reserved for new talent |
| `ML_RANKING_MODEL_PATH`             | `backend/src/ml/defaultModel.json` | Exported model artifact                   |
| `ML_DRIFT_KS_THRESHOLD`             | `0.15`                             | Maximum KS statistic before alert         |
| `ML_DRIFT_PSI_THRESHOLD`            | `0.2`                              | Maximum PSI before alert                  |
| `ML_DRIFT_MIN_SAMPLES`              | `100`                              | Minimum samples for detection             |
| `ML_DRIFT_WINDOW_HOURS`             | `24`                               | Look-back window for drift                |

### Cold-start fallback

Users with fewer than `ML_RANKING_COLD_START_MIN_HISTORY` completed jobs receive the existing skill-match / recency baseline (`recommendationService`) instead of ML scores.

### Deterministic fallback

When the model is unavailable (file missing, corrupt, or unparseable), serving degrades to a **deterministic non-ML ordering** based on completion rate + recency — the same ordering used for cold-start freelancers.

## Retraining Cadence

| Trigger                        | Frequency  | Who                    |
| ------------------------------ | ---------- | ---------------------- |
| Scheduled retrain              | Weekly     | CI/CD (automated)      |
| Drift alert (PSI > 0.2)       | On-demand  | ML engineer on-call    |
| New fairness threshold breach  | On-demand  | ML engineer on-call    |
| Major data schema change       | Immediate  | Backend team           |
| New feature added              | After deploy| ML engineer           |

### Process

1. `pipeline.py` runs with the committed `training_config.yaml`
2. Model is registered in staging
3. Evaluation + fairness gates are checked automatically
4. If gates pass, model is promoted to production
5. If gates fail, model stays in staging and an alert is raised
6. Rollback is available via `POST /api/ranking/rollback/:version`

### Accountability

- **Model quality**: ML engineer (assigned via GitHub issue)
- **Data quality**: Backend team (schema changes)
- **Fairness**: Product + ML engineer (threshold reviews)
- **Drift response**: ML engineer on-call rotation

## Shadow mode / A-B

Enable shadow mode to log both ML and baseline rankings without changing user-visible order:

```bash
ML_RANKING_SHADOW_MODE=true
```

Query `/api/ranking/shadow-stats` after a bake-in period to compare ranking distributions and downstream match outcomes.
