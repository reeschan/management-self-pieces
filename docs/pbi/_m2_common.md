## M2 の共通の決まり (全 PBI に添えて渡す)

- 仕様: `docs/specs/mcp-devloop-local.md` の「M2 devloop のアプリ側」。用語: `CONTEXT.md`。ADR: `docs/adr/0002`
- **復元したコード**: 失われた以前の実装が `C:\Users\owner\Documents\dev\myapp\management-self-pieces-recovered-20261012\src\` にある (以下 `R/`)。PBI に「R/… を土台にする」とあれば、そのファイルを Read して、振る舞いとテストしやすさを保ちつつ、この PBI の指示に合わせて書き直す。R/ のファイルは変更しない
- **DB**: 新しく書くデータの読み書きは `AppDb` (`@/db/types`) を引数に取る。`getDb()` を中で呼ばない (Server Action とルートだけが `getDb()` を呼ぶ)。`db.batch` と `db.transaction` は使わない (neon-http と PGlite の両方で動かすため)。1 文で済む insert / update / upsert / delete で書く
- **テスト**: DB を使うテストは `createTestDb()` (`@/test/pglite`)。`beforeAll` で作り、`beforeEach` で関係するテーブルを空にする (`src/lib/mcp/gate.test.ts` が手本)。Asana は、PBI-062 以降は偽物 `createFakeTracker()` (`@/test/fake-tracker`) を使う。Asana の HTTP の実装そのもののテストは、`fetch` を差し替える (`src/lib/tracker/tracker.test.ts` が手本)
- **時刻**: サービスの中で `new Date()` を呼ばず、引数か依存の `now()` から取る
- **Next.js 16.4** は学習データと違う点がある。ルート・ページ・Server Actions を書く前に `node_modules/next/dist/docs/` の該当する文書を読む (`01-app/01-getting-started/15-route-handlers.md`、`07-mutating-data.md`、`03-layouts-and-pages.md`、`05-server-and-client-components.md`)
- **認証**: 画面の Server Action とログイン必須のルートは、最初に `getAllowedSession()` (`@/lib/auth/server`) を確かめ、null なら `Error("unauthorized")` か 401
- **エラー**: 利用者 (エージェント) に返す文言に、例外の message・スタック・SQL・環境変数を入れない
- **シェル**: Git Bash では `"/..."` を含む引数がパスに書き換えられることがある。grep が想定外の結果なら `MSYS_NO_PATHCONV=1 ` を付けて再実行し、その旨を報告に書く。`pnpm` が PATH に無ければ `npx pnpm` か `node_modules/.bin` を使う
- **並行作業**: 別の作業者が同時に別の PBI のファイルを作っていることがある。自分の対象ファイル以外は触らない。typecheck や test:unit が他人の途中のファイルで落ちたら、その旨とエラーをそのまま報告に書く
- コメントと文言は日本語。コミットはしない
