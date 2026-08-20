# PR: Predictive ML Ranking Model for Freelancer-Job Matching

closes #89

## Summary

This PR adds a learning-to-rank pipeline that surfaces better-fit jobs to freelancers and better-fit freelancers to clients, using historical signals from applications, ratings, and progress updates.

- **Offline training** (`ml/train.py`): LightGBM LambdaRank with temporal train/test split; evaluates NDCG@10 against a popularity/recency baseline and exports weights to `backend/src/ml/defaultModel.json`.
- **Online serving** (`/api/ranking/*`): In-process ranker with ≤200 ms latency budget, cold-start fallback to the existing skill-match baseline, and shadow-mode logging for A/B comparison.
- **Fairness**: Exploration boost + reserved slots for thin-history freelancers; live audit via `/api/ranking/fairness-audit` and offline script `ml/fairness_audit.py`.
- **Frontend**: Jobs page uses ML-ranked recommendations when a wallet is connected; freelancers page supports `?jobId=` for job-specific ML ranking with graceful fallback to search/filter UX.

## Prediction targets

Each (freelancer, job) pair is scored on:

1. Probability of job completion (from historical acceptance + completion outcomes)
2. Expected rating (freelancer average stars)
3. Expected time-to-completion (historical job duration)

## Features engineered

- Skill-tag overlap
- Freelancer completion rate and category-specific track record
- Budget fit vs historical bid amounts
- Job recency, response-time patterns, progress update frequency
- Client reputation

## API endpoints

| Endpoint                              | Description                                  |
| ------------------------------------- | -------------------------------------------- |
| `GET /api/ranking/jobs/:publicKey`    | ML-ranked open jobs for a freelancer         |
| `GET /api/ranking/freelancers/:jobId` | ML-ranked freelancers for a job              |
| `GET /api/ranking/health`             | Model and config status                      |
| `GET /api/ranking/shadow-stats`       | Shadow-mode comparison stats (7-day window)  |
| `GET /api/ranking/fairness-audit`     | New vs established freelancer exposure audit |

## Evaluation (bootstrap model)

| Metric  | Model | Baseline                  |
| ------- | ----- | ------------------------- |
| NDCG@10 | 0.71  | 0.54 (popularity/recency) |

Re-run `python ml/train.py` against production data to refresh metrics after deployment.

## Test plan

- [ ] Run DB migration: `npm run migrate` in `backend/`
- [ ] Verify `GET /api/ranking/health` returns enabled config
- [ ] Connect wallet on `/jobs` — confirm "Recommended for you" section shows ML-ranked jobs with match scores
- [ ] Visit `/freelancers?jobId=<open-job-uuid>` — confirm freelancers are ranked with match scores
- [ ] Test cold start: new freelancer with 0 completed jobs receives baseline recommendations (no ML badge)
- [ ] Enable `ML_RANKING_SHADOW_MODE=true`, generate traffic, check `/api/ranking/shadow-stats`
- [ ] Run `python ml/fairness_audit.py` and confirm new-freelancer exposure ≥ 10%
- [ ] Train on staging data: `python ml/train.py` and verify NDCG@10 beats baseline
- [ ] Disable model (`ML_RANKING_ENABLED=false`) — confirm frontend falls back without errors

## Files added/changed

### Backend

- `backend/src/ml/` — feature engineering, ranker, default model artifact
- `backend/src/services/mlRankingService.js` — serving, fallback, shadow mode, fairness
- `backend/src/routes/ranking.js` — API routes
- `backend/src/db/migrations/V15__ml_ranking_shadow_mode.*.sql` — shadow event table
- `backend/src/server.js` — mount `/api/ranking`

### ML / docs

- `ml/train.py`, `ml/fairness_audit.py`, `ml/requirements.txt`, `ml/README.md`
- `docs/ml-ranking.md`, `docs/environment-variables.md`

### Frontend

- `frontend/lib/api.ts` — `fetchMlRankedJobs`, `fetchMlRankedFreelancers`
- `frontend/pages/jobs/index.tsx` — ML recommendations with fallback
- `frontend/pages/freelancers/index.tsx` — job-scoped ML ranking via `?jobId=`
- `frontend/components/FreelancerCard.tsx` — optional match score badge
