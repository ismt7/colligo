# colligo

**colligo** is a lightweight RSS feed collection and delivery API server built with Node.js, TypeScript, Express, and Prisma. A background worker periodically fetches configured RSS feeds, deduplicates articles, and persists them to a relational database. A REST API exposes feeds and articles for downstream consumers.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [API Server Responsibilities](#api-server-responsibilities)
4. [Worker Responsibilities](#worker-responsibilities)
5. [Project Structure](#project-structure)
6. [Environment Variables](#environment-variables)
7. [Local Development Setup](#local-development-setup)
8. [Docker Compose Usage](#docker-compose-usage)
9. [API Reference](#api-reference)
10. [Development Commands](#development-commands)

---

## Overview

colligo solves the problem of aggregating multiple RSS feeds into a single, queryable store. It separates concerns cleanly:

- **API process** — serves REST endpoints for managing feed subscriptions and reading collected articles.
- **Worker process** — runs on a configurable interval, fetches each subscribed feed, parses entries, deduplicates by URL, and upserts new articles.

Both processes share the same Prisma database client and PostgreSQL instance, making the data immediately available to API consumers after each fetch cycle.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose                                             │
│                                                             │
│  ┌──────────────┐   HTTP    ┌──────────────────────────┐   │
│  │   API Server  │ ◄──────► │  External Clients /       │   │
│  │  (Express +   │          │  Downstream Consumers     │   │
│  │   Prisma)     │          └──────────────────────────┘   │
│  └──────┬───────┘                                          │
│         │  Prisma ORM (shared schema)                      │
│  ┌──────▼───────┐                                          │
│  │  PostgreSQL   │                                          │
│  │  Database     │                                          │
│  └──────▲───────┘                                          │
│         │  Prisma ORM                                      │
│  ┌──────┴───────┐   HTTP    ┌──────────────────────────┐   │
│  │  RSS Worker  │ ─────────►│  External RSS Feed URLs   │   │
│  │  (scheduler) │           └──────────────────────────┘   │
│  └──────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
```

**Data flow:**

1. An operator registers a feed URL via `POST /feeds`.
2. The worker wakes on a configurable interval (default: every 60 minutes).
3. For each active feed the worker fetches the RSS/Atom XML, parses entries, and skips any article whose URL already exists in the database.
4. New articles are bulk-upserted with full metadata (title, URL, summary, published date).
5. API clients poll `GET /feeds/:id/articles` or `GET /articles` to consume the latest collected items.

---

## API Server Responsibilities

The Express application (`src/api/`) handles:

| Concern | Detail |
|---|---|
| **Feed CRUD** | Create, read, update, and delete feed subscriptions |
| **Article listing** | Paginated article queries with optional feed and date filters |
| **Health check** | `GET /health` returns `200 OK` for liveness probes |
| **Input validation** | Request body and query-parameter validation with early error responses |
| **Error handling** | Centralised middleware converts Prisma errors and validation errors to consistent JSON responses |

The API server does **not** perform any RSS fetching. It is purely a data-access layer on top of the database.

---

## Worker Responsibilities

The worker (`src/worker/`) handles:

| Concern | Detail |
|---|---|
| **Scheduler** | Runs a fetch cycle on a configurable interval using `node-cron` or `setInterval` |
| **Feed discovery** | Queries the database for all feeds with `active = true` |
| **RSS/Atom parsing** | Downloads feed XML and parses entries with `rss-parser` |
| **Deduplication** | Checks each entry's URL against `processed_urls`; skips entries that already exist |
| **Article upsert** | Bulk-inserts new articles; marks the feed's `lastFetchedAt` timestamp |
| **Error isolation** | A failure in one feed does not stop processing of other feeds |
| **Logging** | Structured JSON logs for each fetch cycle (feed URL, new count, skip count, errors) |

The worker does **not** expose any HTTP endpoints. It runs as an independent long-lived process.

---

## Project Structure

```
colligo/
├── src/
│   ├── api/
│   │   ├── app.ts            # Express app bootstrap
│   │   ├── routes/
│   │   │   ├── feeds.ts      # /feeds endpoints
│   │   │   └── articles.ts   # /articles endpoints
│   │   └── middleware/
│   │       └── errorHandler.ts
│   ├── lib/
│   │   ├── prisma.ts         # Prisma client singleton
│   │   └── logger.ts         # Structured logger
│   ├── worker/
│   │   ├── index.ts          # Worker entrypoint and scheduler
│   │   ├── fetchFeeds.ts     # Fetch + parse feeds and persist articles
│   │   └── rssParser.ts      # RSS/Atom normalisation helpers
├── prisma/
│   ├── schema.prisma         # Data model (Feed, Article)
│   └── migrations/           # Prisma migration history
├── Dockerfile                # Multi-stage Node.js 22 image
├── .dockerignore
├── docker-compose.yml        # Orchestrates api, worker, and db
├── .env.example              # Template for required environment variables
├── tsconfig.json
├── package.json
└── README.md
```

---

## Environment Variables

Copy `.env.example` to `.env` before running locally or via Docker Compose.

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/colligo` |
| `API_PORT` | | `3000` | Port the Express API server listens on |
| `WORKER_INTERVAL_MINUTES` | | `60` | How often the worker runs a full fetch cycle (minutes) |
| `WORKER_REQUEST_TIMEOUT_MS` | | `10000` | HTTP timeout per feed fetch (milliseconds) |
| `LOG_LEVEL` | | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | | `development` | Set to `production` in deployed environments |

### Example `.env`

```dotenv
DATABASE_URL=postgresql://colligo:colligo@localhost:5432/colligo
API_PORT=3000
WORKER_INTERVAL_MINUTES=60
WORKER_REQUEST_TIMEOUT_MS=10000
LOG_LEVEL=info
NODE_ENV=development
```

---

## Local Development Setup

### Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9 (or npm/yarn)
- Docker Desktop (for PostgreSQL, or provide your own instance)

### Steps

```bash
# 1. Clone and enter the repo
git clone <repo-url> colligo
cd colligo

# 2. Install dependencies
pnpm install

# 3. Start a local PostgreSQL instance
docker compose up -d db

# 4. Configure environment
cp .env.example .env
# Edit .env and set DATABASE_URL if needed

# 5. Run database migrations
pnpm db:migrate

# 6. Start the API server (hot-reload)
pnpm dev:api

# 7. Start the worker (in a separate terminal)
pnpm dev:worker
```

The API will be available at `http://localhost:3000`.

---

## Docker Compose Usage

The `docker-compose.yml` defines three services: `api`, `worker`, and `db`. Both application services share the same image built from the root `Dockerfile`.

### Start all services

```bash
docker compose up -d --build
```

### View logs

```bash
# All services
docker compose logs -f

# API only
docker compose logs -f api

# Worker only
docker compose logs -f worker
```

### Stop all services

```bash
docker compose down
```

### Destroy everything including volumes

```bash
docker compose down -v
```

### Run migrations in Docker

```bash
docker compose run --rm api pnpm db:migrate:deploy
```

### Service summary

| Service | Port | Description |
|---|---|---|
| `api` | `3000` | Express REST API |
| `worker` | — | Background RSS fetch worker (no exposed port) |
| `db` | `5432` | PostgreSQL 16 database |

---

## API Reference

All responses are `application/json`. Error responses follow the shape `{ "error": "message" }`.

### Health

```
GET /health
→ 200 { "status": "ok" }
```

### Feeds

| Method | Path | Description |
|---|---|---|
| `GET` | `/feeds` | List all registered feeds |
| `POST` | `/feeds` | Register a new feed |
| `GET` | `/feeds/:id` | Get a single feed by ID |
| `PATCH` | `/feeds/:id` | Update feed properties (e.g. `active`, `name`) |
| `DELETE` | `/feeds/:id` | Delete a feed and its articles |

**Register a feed — request body:**

```json
{
  "name": "Tech Crunch",
  "url": "https://techcrunch.com/feed/",
  "active": true
}
```

### Articles

| Method | Path | Description |
|---|---|---|
| `GET` | `/articles` | List all articles (paginated) |
| `GET` | `/feeds/:id/articles` | List articles for a specific feed |
| `GET` | `/articles/:id` | Get a single article by ID |

**Query parameters for list endpoints:**

| Parameter | Type | Description |
|---|---|---|
| `page` | integer | Page number (default: `1`) |
| `limit` | integer | Items per page (default: `20`, max: `100`) |
| `since` | ISO 8601 | Return articles published after this timestamp |

---

## Development Commands

| Command | Description |
|---|---|
| `pnpm dev:api` | Start API in watch mode (tsx watch) |
| `pnpm dev:worker` | Start worker in watch mode |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start:api` | Run compiled API server |
| `pnpm start:worker` | Run compiled worker |
| `pnpm db:migrate` | Apply pending Prisma migrations |
| `pnpm db:migrate:deploy` | Apply migrations in non-interactive environments |
| `pnpm db:generate` | Regenerate Prisma client after schema changes |
| `pnpm db:studio` | Open Prisma Studio (browser-based DB UI) |
| `pnpm db:reset` | Drop and recreate the database (dev only) |

---

## License

MIT
