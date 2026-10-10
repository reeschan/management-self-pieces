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
