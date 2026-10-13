# セットアップ手順

外部サービスの設定は手作業になる。各節で、何をどこで設定し、`.env` のどのキーに何を入れるかを書く。値の実例は書かず、プレースホルダーで示す。環境変数の一覧は `.env.example` にある。ローカルでは `.env.local`、Vercel では Project の Environment Variables に入れる。

## 1. Neon

- Vercel の Marketplace から Neon を追加する。Neon の接続文字列を `DATABASE_URL` に入れる
- `pnpm db:migrate` を実行し、テーブルを作る

## 2. Better Auth

- `BETTER_AUTH_SECRET`: `openssl rand -base64 32` で作った値を入れる
- `APP_URL`: アプリの公開 URL を入れる (例: `http://localhost:3000`、本番は Vercel の URL)
- `ALLOWED_EMAILS`: ログインを許可するメールアドレスをカンマ区切りで入れる。ここに無いアカウントは Google と GitHub のどちらでも拒否される

## 3. Google OAuth

1. Google Cloud Console で OAuth クライアント (種類: ウェブアプリケーション) を作る
2. 承認済みリダイレクト URI に `<APP_URL>/api/auth/callback/google` を入れる。ローカル用に `http://localhost:3000/api/auth/callback/google` も入れる
3. クライアント ID を `GOOGLE_CLIENT_ID`、クライアントシークレットを `GOOGLE_CLIENT_SECRET` に入れる

## 4. GitHub App

GitHub の Settings > Developer settings > GitHub Apps で App を作る。

- Callback URL: `<APP_URL>/api/auth/callback/github`
- Webhook URL: `<APP_URL>/api/webhooks/github`
- Webhook secret: 任意の長い文字列を決め、`GITHUB_WEBHOOK_SECRET` に入れる
- Repository permissions: Contents を Read-only、Metadata を Read-only にする
- Account permissions: Email addresses を Read-only にする
- Subscribe to events: Push にチェックを入れる (installation / installation_repositories はアプリの既定で届く)
- App ID を `GITHUB_APP_ID` に入れる
- Client ID を `GITHUB_APP_CLIENT_ID`、Client secret を `GITHUB_APP_CLIENT_SECRET` に入れる
- 秘密鍵 (.pem) を生成し、`GITHUB_APP_PRIVATE_KEY` に入れる。改行を `\n` にすれば 1 行で入れてよい
- 自分のアカウントに App をインストールし、対象のリポジトリを選ぶ

## 5. Asana

- 個人アクセストークン (PAT) を作り、`ASANA_PAT` に入れる
- ワークスペースの GID を調べ、`ASANA_WORKSPACE_GID` に入れる。`GET https://app.asana.com/api/1.0/workspaces` を PAT で呼ぶと一覧が返る
- 組織のワークスペースを使う場合は、チームの GID を `ASANA_TEAM_GID` に入れる。個人のワークスペースでは空のままでよい
- Webhook はアプリが Node をつなぐときに自動で作る。手作業は不要

## 6. Vercel

1. Vercel でこのリポジトリを Import する
2. ここまでの環境変数をすべて Project に設定する (`DATABASE_URL`、`BETTER_AUTH_SECRET`、`APP_URL`、`ALLOWED_EMAILS`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET`、`GITHUB_WEBHOOK_SECRET`、`ASANA_PAT`、`ASANA_WORKSPACE_GID`、`ASANA_TEAM_GID`)
3. `CRON_SECRET` に任意の長い文字列を入れる。Cron の呼び出しで使う
4. デプロイする
- Hobby プランの Cron は 1 日 1 回しか動かない

## 7. 各リポジトリに node.yaml を置く

1. `examples/node.yaml` を、Node にしたいリポジトリのルートにコピーする
2. 値を書き換える。`id` は英小文字・数字・ハイフンで、リポジトリ内で一意にする
3. 1 行目の `# yaml-language-server: $schema=...` は、エディタの補完と検証を有効にする行。`<your-app>` を自分のアプリの URL に置き換えると、`/schema/node.json` から補完が効く
4. コミットして push すると、GitHub App の Webhook で取り込まれる

## 8. 困ったとき

- 取り込みエラー: ダッシュボードの Node の概要タブに出る。node.yaml の検証に失敗した場合は、そのメッセージを見て直す
- 手動で全部取り込み直す: `curl -H "Authorization: Bearer $CRON_SECRET" <APP_URL>/api/cron/import`
- Asana の Webhook を作り直す: `sync_state` テーブルの `asana:webhook-secret:<project gid>` の行を消してから、Node をつなぎ直す

## 9. MCP の口

Claude Code から `/api/mcp` に接続し、Node と看板を読む。

### マイグレーション

対象の DB を `DATABASE_URL` に設定し、`pnpm db:migrate` を実行する。MCP 用に `agent_tokens`・`ip_allowlist`・`mcp_rate_limits`・`mcp_audit_log` の 4 テーブルが増える。

### ホスト (Vercel) で使う

1. アプリにログインし、設定画面 (`/settings`) の「今の IP を許可」を押す。または、接続元の CIDR を IP 許可リストに追加する
2. 設定画面でエージェント用トークンを発行する。M1 の読み取りには `read` 権限を選ぶ。値は発行時にしか表示されないのでコピーし、Claude Code を動かす PC の環境変数 `PIECES_AGENT_TOKEN` に入れる
3. 次のコマンドで登録する。`<アプリ>` はデプロイ先のホスト名に置き換える

ヘッダーは単一引用符で囲み、`${PIECES_AGENT_TOKEN}` をシェルに展開させずにそのまま Claude Code に渡す。Claude Code は接続するときに環境変数から値を読むので、設定ファイル (`~/.claude.json`) にトークンの値は残らない。

Bash では、トークンをシェルの設定ファイル (例 `~/.bashrc`) で環境変数 `PIECES_AGENT_TOKEN` として export しておき、次のコマンドで登録する。

```bash
claude mcp add --scope user --transport http pieces https://<アプリ>/api/mcp --header 'Authorization: Bearer ${PIECES_AGENT_TOKEN}'
```

Windows では `setx PIECES_AGENT_TOKEN "<トークン>"` で環境変数に保存し、新しく開いた PowerShell で登録する。`setx` の値は実行中のターミナルには反映されない。

```powershell
claude mcp add --scope user --transport http pieces https://<アプリ>/api/mcp --header 'Authorization: Bearer ${PIECES_AGENT_TOKEN}'
```

登録したら `claude mcp get pieces` を実行し、ヘッダーが `${PIECES_AGENT_TOKEN}` のまま (トークンの値が出ていない) ことを確かめる。値が出ていたら `claude mcp remove --scope user pieces` で外し、単一引用符で登録し直す。

### ローカルで使う

1. `.env.local` に `LOCAL_AGENT_FEATURES=1` を入れる (`VERCEL` が設定されている環境ではホストモードになる)
2. `pnpm dev:local` で起動する。127.0.0.1 だけで待ち受ける
3. 次のコマンドで登録する。ローカルではトークンと IP 許可リストは不要

```bash
claude mcp add --scope user --transport http pieces http://127.0.0.1:3000/api/mcp
```

ホストとローカルを切り替えるときは、先に `claude mcp remove --scope user pieces` で既存の登録を外す。

### 守り

- 権限は `read` (読み取り)・`board` (看板の書き込み)・`loop` (開発ループの制御) に分ける。`read` は `list_nodes`・`get_project`・`get_board`・`is_stopped`、`board` は `create_item`・`move_item`・`update_item`・`comment_item`・`request_owner`、`loop` は `next_project`・`report_run`・`pause`
- ホストではトークンごとに、全体 1200 回/時、書き込み 300 回/時を上限とする。UTC の正時ごとの固定枠で数える
- ツールの実行結果や拒否理由は監査ログに残す。90 日を過ぎたログは取り込み Cron の実行時に削除する
- ホストでは IP 許可リストが空なら全部拒否する。許可された IP でも有効なトークンが要る
- ローカルでは Host と Origin (ある場合) がループバックのホスト名かを確かめる

### IP が変わって弾かれたとき

設定画面の監査ログを「拒否だけ」に絞り、理由が `ip_not_allowed` かを確かめる。「今の IP を許可」を押すか、Claude Code の接続元の CIDR を追加して再接続する。再び弾かれたら「拒否だけ」で新しいログを確かめる。

## 10. devloop

AI のチームが Node の開発を少しずつ進める仕組み。看板は Asana に置き、制御と記録はこのアプリが持つ。PC 側のスキルは devloop リポジトリにある。

### マイグレーション

「9. MCP の口」と同じく、`DATABASE_URL` の DB に対して `pnpm db:migrate` を実行する。0003 で devloop の 4 テーブル (`dev_projects`・`devloop_control`・`devloop_runs`・`iterations`) が増え、`task_cache` に `section`・`tags`・`meta` の列が増える。

### 環境変数

`ASANA_OWNER_GID` に、持ち主の Asana のユーザー GID を入れる (任意)。`GET https://app.asana.com/api/1.0/users/me` を PAT で呼ぶと、`data.gid` に自分の GID が返る。

- 「Owner 判断」の項目の担当になる。`request_owner` で作られた項目は、この人が担当になる
- この人が書いたコメントは、Owner の答えとして扱われる。未設定なら、コメントの本文を `[from:owner]` で始めたものだけが答えになる

### Node ごとの準備

事前に「5. Asana」の設定を済ませておく。Node のパネルで次の順に行う。

1. 「看板」タブで「看板を用意する」を押す。Asana のプロジェクトをつなぎ (無ければ作る)、足りない列を作る。列は Inbox・Backlog・Sprint・In Progress・Biz Review・Done・Owner 判断・Rejected の 8 つ。つながった後は「列を整える」で、足りない列を作れる
2. 「開発ループ」タブで「devloop を有効にする」にチェックを入れ、自律度 (L0〜L3) と「1 日の上限」「1 周の PBI の上限」「Sprint の上限」を決めて「設定を保存」を押す
3. 新しい Node は一時停止の状態で作られる。「開発ループ」タブの「再開」を押すまで、次の周に選ばれない

### ランナーが使うトークン

1. 設定画面 (`/settings`) の「エージェント用トークン」で、権限に `read`・`board`・`loop` の 3 つを選んで発行する。権限の既定は `read` だけなので、`board` と `loop` を足す。値は発行時にしか表示されないので、コピーしておく
2. 値を、devloop を動かす PC の環境変数 `PIECES_AGENT_TOKEN` に入れる。入れ方は「9. MCP の口」と同じ
3. devloop リポジトリのルートで、次のコマンドを実行する。`<アプリ>` はデプロイ先のホスト名に置き換える

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -RegisterMcp -AppUrl https://<アプリ>/api/mcp
```

`install.ps1` は、`skills\devloop` を `~/.claude/skills/devloop` に丸ごと写す (写し先にだけあるファイルは消える)。`agents` の `devloop-*.md` も写す。`-RegisterMcp` を付けると、続けて MCP を `pieces` の名前で登録する。`PIECES_AGENT_TOKEN` か `-AppUrl` が無いときは、何も写さずに止まる。写すファイルの一覧だけを見るには `-WhatIf` を付ける。

4. 登録の後、`claude mcp get pieces` を実行し、Authorization がトークンの値ではなく `${PIECES_AGENT_TOKEN}` のまま出ていることを確かめる

### 止め方

止めると、動いている手順 (PBI) を終えた所で止まる。マージの直前にも止まっているかを確かめ、止まっていればマージせずに PR を残す。止め方は次のどれか。

- Node を止める: 「開発ループ」タブで止める理由を入れて「一時停止」を押す。「再開」で戻す
- すべての Node を止める: 設定画面の「devloop」にある「全体停止」で、理由を入れる (省略できる)。「全体を止める」を押す。「再開する」で戻す
- ファイルで止める: PC の `~/.claude/devloop/STOP` を作る (空のファイルでよい)。消すと再開できる。ただし、このファイルを読む処理は devloop リポジトリにまだ無い (`runner/` が空)。ランナーが入るまでは、ファイルを作っても止まらない

### Owner 判断への答え方

答えは、画面か Asana のどちらからでも出せる。

- 画面: ヘッダーの「Owner 判断」を開く (`/owner`)。項目の「回答」に入れて「答える」を押す。答えは、その項目に `[from:owner]` の印つきのコメントとして付く
- Asana: 「Owner 判断」の列の項目に直接コメントする。`ASANA_OWNER_GID` の人が書いたコメントは答えとして扱われる。未設定なら、本文を `[from:owner]` で始める
- 件数: ヘッダーの件数と `/owner` の件数は、「Owner 判断」の列にある未完了の項目の数。答えを送っただけでは項目は列に残るので、件数は減らない。判断が済んだら、Asana で項目を完了にするか、別の列へ移す

### 1 日の上限と自動停止

- 全体の上限: 設定画面の「1 日あたりの上限」(1〜20、既定 1)。全 Node を合わせて、日本時間の 1 日に終えるイテレーションの数。既定の 1 のままなら、全体で 1 日 1 回しか回らない
- Node ごとの上限: 「開発ループ」タブの「1 日の上限」(1〜20、既定 1)
- 3 回続けて失敗: 同じ Node の終わった実行の直近 3 件が、すべて `failed` のとき、その Node を「3 回続けて失敗」の理由で一時停止する。原因を確かめてから「再開」を押す
- 全体停止や上限の値が読めないときは、止まる側に倒す
