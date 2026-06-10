# colligo

**colligo** は、Node.js / TypeScript / Express / Prisma で構築された軽量な RSS 収集・配信 API サーバーです。バックグラウンドワーカーが定期的に登録済み RSS フィードを取得し、記事を重複排除して RDB に保存します。REST API からはフィードと記事を参照できます。

---

## 目次

- [colligo](#colligo)
  - [目次](#目次)
  - [概要](#概要)
  - [アーキテクチャ](#アーキテクチャ)
  - [API サーバーの責務](#api-サーバーの責務)
  - [ワーカーの責務](#ワーカーの責務)
  - [プロジェクト構成](#プロジェクト構成)
  - [環境変数](#環境変数)
    - [`.env` の例](#env-の例)
  - [ローカル開発セットアップ](#ローカル開発セットアップ)
    - [前提](#前提)
    - [手順](#手順)
  - [Docker Compose の使い方](#docker-compose-の使い方)
    - [すべて起動](#すべて起動)
    - [ログ確認](#ログ確認)
    - [すべて停止](#すべて停止)
    - [ボリュームも含めて削除](#ボリュームも含めて削除)
    - [Docker 上でマイグレーション実行](#docker-上でマイグレーション実行)
    - [サービス一覧](#サービス一覧)
  - [Swagger / OpenAPI](#swagger--openapi)
  - [API リファレンス](#api-リファレンス)
    - [Health](#health)
    - [Feeds](#feeds)
    - [Articles](#articles)
  - [開発コマンド](#開発コマンド)
  - [ライセンス](#ライセンス)

---

## 概要

colligo は、複数の RSS フィードを 1 つの検索可能なストアに集約するためのアプリケーションです。責務を明確に分離しています。

- **API プロセス** — フィード購読管理と収集済み記事参照のための REST エンドポイントを提供
- **Worker プロセス** — 設定間隔で起動し、購読中フィードを取得・解析し、URL ベースで重複排除して新規記事を upsert

両プロセスは同じ Prisma クライアントと PostgreSQL を共有するため、各フェッチサイクル後のデータを API クライアントが即時に参照できます。

---

## アーキテクチャ

```text
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose                                             │
│                                                             │
│  ┌──────────────┐   HTTP    ┌──────────────────────────┐   │
│  │   API Server  │ ◄──────► │  外部クライアント /      │   │
│  │  (Express +   │          │  下流コンシューマ         │   │
│  │   Prisma)     │          └──────────────────────────┘   │
│  └──────┬───────┘                                          │
│         │  Prisma ORM（共有スキーマ）                      │
│  ┌──────▼───────┐                                          │
│  │  PostgreSQL   │                                          │
│  │  Database     │                                          │
│  └──────▲───────┘                                          │
│         │  Prisma ORM                                      │
│  ┌──────┴───────┐   HTTP    ┌──────────────────────────┐   │
│  │  RSS Worker  │ ─────────►│  外部 RSS フィード URL    │   │
│  │  (scheduler) │           └──────────────────────────┘   │
│  └──────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
```

**データフロー**

1. オペレーターが `POST /feeds` でフィード URL を登録
2. ワーカーが設定間隔（既定: 60 分）で起動
3. 有効な各フィードの RSS/Atom XML を取得・解析し、DB に既存の URL はスキップ
4. 新規記事をメタ情報（タイトル、URL、要約、公開日）付きで一括 upsert
5. API クライアントが `GET /feeds/:id/articles` または `GET /articles` で最新記事を取得

---

## API サーバーの責務

Express アプリケーション（`src/api/`）は以下を担当します。

| 項目 | 詳細 |
|---|---|
| **Feed CRUD** | フィード購読の作成・参照・更新・削除 |
| **記事一覧** | フィード/日付フィルタ付きのページネーション取得 |
| **ヘルスチェック** | `GET /health` が `200 OK` を返す |
| **入力検証** | リクエストボディ / クエリパラメータの検証 |
| **エラーハンドリング** | Prisma エラーや検証エラーを統一 JSON で返却 |

API サーバーは **RSS 取得を実行しません**。DB に対するデータアクセス層です。

---

## ワーカーの責務

ワーカー（`src/worker/`）は以下を担当します。

| 項目 | 詳細 |
|---|---|
| **スケジューラ** | `node-cron` または `setInterval` で定期実行 |
| **フィード取得対象の抽出** | `active = true` のフィードを DB から取得 |
| **RSS/Atom 解析** | `rss-parser` で XML を解析 |
| **重複排除** | URL ベースで既存記事をスキップ |
| **記事 upsert** | 新規記事を一括挿入し `lastFetchedAt` を更新 |
| **障害分離** | 1 フィード失敗でも他フィード処理は継続 |
| **ログ出力** | フィード URL / 追加件数 / スキップ件数 / エラーを構造化ログで記録 |

ワーカーは HTTP エンドポイントを公開せず、独立した常駐プロセスとして動作します。

---

## プロジェクト構成

```text
colligo/
├── src/
│   ├── api/
│   │   ├── app.ts            # Express アプリ起動
│   │   ├── routes/
│   │   │   ├── feeds.ts      # /feeds エンドポイント
│   │   │   └── articles.ts   # /articles エンドポイント
│   │   └── middleware/
│   │       └── errorHandler.ts
│   ├── lib/
│   │   ├── prisma.ts         # Prisma クライアント singleton
│   │   └── logger.ts         # 構造化ロガー
│   ├── worker/
│   │   ├── index.ts          # ワーカー起点 + スケジューラ
│   │   ├── fetchFeeds.ts     # 取得/解析/保存
│   │   └── rssParser.ts      # RSS/Atom 正規化ヘルパー
├── prisma/
│   ├── schema.prisma         # データモデル（Feed, Article）
│   └── migrations/           # Prisma マイグレーション履歴
├── Dockerfile                # Node.js 22 マルチステージイメージ
├── .dockerignore
├── compose.yml               # api / worker / db のオーケストレーション
├── .env.example              # 必須環境変数テンプレート
├── tsconfig.json
├── package.json
└── README.md
```

---

## 環境変数

ローカル実行または Docker Compose 実行前に `.env.example` を `.env` にコピーしてください。

```bash
cp .env.example .env
```

| 変数 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL 接続文字列（例: `postgresql://user:pass@localhost:5432/colligo`） |
| `PORT` |  | `3000` | Express API の待受ポート |
| `FETCH_INTERVAL_MS` |  | `3600000` | ワーカー実行間隔（ミリ秒） |
| `WORKER_CONCURRENCY` |  | `5` | ワーカー並列処理数 |
| `NODE_ENV` |  | `development` | 本番では `production` |

### `.env` の例

```dotenv
DATABASE_URL=postgresql://colligo:colligo@localhost:5432/colligo
PORT=3000
FETCH_INTERVAL_MS=3600000
WORKER_CONCURRENCY=5
NODE_ENV=development
```

---

## ローカル開発セットアップ

### 前提

- Node.js 22 以上
- npm（または pnpm / yarn）
- Docker Desktop（PostgreSQL をコンテナで使う場合）

### 手順

```bash
# 1. リポジトリを取得して移動
git clone <repo-url> colligo
cd colligo

# 2. 依存関係をインストール
npm ci

# 3. ローカル PostgreSQL を起動
docker compose up -d db

# 4. 環境変数を設定
cp .env.example .env
# 必要に応じて .env の DATABASE_URL を調整

# 5. マイグレーション適用
npm run db:migrate

# 6. API サーバー起動（ホットリロード）
npm run dev

# 7. ワーカー起動（別ターミナル）
npm run dev:worker
```

API は `http://localhost:3000` で利用できます。

---

## Docker Compose の使い方

`compose.yml` では `api` / `worker` / `db` の 3 サービスを定義しています。`api` と `worker` は同じ `Dockerfile` からビルドされます。

### すべて起動

```bash
docker compose up -d --build
```

### ログ確認

```bash
# 全サービス
docker compose logs -f

# API のみ
docker compose logs -f api

# Worker のみ
docker compose logs -f worker
```

### すべて停止

```bash
docker compose down
```

### ボリュームも含めて削除

```bash
docker compose down -v
```

### Docker 上でマイグレーション実行

```bash
docker compose run --rm api npm run db:migrate:deploy
```

### サービス一覧

| サービス | ポート | 説明 |
|---|---|---|
| `api` | `3000` | Express REST API |
| `worker` | — | バックグラウンド RSS 取得ワーカー（ポート公開なし） |
| `db` | `5432` | PostgreSQL 16 |

---

## Swagger / OpenAPI

API サーバー起動後、以下で仕様を確認できます。

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

Docker Compose 利用時も同じ URL です（`api` サービスの `3000` 公開ポート）。

---

## API リファレンス

レスポンスはすべて `application/json` です。エラー形式は `{ "error": "message" }` を想定しています。

### Health

```text
GET /health
→ 200 { "status": "ok" }
```

### Feeds

| Method | Path | 説明 |
|---|---|---|
| `GET` | `/feeds` | 登録済みフィード一覧 |
| `POST` | `/feeds` | 新規フィード登録 |
| `GET` | `/feeds/:id` | 指定 ID のフィード取得 |
| `PATCH` | `/feeds/:id` | フィード属性更新（`active`, `name` など） |
| `DELETE` | `/feeds/:id` | フィードと関連記事を削除 |

**フィード登録リクエスト例**

```json
{
  "name": "Tech Crunch",
  "url": "https://techcrunch.com/feed/",
  "active": true
}
```

### Articles

| Method | Path | 説明 |
|---|---|---|
| `GET` | `/articles` | 記事一覧（ページネーション） |
| `GET` | `/feeds/:id/articles` | 指定フィードの記事一覧 |
| `GET` | `/articles/:id` | 指定 ID の記事取得 |

**一覧取得クエリパラメータ**

| パラメータ | 型 | 説明 |
|---|---|---|
| `page` | integer | ページ番号（既定: `1`） |
| `limit` | integer | 1 ページ件数（既定: `20`, 最大: `100`） |
| `since` | ISO 8601 | 指定時刻以降に公開された記事のみ |

---

## 開発コマンド

| コマンド | 説明 |
|---|---|
| `npm run dev` | API を watch モードで起動（tsx watch） |
| `npm run dev:worker` | Worker を watch モードで起動 |
| `npm run build` | TypeScript を `dist/` にビルド |
| `npm run start:api` | ビルド済み API を起動 |
| `npm run start:worker` | ビルド済み Worker を起動 |
| `npm run db:migrate` | 保留中の Prisma マイグレーションを適用 |
| `npm run db:migrate:deploy` | 非対話環境向けにマイグレーション適用 |
| `npm run db:generate` | スキーマ変更後に Prisma Client 再生成 |
| `npm run db:studio` | Prisma Studio を起動（ブラウザ UI） |
| `npm run db:reset` | DB を再作成（開発専用） |

---

## ライセンス

MIT
