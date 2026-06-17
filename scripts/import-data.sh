#!/bin/bash
# ============================================================================
# colligo Data Import Script
# ============================================================================
#
# 新環境に PostgreSQL データベースをインポート（復元）します。
#
# 使用方法:
#   ./scripts/import-data.sh --input FILE [--skip-schema]
#
# オプション:
#   --input FILE        インポートするダンプファイル (必須)
#   --skip-schema       スキーマ初期化をスキップ（既に初期化済みの場合）
#   --truncate          インポート前にテーブルをクリア
#   --help              このメッセージを表示
#
# ============================================================================

set -euo pipefail

# ============================================================================
# 設定
# ============================================================================

SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"
PROJECT_ROOT=\"$(dirname \"$SCRIPT_DIR\")\"

# デフォルト値
INPUT_FILE=\"\"
SKIP_SCHEMA=false
TRUNCATE=false
VERBOSE=false

# ============================================================================
# ユーティリティ関数
# ============================================================================

usage() {
  cat << 'EOF'
usage: ./scripts/import-data.sh [OPTIONS]

新環境に PostgreSQL データベースをインポート（復元）します。

OPTIONS:
  -i, --input FILE       インポートするダンプファイル (必須)
  -s, --skip-schema      スキーマ初期化をスキップ（既に初期化済みの場合）
  -t, --truncate         インポート前にテーブルをクリア
  -v, --verbose          詳細ログを出力
  -h, --help             このメッセージを表示

例:
  # スキーマ初期化から完全復元
  ./scripts/import-data.sh --input backup.sql

  # スキーマ初期化をスキップ（テーブルが既に存在する場合）
  ./scripts/import-data.sh --input backup.sql --skip-schema

  # テーブルをクリアしてから復元
  ./scripts/import-data.sh --input backup.sql --truncate

  # カスタム形式のダンプを復元
  ./scripts/import-data.sh --input backup.dump
EOF
  exit \"$1\"
}

log() {
  echo \"[$(date +'%Y-%m-%d %H:%M:%S')] $1\"
}

log_error() {
  echo \"[ERROR] $1\" >&2
}

log_success() {
  echo \"[✓] $1\"
}

log_warning() {
  echo \"[WARNING] $1\"
}

# ============================================================================
# 引数パース
# ============================================================================

while [[ $# -gt 0 ]]; do
  case \"\$1\" in
    -i | --input)
      INPUT_FILE=\"\$2\"
      shift 2
      ;;
    -s | --skip-schema)
      SKIP_SCHEMA=true
      shift
      ;;
    -t | --truncate)
      TRUNCATE=true
      shift
      ;;
    -v | --verbose)
      VERBOSE=true
      shift
      ;;
    -h | --help)
      usage 0
      ;;
    *)
      log_error \"不正なオプション: \$1\"
      usage 1
      ;;
  esac
done

# ============================================================================
# バリデーション
# ============================================================================

if [[ -z \"\$INPUT_FILE\" ]]; then
  log_error \"--input オプションは必須です\"
  usage 1
fi

if [[ ! -f \"\$INPUT_FILE\" ]]; then
  log_error \"ダンプファイルが見つかりません: \$INPUT_FILE\"
  exit 1
fi

# ファイルサイズをチェック
FILE_SIZE=\$(stat -f%z \"\$INPUT_FILE\" 2>/dev/null || stat -c%s \"\$INPUT_FILE\" 2>/dev/null)
if [[ \$FILE_SIZE -lt 1024 ]]; then
  log_warning \"ダンプファイルが非常に小さいです: \$FILE_SIZE バイト\"
  read -p \"続行しますか? (y/N): \" -r
  if [[ ! \$REPLY =~ ^[Yy]\$ ]]; then
    log \"キャンセルしました\"
    exit 0
  fi
fi

# ============================================================================
# .env の読み込み
# ============================================================================

if [[ -f \"$PROJECT_ROOT/.env\" ]]; then
  export \$(grep -v '^#' \"$PROJECT_ROOT/.env\" | xargs)
else
  log_warning \"$PROJECT_ROOT/.env が見つかりません。デフォルト値を使用します\"
fi

POSTGRES_USER=\${POSTGRES_USER:-postgres}
POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:-password}
POSTGRES_DB=\${POSTGRES_DB:-colligo}
POSTGRES_PORT=\${POSTGRES_PORT:-5432}
POSTGRES_HOST=\${POSTGRES_HOST:-db}

# ============================================================================
# 事前チェック
# ============================================================================

log \"準備中...\"

# Docker Compose が実行中か確認
if ! docker compose ps --services > /dev/null 2>&1; then
  log_error \"Docker Compose が実行されていません\"
  log \"以下を実行してください:\"
  log \"  cd $PROJECT_ROOT\"
  log \"  docker compose up -d db\"
  exit 1
fi

# DB コンテナが起動しているか確認
DB_CONTAINER=\$(docker compose ps -q db)
if [[ -z \"\$DB_CONTAINER\" ]]; then
  log_error \"DB コンテナが起動していません\"
  exit 1
fi

log \"DB コンテナ ID: \$DB_CONTAINER\"

# 接続テスト
log \"DB 接続テスト中...\"
if ! docker exec \"\$DB_CONTAINER\" \
  psql -U \"\$POSTGRES_USER\" \
  -d \"\$POSTGRES_DB\" \
  -c \"SELECT version();\" > /dev/null 2>&1; then
  log_error \"DB に接続できません\"
  log \"以下を確認してください:\"
  log \"  - POSTGRES_USER: \$POSTGRES_USER\"
  log \"  - POSTGRES_DB: \$POSTGRES_DB\"
  exit 1
fi

log_success \"DB に接続できました\"

# ============================================================================
# スキーマ初期化
# ============================================================================

if [[ \"\$SKIP_SCHEMA\" == \"false\" ]]; then
  log \"\\n=== スキーマ初期化 ===\"
  log \"Prisma マイグレーション実行中...\"

  # API コンテナが起動していることを確認（or 起動）
  if ! docker compose ps -q api > /dev/null 2>&1; then
    log \"API コンテナが起動していません。起動中...\"
    docker compose up -d api
    log \"API コンテナ起動待機中（10秒）...\"
    sleep 10
  fi

  API_CONTAINER=\$(docker compose ps -q api)
  if [[ -z \"\$API_CONTAINER\" ]]; then
    log_error \"API コンテナが起動できません\"
    exit 1
  fi

  # マイグレーション実行
  if ! docker exec \"\$API_CONTAINER\" \
    node node_modules/prisma/build/index.js migrate deploy; then
    log_error \"Prisma マイグレーションに失敗しました\"
    exit 1
  fi

  log_success \"スキーマ初期化完了\"
else
  log \"スキーマ初期化をスキップしました\"
fi

# ============================================================================
# テーブルをクリア（オプション）
# ============================================================================

if [[ \"\$TRUNCATE\" == \"true\" ]]; then
  log \"\\n=== テーブルをクリア ===\"
  log \"既存データを削除中...\"

  docker exec \"\$DB_CONTAINER\" \
    psql -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    -c \"TRUNCATE articles CASCADE; TRUNCATE feeds CASCADE;\" || {
    log_error \"テーブルクリアに失敗しました\"
    exit 1
  }

  log_success \"テーブルをクリアしました\"
fi

# ============================================================================
# インポート実行
# ============================================================================

log \"\\n=== インポート開始 ===\"
log \"入力: \$INPUT_FILE\"
log \"DB: \$POSTGRES_DB\"
log \"\"

START_TIME=\$(date +%s)

# ダンプファイルの形式を判定
if file \"\$INPUT_FILE\" | grep -q \"PostgreSQL custom database dump\"; then
  # カスタム形式
  log \"ダンプ形式: PostgreSQL カスタム形式（圧縮）\"

  docker cp \"\$INPUT_FILE\" \"\$DB_CONTAINER\":/tmp/backup.dump || {
    log_error \"ファイルのコピーに失敗しました\"
    exit 1
  }

  docker exec \"\$DB_CONTAINER\" \
    pg_restore \
    -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    -Fc \
    --no-owner \
    --no-privileges \
    --verbose \
    /tmp/backup.dump || {
    log_error \"pg_restore に失敗しました\"
    docker exec \"\$DB_CONTAINER\" rm /tmp/backup.dump
    exit 1
  }

  docker exec \"\$DB_CONTAINER\" rm /tmp/backup.dump
else
  # SQL 形式（プレーンテキスト）
  log \"ダンプ形式: SQL テキスト\"

  docker exec \"\$DB_CONTAINER\" \
    psql -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    < \"\$INPUT_FILE\" || {
    log_error \"psql に失敗しました\"
    log \"\"
    log \"トラブルシューティング:\"
    log \"  1. 外部キー制約エラーの場合は、--truncate オプションを使用してください\"
    log \"  2. スキーマが既に存在する場合は、--skip-schema オプションを使用してください\"
    exit 1
  }
fi

END_TIME=\$(date +%s)
ELAPSED=\$((END_TIME - START_TIME))

log_success \"インポート完了 (\${ELAPSED}秒)\"

# ============================================================================
# データ検証
# ============================================================================

log \"\\n=== データ検証 ===\"

# テーブルの確認
log \"テーブル一覧:\"
docker exec \"\$DB_CONTAINER\" \
  psql -U \"\$POSTGRES_USER\" \
  -d \"\$POSTGRES_DB\" \
  -c \"\\\\dt\" || true

# 行数の確認
log \"\"
log \"データ件数:\"

FEED_COUNT=\$(docker exec \"\$DB_CONTAINER\" \
  psql -U \"\$POSTGRES_USER\" \
  -d \"\$POSTGRES_DB\" \
  -t -c \"SELECT COUNT(*) FROM feeds;\")
log \"  Feeds: \$FEED_COUNT\"

ARTICLE_COUNT=\$(docker exec \"\$DB_CONTAINER\" \
  psql -U \"\$POSTGRES_USER\" \
  -d \"\$POSTGRES_DB\" \
  -t -c \"SELECT COUNT(*) FROM articles;\")
log \"  Articles: \$ARTICLE_COUNT\"

# 整合性チェック
log \"\"
log \"整合性チェック:\"

# ユニークキー制約の確認
DUPLICATE_URLS=\$(docker exec \"\$DB_CONTAINER\" \
  psql -U \"\$POSTGRES_USER\" \
  -d \"\$POSTGRES_DB\" \
  -t -c \"SELECT COUNT(*) FROM articles GROUP BY url HAVING COUNT(*) > 1;\" | wc -l)

if [[ \$DUPLICATE_URLS -eq 0 ]]; then
  log_success \"  URL ユニーク制約: OK\"
else
  log_warning \"  URL ユニーク制約: 重複あり (\$DUPLICATE_URLS)\"
fi

# 外部キー制約の確認
ORPHANED_ARTICLES=\$(docker exec \"\$DB_CONTAINER\" \
  psql -U \"\$POSTGRES_USER\" \
  -d \"\$POSTGRES_DB\" \
  -t -c \"SELECT COUNT(*) FROM articles WHERE feed_id NOT IN (SELECT id FROM feeds);\" | tr -d ' ')

if [[ \$ORPHANED_ARTICLES -eq 0 ]]; then
  log_success \"  外部キー制約: OK\"
else
  log_warning \"  外部キー制約: 孤立レコード (\$ORPHANED_ARTICLES)\"
fi

log_success \"検証完了\"

# ============================================================================
# 推奨される次のステップ
# ============================================================================

log \"\"
log \"=== 次のステップ ===\"
log \"\"
log \"1. API サーバーを起動する:\"
log \"   docker compose up -d api\"
log \"\"
log \"2. ヘルスチェック:\"
log \"   curl http://localhost:3000/health\"
log \"\"
log \"3. Feeds を確認:\"
log \"   curl http://localhost:3000/feeds | jq .\"
log \"\"
log \"4. Worker を起動する:\"
log \"   docker compose up -d worker\"
log \"\"
log \"5. ログを確認:\"
log \"   docker compose logs -f\"
log \"\"

log_success \"完了\"
