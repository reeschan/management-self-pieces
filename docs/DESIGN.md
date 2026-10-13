# 設計メモ (MVP)

自分の成果物 (アプリ・スキル・文書など) を「Node」という統一の構成物として扱い、3D 空間に浮かぶグラフで眺め、Asana のプロジェクトでチケット管理するための個人用 Web アプリ。

## 方針

- **データの正**: Node の内容は各リポジトリのルートに置く `node.yaml`。チケットは Asana。アプリの DB は表示用の一時保存で、消えても GitHub と Asana から作り直せる
- **ホスティング**: Vercel (Hobby)。DB は Neon (Postgres)。費用 0 円の範囲
- **認証**: Better Auth。Google と GitHub でログインし、`ALLOWED_EMAILS` に含まれるメールアドレス以外は拒否する。両方のログインは accountLinking で同じユーザーになる
- **GitHub 連携**: GitHub App 1 つで、ログイン (ユーザー認可)・Webhook (push)・取り込み (Installation Token) を担う
- **Asana 連携**: PAT。Node と Asana プロジェクトは 1 対 1。プロジェクトの説明 (notes) に `piece-node-id: <node id>` を書き、DB が消えても対応を作り直せるようにする。更新は Asana Webhook で受け取る
- **仕様の正**: `node.yaml` の Zod スキーマ (`src/lib/manifest/schema.ts`)。`z.toJSONSchema()` で `/schema/node.json` として公開し、各リポジトリのエディタ補完に使う
- **MCP の口**: 画面と同じデプロイで `/api/mcp` を出す。認証は [ADR 0001](adr/0001-mcp-auth-token-and-ip-allowlist.md)

## 技術構成

Next.js (App Router, TypeScript, `src/` 配下) / pnpm / Tailwind CSS v4 / Drizzle ORM + `@neondatabase/serverless` / Zod v4 / Better Auth / octokit / react-force-graph-3d / react-markdown / mermaid / Vitest

## ディレクトリ

```
src/
  app/
    (app)/            ログイン必須の画面 (layout でセッション確認)
      page.tsx        3D ダッシュボード
      settings/       エージェント用トークン・IP 許可リスト・監査ログ
    login/page.tsx
    api/auth/[...all]/route.ts
    api/mcp/route.ts               MCP の HTTP エンドポイント
    api/webhooks/github/route.ts
    api/webhooks/asana/route.ts
    api/cron/import/route.ts
    api/nodes/[id]/route.ts         Node の詳細 (detail の Markdown、図の一覧、チケット)
    api/nodes/[id]/asset/route.ts   リポジトリ内のファイル (SVG など) を返す
    schema/node.json/route.ts       node.yaml の JSON Schema
  components/          画面部品 (graph/, panel/)
    settings/          トークンと IP 許可リストの操作
  db/
    schema.ts          アプリのテーブル
    auth-schema.ts     Better Auth のテーブル
    client.ts          Drizzle クライアント (遅延生成)
  lib/
    env.ts             環境変数の検証 (遅延評価。build 時に環境変数が無くても落ちない)
    manifest/          node.yaml の Zod スキーマ・kind 登録・YAML の解析
    auth/              Better Auth の設定・許可リスト・クライアント
    github/            GitHub App クライアントと取り込み
    import/            取り込み結果を DB に反映
    tracker/           TrackerProvider インターフェースと Asana 実装
    mcp/               認証・IP 判定・回数制限・監査ログ・ツール
  test/                PGlite を使う DB テストの共通処理
fixtures/              開発用の node.yaml サンプル (seed で DB に入れる)
```

## テーブル

| テーブル | 中身 |
|---|---|
| nodes | id (node.yaml の id), kind, title, summary, status, tags, links, diagrams, detail_path, meta (jsonb), source_repo, source_sha, updated_at |
| relations | from_id, to_id, type (主キーは 3 つの組) |
| external_refs | node_id, provider ('asana'), external_id。(node_id, provider) で一意 |
| task_cache | provider, external_id (タスク), project_external_id, node_id, name, completed, due_on, url, updated_at |
| sync_state | key (例 `asana:webhook-secret:<project gid>`), value, updated_at |
| import_errors | source_repo, path, message, created_at (検証に失敗した node.yaml の記録) |
| user / session / account / verification | Better Auth |
| agent_tokens | トークンの名前・ハッシュ・権限・期限・失効日時・最終使用日時 |
| ip_allowlist | 許可する CIDR・ラベル・作成日時 |
| mcp_rate_limits | トークンごと・種類 (all / write) ごと・時間枠ごとの呼び出し回数 |
| mcp_audit_log | 時刻・モード・トークン ID・IP・ツール・引数の要約・結果・理由・所要時間 |

MCP 用の 4 テーブルは GitHub や Asana から作り直せない運用データであり、表示用の一時保存とは分けて扱う。

## 拡張の口

- **Kind**: `src/lib/manifest/kinds.ts` に kind を追加し、`meta` の Zod スキーマを登録する
- **Tracker**: `src/lib/tracker/types.ts` の `TrackerProvider` を実装する
- **Importer**: GitHub 以外の取り込み元は `src/lib/import/` の `upsertManifests` に渡す形をそろえる

## 関連

- [CONTEXT.md](../CONTEXT.md): 用語集
- [docs/adr/](adr/): 設計上の決定
- [docs/specs/mcp-devloop-local.md](specs/mcp-devloop-local.md): MCP の口・開発ループ・ローカル機能の仕様
