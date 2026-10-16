# 設計メモ (MVP)

自分の成果物 (アプリ・スキル・文書など) を「Node」という統一の構成物として扱い、3D 空間に浮かぶグラフで眺め、Asana のプロジェクトでチケット管理するための個人用 Web アプリ。

## 方針

- **データの正**: Node の中身はアプリの DB が正 ([ADR 0003](adr/0003-node-source-of-truth-in-app.md))。チケットと看板は Asana が正。備えは、設定画面からの JSON の書き出しと読み込み (手動) だけ。ただし MCP の口の 4 テーブル (`agent_tokens`・`ip_allowlist`・`mcp_rate_limits`・`mcp_audit_log`) と devloop の制御・実行の記録 (`dev_projects`・`devloop_control`・`devloop_runs`・`iterations`) は作り直せない運用データ
- **ホスティング**: Vercel (Hobby)。DB は Neon (Postgres)。費用 0 円の範囲
- **認証**: Better Auth。Google と GitHub でログインし、`ALLOWED_EMAILS` に含まれるメールアドレス以外は拒否する。両方のログインは accountLinking で同じユーザーになる
- **GitHub 連携**: GitHub App 1 つで、ログイン (ユーザー認可)・Webhook (repository・installation_repositories・installation)・候補の一覧・詳細と図の読み出し・つながりの更新を担う
- **Asana 連携**: PAT。Node と Asana プロジェクトは 1 対 1。プロジェクトの説明 (notes) に `piece-node-id: <node id>` を書き、DB が消えても対応を作り直せるようにする。更新は Asana Webhook で受け取る
- **仕様の正**: Node の入力の検証は `src/lib/nodes/input.ts` (kind の登録表は `src/lib/manifest/kinds.ts`)
- **MCP の口**: 画面と同じデプロイで `/api/mcp` を出す。認証は [ADR 0001](adr/0001-mcp-auth-token-and-ip-allowlist.md)
- **devloop の看板の正**: Asana。DB には写し (task_cache) だけを置く ([ADR 0002](adr/0002-board-source-of-truth-in-asana.md))

## 技術構成

Next.js (App Router, TypeScript, `src/` 配下) / pnpm / Tailwind CSS v4 / Drizzle ORM + `@neondatabase/serverless` / Zod v4 / Better Auth / octokit / react-force-graph-3d / react-markdown / mermaid / Vitest

## ディレクトリ

```
src/
  app/
    (app)/            ログイン必須の画面 (layout でセッション確認)
      page.tsx        3D ダッシュボード
      nodes/          Node の一覧・登録 (候補から)・編集
      settings/       エージェント用トークン・IP 許可リスト・監査ログ
      owner/          Owner 判断の受け箱 (全 Node の判断を 1 画面で答える)
      devloop/        devloop の画面から使う Server Actions (看板・設定・Owner 判断への回答)
    login/page.tsx
    api/auth/[...all]/route.ts
    api/mcp/route.ts               MCP の HTTP エンドポイント
    api/webhooks/github/route.ts
    api/webhooks/asana/route.ts
    api/cron/import/route.ts
    api/nodes/[id]/route.ts         Node の詳細 (detail の Markdown、図の一覧、チケット)
    api/nodes/[id]/asset/route.ts   リポジトリ内のファイル (SVG など) を返す
    api/nodes/[id]/devloop/         Node の devloop の表示用データ (パネル用)
  components/          画面部品 (graph/, panel/)
    nodes/             Node の登録・編集フォーム
    settings/          トークンと IP 許可リストの操作
    owner/             Owner 判断の回答フォーム
    panel/devloop/     Node のパネルの「看板」「開発ループ」「イテレーション」タブ
  db/
    schema.ts          アプリのテーブル
    auth-schema.ts     Better Auth のテーブル
    client.ts          Drizzle クライアント (遅延生成)
  lib/
    env.ts             環境変数の検証 (遅延評価。build 時に環境変数が無くても落ちない)
    manifest/          kind の登録表・Node の入力の検証に使う Zod の部品
    auth/              Better Auth の設定・許可リスト・クライアント
    github/            GitHub App クライアント (候補の一覧・詳細と図の読み出し)
    nodes/             Node のサービス・つながりの更新・書き出しと読み込み
    tracker/           TrackerProvider インターフェースと Asana 実装
    devloop/           看板 (写しと meta)・制御 (上限・停止・自動停止)・Owner 判断の受け箱
    mcp/               認証・IP 判定・回数制限・監査ログ・ツール
  test/                PGlite を使う DB テストの共通処理
fixtures/              開発用の Node のサンプル (nodes.json、seed で DB に入れる)
```

## テーブル

| テーブル | 中身 |
|---|---|
| nodes | id, kind, title, summary, status, tags, links, diagrams, detail_path, meta (jsonb), source_repo (owner/repo、一意), repo_id (GitHub の id、一意), repo_reachable (届くか), created_at, updated_at |
| relations | from_id, to_id, type (主キーは 3 つの組) |
| external_refs | node_id, provider ('asana'), external_id。(node_id, provider) で一意 |
| task_cache | provider, external_id (タスク), project_external_id, node_id, name, completed, due_on, url, updated_at, section (列)、tags (タグ)、meta (jsonb) |
| sync_state | key (例 `asana:webhook-secret:<project gid>`), value, updated_at |
| user / session / account / verification | Better Auth |
| agent_tokens | トークンの名前・ハッシュ・権限・期限・失効日時・最終使用日時 |
| ip_allowlist | 許可する CIDR・ラベル・作成日時 |
| mcp_rate_limits | トークンごと・種類 (all / write) ごと・時間枠ごとの呼び出し回数 |
| mcp_audit_log | 時刻・モード・トークン ID・IP・ツール・引数の要約・結果・理由・所要時間 |
| dev_projects | node_id, enabled, paused, pause_reason, autonomy (0〜3), max_iterations_per_day, max_pbis_per_iteration, sprint_limit, last_selected_at, last_run_at, updated_at |
| devloop_control | key (`global_stop`・`daily_limit`), value, updated_at |
| devloop_runs | id, node_id, iteration, phase, status, summary, tokens (jsonb), started_at, heartbeat_at, finished_at |
| iterations | node_id と number の組 (主キー), goal, phase, result, biz_scores, stories, pr_url, stats, started_at, finished_at, source_sha |

MCP 用の 4 テーブルは GitHub や Asana から作り直せない運用データであり、表示用の一時保存とは分けて扱う。

## 拡張の口

- **Kind**: `src/lib/manifest/kinds.ts` に kind を追加し、`meta` の Zod スキーマを登録する
- **Tracker**: `src/lib/tracker/types.ts` の `TrackerProvider` を実装する

## 関連

- [CONTEXT.md](../CONTEXT.md): 用語集
- [docs/adr/](adr/): 設計上の決定
- [docs/specs/mcp-devloop-local.md](specs/mcp-devloop-local.md): MCP の口・開発ループ・ローカル機能の仕様
