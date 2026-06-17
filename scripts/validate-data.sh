#!/bin/bash
# ============================================================================
# colligo Data Validation Script
# ============================================================================
#
# 移行後のデータ整合性を検証します。
# 旧環境と新環境のデータを比較し、完全性を確認します。
#
# 使用方法:
#   ./scripts/validate-data.sh [--compare-with FILE]
#
# オプション:
#   --compare-with FILE    旧環境のエクスポート統計ファイルと比較
#   --detailed             詳細な行レベルの検証
#   --help                 このメッセージを表示
#
# ============================================================================

set -euo pipefail

# ============================================================================
# 設定
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# デフォルト値
COMPARE_FILE=""
DETAILED=false

# ============================================================================
# ユーティリティ関数
# ============================================================================

usage() {
  cat << 'EOF'
usage: ./scripts/validate-data.sh [OPTIONS]

移行後のデータ整合性を検証します。

OPTIONS:
  -c, --compare-with FILE    旧環境のエクスポート統計ファイルと比較
  -d, --detailed             詳細な行レベルの検証（遅い）
  -h, --help                 このメッセージを表示

例:
  # 基本検証
  ./scripts/validate-data.sh

  # 旧環境の統計情報と比較
  ./scripts/validate-data.sh --compare-with old_stats.json

  # 詳細検証（すべての行をチェック）
  ./scripts/validate-data.sh --detailed
EOF
  exit "$1"
}

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

log_error() {
  echo "[✗ ERROR] $1" >&2
}

log_success() {
  echo "[✓ OK] $1"
}

log_warning() {
  echo "[! WARNING] $1"
}

log_info() {
  echo "[i INFO] $1"
}

# ============================================================================
# 引数パース
# ============================================================================

while [[ $# -gt 0 ]]; do
  case "$1" in
    -c | --compare-with)
      COMPARE_FILE="$2"
      shift 2
      ;;
    -d | --detailed)
      DETAILED=true
      shift
      ;;
    -h | --help)
      usage 0
      ;;
    *)
      log_error "不正なオプション: $1"
      usage 1
      ;;
  esac
done

# ============================================================================
# .env の読み込み
# ============================================================================

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
else
  log_warning "$PROJECT_ROOT/.env が見つかりません。デフォルト値を使用します"
fi

POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-password}
POSTGRES_DB=${POSTGRES_DB:-colligo}

# ============================================================================
# 事前チェック
# ============================================================================

log "準備中..."

# Docker Compose が実行中か確認
if ! docker compose ps --services > /dev/null 2>&1; then
  log_error "Docker Compose が実行されていません"
  exit 1
fi

# DB コンテナが起動しているか確認
DB_CONTAINER=$(docker compose ps -q db)
if [[ -z "$DB_CONTAINER" ]]; then
  log_error "DB コンテナが起動していません"
  exit 1
fi

# 接続テスト
if ! docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -c "SELECT version();" > /dev/null 2>&1; then
  log_error "DB に接続できません"
  exit 1
fi

log_success "DB に接続できました"

# ============================================================================
# テーブル構造の検証
# ============================================================================

log ""
log "=== テーブル構造の検証 ==="

# Feeds テーブルの確認
log "Feeds テーブル:"
docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -c "\\d feeds" || {
  log_error "Feeds テーブルが見つかりません"
  exit 1
}

# Articles テーブルの確認
log ""
log "Articles テーブル:"
docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -c "\\d articles" || {
  log_error "Articles テーブルが見つかりません"
  exit 1
}

log_success "テーブル構造: OK"

# ============================================================================
# データ件数の検証
# ============================================================================

log ""
log "=== データ件数の検証 ==="

FEED_COUNT=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM feeds;" | tr -d ' ')

ARTICLE_COUNT=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM articles;" | tr -d ' ')

log "Feeds: $FEED_COUNT"
log "Articles: $ARTICLE_COUNT"

# 0 件でないことを確認
if [[ $FEED_COUNT -eq 0 ]]; then
  log_warning "Feeds が 0 件です"
fi

if [[ $ARTICLE_COUNT -eq 0 ]]; then
  log_warning "Articles が 0 件です（初回実行の場合は正常）"
fi

# ============================================================================
# 制約の検証
# ============================================================================

log ""
log "=== 制約の検証 ==="

# ユニーク制約: articles.url
log "記事 URL ユニーク制約:"
DUPLICATE_URLS=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM (SELECT url, COUNT(*) as cnt FROM articles GROUP BY url HAVING COUNT(*) > 1) x;" | tr -d ' ')

if [[ $DUPLICATE_URLS -eq 0 ]]; then
  log_success "  重複なし"
else
  log_error "  重複 URL 件数: $DUPLICATE_URLS"
fi

# ユニーク制約: feeds.url
log "フィード URL ユニーク制約:"
DUPLICATE_FEED_URLS=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM (SELECT url, COUNT(*) as cnt FROM feeds GROUP BY url HAVING COUNT(*) > 1) x;" | tr -d ' ')

if [[ $DUPLICATE_FEED_URLS -eq 0 ]]; then
  log_success "  重複なし"
else
  log_error "  重複フィード URL 件数: $DUPLICATE_FEED_URLS"
fi

# 複合ユニーク制約: articles(feed_id, guid)
log "記事複合ユニーク制約 (feed_id, guid):"
DUPLICATE_GUIDS=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM (SELECT feed_id, guid, COUNT(*) as cnt FROM articles WHERE guid IS NOT NULL GROUP BY feed_id, guid HAVING COUNT(*) > 1) x;" | tr -d ' ')

if [[ $DUPLICATE_GUIDS -eq 0 ]]; then
  log_success "  重複なし"
else
  log_error "  重複 GUID 件数: $DUPLICATE_GUIDS"
fi

# ============================================================================
# 参照整合性の検証
# ============================================================================

log ""
log "=== 参照整合性の検証 ==="

# 外部キー制約: articles.feed_id -> feeds.id
log "記事-フィード参照整合性:"
ORPHANED_ARTICLES=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM articles WHERE feed_id NOT IN (SELECT id FROM feeds);" | tr -d ' ')

if [[ $ORPHANED_ARTICLES -eq 0 ]]; then
  log_success "  孤立レコードなし"
else
  log_error "  孤立記事レコード: $ORPHANED_ARTICLES"
fi

# ============================================================================
# データ品質の検証
# ============================================================================

log ""
log "=== データ品質の検証 ==="

# NULL チェック
log "NULL 値チェック (Feeds):"
NULL_FEEDS=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM feeds WHERE url IS NULL OR name IS NULL;" | tr -d ' ')

if [[ $NULL_FEEDS -eq 0 ]]; then
  log_success "  問題なし"
else
  log_warning "  必須フィールドが NULL: $NULL_FEEDS"
fi

log "NULL 値チェック (Articles):"
NULL_ARTICLES=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM articles WHERE title IS NULL OR url IS NULL OR feed_id IS NULL;" | tr -d ' ')

if [[ $NULL_ARTICLES -eq 0 ]]; then
  log_success "  問題なし"
else
  log_warning "  必須フィールドが NULL: $NULL_ARTICLES"
fi

# タイムスタンプの妥当性
log "タイムスタンプ検証:"
FUTURE_DATES=$(docker exec "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -t -c "SELECT COUNT(*) FROM articles WHERE published_at > NOW();" | tr -d ' ')

if [[ $FUTURE_DATES -eq 0 ]]; then
  log_success "  問題なし"
else
  log_warning "  未来の日付: $FUTURE_DATES"
fi

# ============================================================================
# 旧環境との比較（オプション）
# ============================================================================

if [[ -n "$COMPARE_FILE" ]] && [[ -f "$COMPARE_FILE" ]]; then
  log ""
  log "=== 旧環境との比較 ==="

  if command -v jq &> /dev/null; then
    OLD_FEED_COUNT=$(jq -r '.feed_count' "$COMPARE_FILE" 2>/dev/null || echo "unknown")
    OLD_ARTICLE_COUNT=$(jq -r '.article_count' "$COMPARE_FILE" 2>/dev/null || echo "unknown")

    log "旧環境:"
    log "  Feeds: $OLD_FEED_COUNT"
    log "  Articles: $OLD_ARTICLE_COUNT"

    log "新環境:"
    log "  Feeds: $FEED_COUNT"
    log "  Articles: $ARTICLE_COUNT"

    if [[ "$OLD_FEED_COUNT" == "$FEED_COUNT" ]] && [[ "$OLD_ARTICLE_COUNT" == "$ARTICLE_COUNT" ]]; then
      log_success "データ件数が一致"
    else
      log_warning "データ件数が異なります"
    fi
  else
    log_warning "jq がインストールされていません。JSON 比較をスキップします"
  fi
fi

# ============================================================================
# 詳細検証（オプション）
# ============================================================================

if [[ "$DETAILED" == "true" ]]; then
  log ""
  log "=== 詳細検証 ==="

  log "Feeds 詳細:"
  docker exec "$DB_CONTAINER" \
    psql -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -c "SELECT id, name, active, last_fetched_at, created_at FROM feeds ORDER BY id LIMIT 10;"

  log ""
  log "Articles 詳細（最新 10 件）:"
  docker exec "$DB_CONTAINER" \
    psql -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -c "SELECT id, title, url, feed_id, published_at, created_at FROM articles ORDER BY created_at DESC LIMIT 10;"
fi

# ============================================================================
# サマリーと推奨事項
# ============================================================================

log ""
log "=== 検証完了 ==="

if [[ $ORPHANED_ARTICLES -eq 0 ]] && [[ $DUPLICATE_URLS -eq 0 ]] && [[ $DUPLICATE_FEED_URLS -eq 0 ]]; then
  log_success "すべての検証に合格しました"
  log ""
  log "次のステップ:"
  log "  1. API を起動: docker compose up -d api"
  log "  2. ヘルスチェック: curl http://localhost:3000/health"
  log "  3. Worker を起動: docker compose up -d worker"
else
  log_warning "いくつかの問題が検出されました"
  log "詳細は上記の出力を確認してください"
fi

log ""
