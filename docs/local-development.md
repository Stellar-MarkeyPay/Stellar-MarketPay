# Local Development Environment

This guide documents the local Docker Compose stack, how the backend and frontend connect to it, and the commands used for migrations and dataset seeding.

## Overview

There are two Compose files in the root of the repository:

- `docker-compose.yml` — the local development stack used for everyday engineering work.
- `docker-compose.prod.yml` — the production-style stack used for monitoring and deployment checks.

The local workflow is:

1. Start the shared dependencies with Docker (`postgres`, `redis`).
2. Run the backend and frontend locally with Node.js.
3. Point the app at the local Postgres and Redis ports.
4. Use the repo migration and seed scripts to prepare the database.

This keeps the database and cache state close to real runtime behavior while letting the application code hot-reload during development.

---

## Local Compose stack (`docker-compose.yml`)

### Services

| Service | Purpose | Port(s) exposed | Notes |
| --- | --- | --- | --- |
| `frontend` | Next.js development server | `3000:3000` | Runs `npm run dev` with hot reload |
| `backend` | Express API server | `4000:4000` | Runs `npm run dev` and connects to Postgres + Redis |
| `redis` | In-memory cache | `6379:6379` | Used by cache and queue-related services |
| `postgres` | PostgreSQL database | `5432:5432` | Stores escrow state and application data |

### Environment wiring

The local stack intentionally exposes the database and cache ports for developer tooling and local app access:

- Frontend expects `NEXT_PUBLIC_API_URL=http://localhost:4000`
- Backend expects `DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork`
- Backend expects `REDIS_URL=redis://localhost:6379`
- The app may run straight from `npm run dev` on the host while Docker provides the dependency services

### Start the local dependency stack

```bash
docker compose up -d postgres redis
```

Then run the app on the host:

```bash
# Terminal 1: backend
cd backend
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork \
REDIS_URL=redis://localhost:6379 \
JWT_SECRET=dev-secret-change-me \
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
npm run dev

# Terminal 2: frontend
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:4000 \
NEXT_PUBLIC_USE_CONTRACT_MOCK=true \
npm run dev
```

This is the recommended workflow for local feature work because it keeps the app code editable while the shared services remain stable and portable.

---

## Production-style Compose stack (`docker-compose.prod.yml`)

This file is not the default local setup; it is a production-style stack for monitoring and operational checks.

### Services

| Service | Purpose | Port(s) exposed | Notes |
| --- | --- | --- | --- |
| `frontend` | Production frontend image | `3000:3000` | Built from `frontend/Dockerfile` |
| `backend` | Production backend image | `4000:4000` | Built from `backend/Dockerfile` |
| `node-exporter` | Host metrics exporter | `9100:9100` | Prometheus scraping target |
| `prometheus` | Metrics collector | `9090:9090` | Monitors backend and node-exporter |
| `grafana` | Metrics dashboard | `3001:3000` | UI available at `http://localhost:3001` |

### Start the production-style stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This stack is useful for verifying the runtime containers, Prometheus scraping, and Grafana dashboards before deployment.

---

## Ports and how to change them

### Local development ports

| Service | Default port | Override location |
| --- | --- | --- |
| Frontend | `3000` | `docker-compose.yml` and `frontend/.env.local` |
| Backend API | `4000` | `docker-compose.yml`, `backend/.env`, `PORT` |
| Postgres | `5432` | `docker-compose.yml` `postgres` `ports` entry |
| Redis | `6379` | `docker-compose.yml` `redis` `ports` entry |

### If a port conflicts

Edit the host-side value in the Compose file:

```yaml
ports:
  - "3001:3000"
```

Then update the matching app environment:

```bash
# backend/.env
PORT=4001
ALLOWED_ORIGINS=http://localhost:3001

# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4001
```

For production monitoring:

- Prometheus listens on `9090`
- Grafana exposes its web UI on `3001` to avoid clashing with the app frontend on `3000`
- `node-exporter` stays on `9100` unless a conflict requires changing it

---

## Migrations

The backend runs schema migrations from `backend/src/db/migrations` through the shared migration runner in `backend/src/db/migrate.js`.

### Run migrations manually

```bash
cd backend
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork \
npm run migrate
```

The migration script is idempotent and tracks applied versions in the `schema_migrations` table.

### Roll back the last migration

```bash
cd backend
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork \
npm run migrate:rollback
```

This is useful when validating schema changes locally before a new release.

---

## Seed data

The database seed script is located at `scripts/db/seed.sh` and wraps the Python generator in `scripts/db/seed.py`.

### Typical local seeding command

```bash
cd .
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork \
PGUSER=stellarwork \
PGPASSWORD=stellarwork_dev \
PGHOST=localhost \
PGPORT=5432 \
PGDATABASE=stellarwork \
./scripts/db/seed.sh --scale small --seed 42
```

Common variations:

```bash
./scripts/db/seed.sh --scale small --seed 42
./scripts/db/seed.sh --scale medium --seed 42
./scripts/db/seed.sh --scale large --seed 42
```

The script is deterministic: the same `--seed` value produces the same data set. It is intended for realistic local testing, QA, and preview environments.

---

## Mixed local/Compose workflow

This is the most common flow for active development on a developer machine:

1. Start dependencies in Docker:

   ```bash
   docker compose up -d postgres redis
   ```

2. Run the backend locally with the Docker database and cache URLs:

   ```bash
   cd backend
   DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork \
   REDIS_URL=redis://localhost:6379 \
   JWT_SECRET=dev-secret-change-me \
   npm run dev
   ```

3. Run the frontend locally against the backend:

   ```bash
   cd frontend
   NEXT_PUBLIC_API_URL=http://localhost:4000 \
   NEXT_PUBLIC_USE_CONTRACT_MOCK=true \
   npm run dev
   ```

4. Open the app at `http://localhost:3000`.

This setup keeps the app responsive and editable while still using the same Postgres schema and Redis service shape as the deployment environment.

---

## Notes for a clean machine

On a fresh environment, the setup is:

```bash
# install dependencies
cd backend && npm install
cd ../frontend && npm install

# start shared services
cd ..
docker compose up -d postgres redis

# initialize schema
cd backend
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork npm run migrate

# seed test data
cd ..
./scripts/db/seed.sh --scale small --seed 42

# run app
cd backend && DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork REDIS_URL=redis://localhost:6379 JWT_SECRET=dev-secret-change-me npm run dev
cd ../frontend && NEXT_PUBLIC_API_URL=http://localhost:4000 NEXT_PUBLIC_USE_CONTRACT_MOCK=true npm run dev
```

This is the documented local flow that matches the repository configuration and scripts as they exist today.
