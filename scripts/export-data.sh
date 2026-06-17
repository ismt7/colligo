#!/bin/bash
# ============================================================================
# colligo Data Export Script
# ============================================================================
# 
# 旧環境から PostgreSQL データベースをエクスポート（バックアップ）します。
#
# 使用方法:
#   ./scripts/export-data.sh [--format sql|custom] [--output FILE]
#
# オプション:
#   --format FORMAT    出力形式: sql (デフォルト) または custom
#   --output FILE      出力ファイル名 (デフォルト: backup-TIMESTAMP.sql)
#   --help             このメッセージを表示
#
# ============================================================================

set -euo pipefail

# ============================================================================
# 設定
# ============================================================================

SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"
PROJECT_ROOT=\"$(dirname \"$SCRIPT_DIR\")\"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# デフォルト値
EXPORT_FORMAT=\"sql\"
OUTPUT_FILE=\"\"
VERBOSE=false

# ============================================================================
# ユーティリティ関数
# ============================================================================

usage() {
  cat << 'EOF'
usage: ./scripts/export-data.sh [OPTIONS]

出旧環境から PostgreSQL データベースをエクスポート（バックアップ）します。

OPTIONS:
  -f, --format FORMAT    出力形式 (sql | custom) [デフォルト: sql]
  -o, --output FILE      出力ファイル名 [デフォルト: backup-TIMESTAMP.FORMAT]
  -v, --verbose          詳細ログを出力
  -h, --help             このメッセージを表示

例:
  # SQL 形式でバックアップ
  ./scripts/export-data.sh --format sql

  # カスタム形式で圧縮バックアップ
  ./scripts/export-data.sh --format custom --output mybackup.dump

  # 特定の出力ファイル名を指定
  ./scripts/export-data.sh --output /tmp/backup.sql
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

# ============================================================================
# 引数パース
# ============================================================================

while [[ $# -gt 0 ]]; do
  case \"\$1\" in
    -f | --format)
      EXPORT_FORMAT=\"\$2\"
      shift 2
      ;;
    -o | --output)
      OUTPUT_FILE=\"\$2\"
      shift 2
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

if [[ ! \" sql custom \" =~ \" \$EXPORT_FORMAT \" ]]; then
  log_error \"形式は 'sql' または 'custom' である必要があります: \$EXPORT_FORMAT\"
  exit 1
fi

# 出力ファイル名を決定
if [[ -z \"\$OUTPUT_FILE\" ]]; then
  if [[ \"\$EXPORT_FORMAT\" == \"custom\" ]]; then
    OUTPUT_FILE=\"backup_\${TIMESTAMP}.dump\"
  else
    OUTPUT_FILE=\"backup_\${TIMESTAMP}.sql\"
  fi
fi

# ファイルが既存の場合は警告
if [[ -f \"\$OUTPUT_FILE\" ]]; then
  log_error \"出力ファイルが既に存在します: \$OUTPUT_FILE\"
  read -p \"上書きしますか? (y/N): \" -r
  if [[ ! \$REPLY =~ ^[Yy]\$ ]]; then
    log \"キャンセルしました\"
    exit 0
  fi
fi

# ============================================================================
# .env の読み込み
# ============================================================================

if [[ -f \"$PROJECT_ROOT/.env\" ]]; then
  # .env ファイルから環境変数を読み込む（簡易版）
  export \$(grep -v '^#' \"$PROJECT_ROOT/.env\" | xargs)
else
  log \"警告: $PROJECT_ROOT/.env が見つかりません。デフォルト値を使用します\"
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
  log_error \"Docker Compose が実行されていません。\"
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
# エクスポート実行
# ============================================================================

log \"\\n=== エクスポート開始 ===\"
log \"形式: \$EXPORT_FORMAT\"
log \"出力: \$OUTPUT_FILE\"
log \"DB: \$POSTGRES_DB\"
log \"\"

START_TIME=\$(date +%s)

if [[ \"\$EXPORT_FORMAT\" == \"custom\" ]]; then
  # カスタム形式（圧縮）
  log \"pg_dump (カスタム形式) を実行中...\"
  docker exec \"\$DB_CONTAINER\" \
    pg_dump \
    -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    -Fc \
    --no-owner \
    --no-privileges \
    --compress=9 \
    --verbose \
    > \"\$OUTPUT_FILE\" 2>&1 || {
    log_error \"pg_dump に失敗しました\"
    exit 1
  }
else
  # SQL 形式（プレーンテキスト）
  log \"pg_dump (SQL 形式) を実行中...\"
  docker exec \"\$DB_CONTAINER\" \
    pg_dump \
    -U \"\$POSTGRES_USER\" \
    -d \"\$POSTGRES_DB\" \
    --no-owner \
    --no-privileges \
    --verbose \
    > \"\$OUTPUT_FILE\" 2>&1 || {
    log_error \"pg_dump に失敗しました\"
    exit 1
  }
fi

END_TIME=\$(date +%s)
ELAPSED=\$((END_TIME - START_TIME))

# ============================================================================
# 結果確認
# ============================================================================

if [[ ! -f \"\$OUTPUT_FILE\" ]]; then
  log_error \"出力ファイルが作成されませんでした: \$OUTPUT_FILE\"
  exit 1
fi

FILE_SIZE=\$(du -h \"\$OUTPUT_FILE\" | cut -f1)

log_success \"\\nエクスポート完了\"
log \"\"
log \"ファイル情報:\"
log \"  ファイル: \$OUTPUT_FILE\"
log \"  サイズ: \$FILE_SIZE\"
log \"  実行時間: \${ELAPSED}秒\"

# ============================================================================
# データの検証
# ============================================================================

log \"\"
log \"データ検証中...\"

# SQL ファイルの場合は先頭を表示
if [[ \"\$EXPORT_FORMAT\" == \"sql\" ]]; then
  TOTAL_LINES=\$(wc -l < \"\$OUTPUT_FILE\")
  log \"  SQL 行数: \$TOTAL_LINES\"

  # CREATE TABLE ステートメントをカウント
  CREATE_TABLES=\$(grep -c \"^CREATE TABLE\" \"\$OUTPUT_FILE\" || true)
  log \"  テーブル定義: \$CREATE_TABLES\"

  # INSERT ステートメントをカウント
  INSERT_STMTS=\$(grep -c \"^INSERT INTO\" \"\$OUTPUT_FILE\" || true)
  log \"  INSERT ステートメント: \$INSERT_STMTS\"

  # COPY ステートメント（バイナリ用）
  COPY_STMTS=\$(grep -c \"^COPY\" \"\$OUTPUT_FILE\" || true)
  if [[ \$COPY_STMTS -gt 0 ]]; then
    log \"  COPY ステートメント: \$COPY_STMTS\"
  fi
fi

log_success \"検証完了\"

# ============================================================================
# 推奨される次のステップ
# ============================================================================

log \"\"
log \"=== 次のステップ ===\"
log \"\"
log \"1. ダンプファイルを新環境に転送する:\"
log \"   scp \$OUTPUT_FILE user@new-server:/path/to/colligo/\"
log \"\"
log \"2. 新環境でインポートを実行する:\"
log \"   ./scripts/import-data.sh --input \$OUTPUT_FILE\"
log \"\"
log \"3. または、docs/MIGRATION.md を参照して手動実行:\"
log \"   cat docs/MIGRATION.md\"
log \"\"

log_success \"完了\"
