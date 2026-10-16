## Node をアプリで持つ作業の共通の決まり (PBI-080〜094 に添えて渡す)

- 仕様: `docs/specs/node-in-app.md`。ADR: `docs/adr/0003-node-source-of-truth-in-app.md`。用語: `CONTEXT.md` (Node・Node のリポジトリ・Node の候補)
- 背景: Node の中身の正を、各リポジトリの `node.yaml` からアプリの DB に移す。`node.yaml` の取り込み・`/schema/node.json`・`import_errors`・`nodes.source_sha` は廃止する。Node は自動では消さない

### 守ること (M2 から引き継ぐ)

- **DB**: 読み書きする関数は `AppDb` (`@/db/types`) を引数か依存で受け取る。`getDb()` を呼ぶのは Server Action・ルート・scripts だけ。`db.batch` と `db.transaction` は使わない (neon-http と PGlite の両方で動かすため)。1 文で済む insert / update / upsert / delete で書く
- **テスト**: DB を使うテストは `createTestDb()` (`@/test/pglite`)。`beforeAll` で作り、`afterAll` で `close()`、`beforeEach` で関係するテーブルを空にする (`src/lib/mcp/gate.test.ts` が手本)。GitHub は `RepoSource` の偽物を使う (PBI-084 以降は `createFakeRepoSource()` (`@/test/fake-repo-source`))。テストは外から見た振る舞いだけを確かめる
- **時刻**: サービスの中で `new Date()` を呼ばず、依存の `now()` から取る
- **Next.js 16.4** は学習データと違う点がある。ページ・ルート・Server Actions を書く前に `node_modules/next/dist/docs/01-app/01-getting-started/` の該当する文書を読む (`03-layouts-and-pages.md`・`05-server-and-client-components.md`・`07-mutating-data.md`・`15-route-handlers.md`)
- **認証**: Server Action とログイン必須のルートは、最初に `getAllowedSession()` (`@/lib/auth/server`) を確かめ、null なら `Error("unauthorized")` か 401
- **エラー**: 利用者に返す文言に、例外の message・スタック・SQL・環境変数を入れない (`NodeServiceError` の message は利用者向けに作るので、そのまま出してよい)
- **シェル**: Git Bash では `"/..."` を含む引数がパスに書き換えられることがある。grep が想定外の結果なら `MSYS_NO_PATHCONV=1 ` を付けて再実行し、その旨を報告に書く。`pnpm` が PATH に無ければ `npx pnpm` か `node_modules/.bin` を使う
- **並行作業**: 別の作業者が同時に別の PBI のファイルを作っていることがある。自分の対象ファイル以外は触らない。typecheck や test:unit が他人の途中のファイルで落ちたら、その旨とエラーをそのまま報告に書く
- コメントと文言は日本語。コミットはしない

### モジュールの契約 (各 PBI はこれに合わせる。名前と形を変えない)

**DB (PBI-082 の後)** — `nodes` の列:
`id`・`kind`・`title`・`summary`・`status`・`detailPath: string | null`・`tags`・`links`・`diagrams`・`meta`・`sourceRepo: string | null` (`owner/repo`。一意)・`repoId: number | null` (GitHub のリポジトリ id。一意)・`repoReachable: boolean` (既定 true)・`createdAt`・`updatedAt`。`sourceSha` と `import_errors` は無い

**GitHub (PBI-084 の後)** — `src/lib/github/types.ts`:

```ts
export type RepoRef = {
  id: number;
  fullName: string; // "owner/name"
  defaultBranch: string;
  description: string | null;
  topics: string[];
  homepage: string | null;
  htmlUrl: string;
  archived: boolean;
};
export interface RepoSource {
  listRepos(): Promise<RepoRef[]>;
  getRepo(fullName: string): Promise<RepoRef | null>; // App が入っていない・無い → null
  getRepoById(id: number): Promise<RepoRef | null>;   // 同上
  getFile(fullName: string, path: string, ref: string): Promise<{ content: string; sha: string } | null>;
  getRawFile(fullName: string, path: string, ref: string): Promise<{ bytes: Uint8Array } | null>;
}
```

**Node の入力 (PBI-085)** — `src/lib/nodes/input.ts`:

```ts
export const NodeFields;      // kind・title・summary・status・tags・links・meta・detailPath (RepoPath | null)・diagrams・relations ({ type, to }[])
export const NodeRepo;        // { id: number | null, fullName: string } (fullName は owner/name の形)
export const NodeCreateInput; // NodeFields + { id: NodeId, repo: NodeRepo | null }
export const NodeUpdateInput; // NodeFields (id とリポジトリは変えられない)
```

- meta は kind ごとの型 (`src/lib/manifest/kinds.ts`) で検証する (未知のキーは許す)
- リポジトリが無い Node は、`detailPath` が null で `diagrams` が空でなければならない
- 自分自身への関係は許さない

**Node のサービス (PBI-085)** — `src/lib/nodes/service.ts`:

```ts
export type NodeErrorCode = "invalid" | "not_found" | "id_taken" | "repo_taken" | "relation_target_missing" | "has_records" | "github_unavailable";
export class NodeServiceError extends Error { code: NodeErrorCode } // message は利用者向けの日本語
export function createNodeService(deps: { db: AppDb; source: () => RepoSource; now: () => Date }): {
  listCandidates(): Promise<RepoRef[]>;                         // App から見えて、どの Node にも結び付いていないリポジトリ
  draftFromRepo(fullName: string): Promise<NodeCreateInput>;    // 登録の初期値
  create(input: unknown): Promise<{ id: string }>;
  update(id: string, input: unknown): Promise<void>;
  deletionBlockers(id: string): Promise<("asana" | "devloop")[]>;
  remove(id: string): Promise<void>;
};
```

`source` は、使うときに初めて呼ぶ (GitHub の環境変数が無くても、リポジトリを使わない操作は動くように)

**つながりの更新 (PBI-086)** — `src/lib/nodes/repo-link.ts`:

```ts
export type RepoKey = { id: number; fullName: string };
export type RefreshSummary = { checked: number; updated: number; unreachable: number; failed: number };
export function createRepoLinkService(deps: { db: AppDb; source: () => RepoSource; now: () => Date }): {
  refreshAll(): Promise<RefreshSummary>;                 // リポジトリを持つ全 Node
  refreshRepos(repos: RepoKey[]): Promise<RefreshSummary>; // 指定のリポジトリを持つ Node だけ
  markUnreachable(repos: RepoKey[]): Promise<number>;    // 届かない印を付けた Node の数
};
```

どの操作も Node を消さない

**書き出しと読み込み (PBI-087)** — `src/lib/nodes/transfer.ts`:

```ts
export const ExportFile; // { version: 1, exportedAt: string, nodes: ExportNode[], relations: { from, to, type }[] }
// ExportNode = NodeFields から relations を除いたもの + { id, repo: NodeRepo | null }
export function exportNodes(db: AppDb, now: () => Date): Promise<ExportFile>;
export type ImportPreview = { ok: true; added: number; updated: number } | { ok: false; errors: string[] };
export function previewImport(db: AppDb, raw: unknown): Promise<ImportPreview>;
export function importNodes(db: AppDb, raw: unknown, now: () => Date): Promise<{ added: number; updated: number }>; // 検証に落ちたら NodeServiceError("invalid") を投げ、何も書かない
```
