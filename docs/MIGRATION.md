# colligo データ移行ガイド

本ドキュメントは、colligo のサーバーを別の環境に引っ越しする際のデータ移行手順です。  
Feeds（RSS フィード登録）と Articles（取得記事）の両方を含むデータベース全体を移行します。

---

## 前提条件

- 旧環境と新環境の両方に Docker Compose がセットアップされている
- `scripts/export-data.sh` と `scripts/import-data.sh` が実行可能な状態
- `.env` ファイルが両環境で適切に設定されている
- PostgreSQL クライアント（`psql`）または `pg_dump`/`pg_restore` が利用可能

---

## 移行の流れ

```
旧環境 (現在のサーバー)
  │
  ├─ ① 旧 API・Worker を停止
  │
  ├─ ② DB をエクスポート（ダンプ）
  │   └─ SQL または カスタムフォーマット
  │
  ├─ ③ ダンプファイルを新環境に転送
  │
新環境 (新しいサーバー)
  │
  ├─ ④ 新 DB コンテナを起動
  │
  ├─ ⑤ スキーマを初期化（Prisma マイグレーション実行）
  │
  ├─ ⑥ データをインポート（旧ダンプを復元）
  │
  ├─ ⑦ データ整合性を検証
  │
  └─ ⑧ 新 API・Worker を起動
```

---

## ステップバイステップ

### ① 旧環境のサービスを停止

```bash
# 旧環境で実行
cd /path/to/colligo

# API・Worker・DB を停止
docker compose down

# ボリュームは保持（データはまだ必要）
# 削除しない
```

**注意**: `docker compose down -v` を実行してはいけません。ボリュームが削除されます。

---

### ② データをエクスポート

#### 方法 A: SQL 形式（推奨・可視化が容易）

```bash
# DB コンテナを再起動（バックアップ取得用）
docker compose up -d db

# ダンプを取得
docker exec -i colligo-db-1 pg_dump \
  -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  --no-owner \
  --no-privileges \
  > backup.sql

# 確認（ファイルサイズと内容をチェック）
ls -lh backup.sql
head -50 backup.sql
```

#### 方法 B: カスタムフォーマット（圧縮・復元が高速）

```bash
docker compose up -d db

docker exec -i colligo-db-1 pg_dump \
  -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  -Fc \
  --no-owner \
  --no-privileges \
  > backup.dump

# 確認
ls -lh backup.dump
file backup.dump
```

**どちらを選ぶ？**
- **SQL 形式**: 内容の確認・部分的な編集が必要な場合
- **カスタムフォーマット**: ファイルサイズが大きい場合（圧縮率約 2-5 倍）

---

### ③ ダンプファイルを新環境に転送

```bash
# ローカルマシンから新サーバーへ SCP 転送
scp backup.sql user@new-server:/path/to/colligo/

# または新サーバーで直接取得（SSH トンネル経由）
# 旧環境の DB が外部公開されている場合
pg_dump -h old-server.example.com \
  -U ${POSTGRES_USER} \
  -d ${POSTGRES_DB} \
  > backup.sql
```

---

### ④ 新環境で DB コンテナを起動

```bash
# 新環境で実行
cd /path/to/colligo

# .env ファイルを確認・設定
cat .env
# 必要に応じて POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, DATABASE_URL を更新

# DB のみ起動
docker compose up -d db

# ヘルスチェック
docker compose ps
# STATUS が "healthy" になるまで待機（約 10-20 秒）
```

---

### ⑤ Prisma マイグレーション実行

新規スキーマを作成してから、旧データを投入します。

```bash
# スキーマを初期化
docker exec -it colligo-api-1 \
  node node_modules/prisma/build/index.js migrate deploy

# テーブルが作成されたか確認
docker exec colligo-db-1 \
  psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-colligo} \
  -c "\dt"
```

期待される出力：
```
         List of relations
 Schema | Name     | Type  | Owner
--------+----------+-------+----------
 public | articles | table | postgres
 public | feeds    | table | postgres
(2 rows)
```

---

### ⑥ データをインポート

#### SQL 形式の場合

```bash
# ダンプを復元
docker exec -i colligo-db-1 psql \
  -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  < backup.sql

# 確認（復元の進捗）
# 数秒～数十秒で完了
```

#### カスタムフォーマットの場合

```bash
# コンテナ内にコピー
docker cp backup.dump colligo-db-1:/tmp/backup.dump

# 復元
docker exec colligo-db-1 pg_restore \
  -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  -Fc /tmp/backup.dump

# クリーンアップ
docker exec colligo-db-1 rm /tmp/backup.dump
```

**復元後の確認**:
```bash
docker exec colligo-db-1 \
  psql -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  -c "SELECT COUNT(*) as feed_count FROM feeds;"

docker exec colligo-db-1 \
  psql -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  -c "SELECT COUNT(*) as article_count FROM articles;"
```

---

### ⑦ データ整合性を検証

#### テスト 1: 行数の確認

```bash
# 旧環境で事前に記録
docker exec colligo-db-1 \
  psql -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  -c "SELECT COUNT(*) FROM feeds; SELECT COUNT(*) FROM articles;"

# 新環境でも同じ結果になるか確認
```

#### テスト 2: キー制約の確認

```bash
# 外部キー制約が機能しているか
docker exec colligo-db-1 \
  psql -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  -c "SELECT * FROM information_schema.table_constraints WHERE table_name IN ('feeds', 'articles');"
```

#### テスト 3: ユニーク制約の確認

```bash
# URL ユニーク制約が保持されているか
docker exec colligo-db-1 \
  psql -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  -c "SELECT url, COUNT(*) FROM articles GROUP BY url HAVING COUNT(*) > 1;"

# 結果なし（0 行）が正常
```

#### テスト 4: API レベルでの検証

別ウィンドウで API を起動して、実際のエンドポイントで確認することもできます：

```bash
# API を起動
docker compose up -d api

# ヘルスチェック
curl http://localhost:3000/health

# Feeds を取得
curl http://localhost:3000/feeds | jq .

# Articles を取得
curl http://localhost:3000/articles?limit=5 | jq .
```

---

### ⑧ 新環境で API・Worker を起動

```bash
# すべてのサービスを起動
docker compose up -d

# ログを確認
docker compose logs -f api worker

# すべてのサービスが healthy になるまで待機
docker compose ps
```

---

## トラブルシューティング

### Q: `ERROR: duplicate key value violates unique constraint "articles_url_key"`

**原因**: インポート時にユニーク制約が存在するため、二重投入に失敗している可能性があります。

**解決策**:
```bash
# 一度データをクリアして再投入
docker exec colligo-db-1 \
  psql -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  -c "TRUNCATE articles CASCADE; TRUNCATE feeds CASCADE;"

# 再度インポート実行
docker exec -i colligo-db-1 psql \
  -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  < backup.sql
```

### Q: マイグレーション後、テーブルが空の場合はどうする？

**原因**: インポート順序が正しくない、または foreign key 制約によるエラー

**解決策**:
```bash
# 詳細なエラーを確認
docker exec colligo-db-1 \
  psql -U ${POSTGRES_USER:-postgres} \
  -d ${POSTGRES_DB:-colligo} \
  < backup.sql 2>&1 | tail -20

# 外部キー制約を一時的に無効化（高リスク）
# SQL ファイルの先頭に以下を追加
# SET session_replication_role = 'replica';
# 最後に以下を追加
# SET session_replication_role = 'origin';
```

### Q: コンテナ内での `psql` コマンド実行に失敗する

**確認事項**:
```bash
# DB コンテナが起動しているか
docker compose ps db

# ネットワーク接続が可能か
docker exec colligo-api-1 nc -zv db 5432

# PASSWORD が正しいか（.env を確認）
cat .env | grep POSTGRES
```

---

## ロールバック手順

移行に失敗した場合、旧環境に戻すことができます。

```bash
# 新環境のデータをリセット
docker compose down -v

# 旧環境を復旧（停止したままの場合）
cd /path/to/old-colligo
docker compose up -d

# ボリュームが残っていることを確認
docker volume ls | grep colligo
```

---

## 移行後の確認事項

- [ ] ダッシュボード / 管理画面で Feeds が表示される
- [ ] 記事が正常に表示される
- [ ] API が HTTP 200 を返す（`/health`）
- [ ] Worker が定期的に実行されている（ログ確認）
- [ ] 新規 RSS フィードを追加できる
- [ ] 旧環境を完全に削除（必要に応じて）

---

## トラブル時の連絡先

データベースやマイグレーションに関する問題は、以下を記録して報告してください：

1. エラーメッセージの全文
2. 実行したコマンド
3. Docker Compose の version
4. PostgreSQL のバージョン（`psql --version`）
5. データサイズ（行数、ファイルサイズ）

---

## 参考資料

- [PostgreSQL Backup and Restore](https://www.postgresql.org/docs/current/backup.html)
- [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
