# Node の中身をアプリで持つ (node.yaml の廃止)

- 状態: 合意済み (2026-10-14、design-flow v1)
- 決定の記録: [ADR 0003](../adr/0003-node-source-of-truth-in-app.md)。用語は [CONTEXT.md](../../CONTEXT.md)
- 順番: M3 (ローカル機能、[mcp-devloop-local.md](mcp-devloop-local.md)) より先にやる

## Problem Statement

持ち主は、自分の成果物を Node として 3D のグラフで眺めたい。しかし今は、Node にするには、そのリポジトリのルートに `node.yaml` を書いて push する必要がある。成果物のたびにファイルを書いて保つのは手間で、実際に `node.yaml` を書いたリポジトリは 1 つだけである。リポジトリを持たない成果物 (`~/.claude/skills` のスキル・文書など) は、そもそも Node にできない。

## Solution

Node の中身はアプリが持つ。持ち主は画面で次のことを行う。

- GitHub App から見えるリポジトリ (Node の候補) を一覧で見て、選んで Node として登録する。登録時の初期値は、GitHub のリポジトリの情報で埋まる
- リポジトリの無い Node も手で作る
- Node の項目を、画面のフォームで直す

詳細の説明 (README など) と図は、これまでどおり Node のリポジトリから読む。リポジトリの名前が変わったり、App から外されたりしても、Node は消えない。「届かない」と画面に出るだけである。DB が消えたときの備えとして、設定画面から JSON で書き出し、読み込める。`node.yaml` は読まなくなる。

## User Stories

1. 持ち主として、GitHub App から見えて、まだ Node になっていないリポジトリの一覧 (Node の候補) を見たい。何を登録できるかがわかるように
2. 持ち主として、候補から 1 つ選んで Node として登録したい。リポジトリにファイルを書かずに済むように
3. 持ち主として、登録フォームに、リポジトリの名前・説明・topics・homepage・README の有無から作った初期値が入っていてほしい。ほとんど直さずに登録できるように
4. 持ち主として、登録時に kind を選びたい。アプリ・スキル・文書などを区別できるように
5. 持ち主として、初期値の id が他の Node と重なったら、その場で知らせてほしい。登録に失敗した理由がわかるように
6. 持ち主として、id は登録時にだけ決めたい。Asana や devloop の記録とのつながりが切れないように
7. 持ち主として、リポジトリを持たない Node (スキル・文書など) も作りたい。リポジトリに無い成果物もグラフに載せられるように
8. 持ち主として、リポジトリの無い Node の links に置き場所を書きたい。詳細が無くてもたどれるように
9. 持ち主として、登録済みの Node の一覧を見たい。何が登録されているかを 1 画面で確かめられるように
10. 持ち主として、Node の title・summary・status・tags・links・関係・meta・詳細のパス・図のパスを、フォームで直したい。リポジトリに push せずに直せるように
11. 持ち主として、kind ごとに決まった meta の欄 (app なら公開 URL とデプロイ先など) を、フォームの欄として出してほしい。キーの綴りを間違えないように
12. 持ち主として、kind に定義の無い meta のキーも足したい。決まった欄に無い情報も残せるように
13. 持ち主として、関係の先を、登録済みの Node から選びたい。存在しない Node を指す関係を作らないように
14. 持ち主として、3D のパネルから、その Node の編集画面に飛びたい。見ていて気付いた誤りをすぐ直せるように
15. 持ち主として、登録を間違えた Node を消したい。ただし、Asana との対応や devloop の記録がある Node は消せず、アーカイブを勧めてほしい。運用の記録を誤って失わないように
16. 持ち主として、消す前に、その Node に向いた関係も消えることを確認したい。グラフの線が消える理由がわかるように
17. 持ち主として、使わなくなった Node を archived にしたい。記録は残したまま、普段の表示から外せるように
18. 持ち主として、GitHub でリポジトリの名前を変えても、Node とのつながりを保ちたい。手で直さずに済むように
19. 持ち主として、リポジトリが消えたり App から外れたりしても、Node を自動で消してほしくない。devloop の記録まで消えないように
20. 持ち主として、リポジトリに届かない Node には、一覧とパネルに印を出してほしい。つながりが切れていると気付けるように
21. 持ち主として、届かない Node の詳細は「読めない」と出してほしい。エラーの画面にならないように
22. 持ち主として、設定画面から、Node・リポジトリとのつながり・関係を JSON で書き出したい。DB が消えたときに戻せるように
23. 持ち主として、書き出した JSON を読み込みたい。DB を作り直したあとに戻せるように
24. 持ち主として、読み込む前に、追加と更新の件数を見たい。間違ったファイルを読み込む前に気付けるように
25. 持ち主として、JSON に無い Node が、読み込みで消されないでほしい。古いファイルを読み込んでも、新しい Node を失わないように
26. 持ち主として、壊れた JSON を読み込んだら、何も変えずに理由を出してほしい。中途半端に書き換わらないように
27. 持ち主として、今 `node.yaml` から取り込まれている Node が、移行後もそのまま残ってほしい。Asana との対応や devloop の記録が消えないように
28. devloop (エージェント) として、`get_project`・`list_nodes` が返す `sourceRepo` は、今までどおり `owner/repo` の形で受け取りたい。元のクローンを探す手順を変えずに済むように
29. devloop として、リポジトリの無い Node では `sourceRepo` を `null` で受け取りたい。クローンが無いと判断できるように
30. devloop として、`next_project` で、リポジトリが無い Node や届かない Node を選ばれたくない。作業できない Node で 1 回分を無駄にしないように
31. 開発者として、seed で、書き出し JSON と同じ形の fixtures を、読み込みと同じ処理で入れたい。読み込みの処理を普段から試せるように
32. 開発者として、`node.yaml` の取り込み・`/schema/node.json`・取り込みエラーの記録がコードから消えていてほしい。使われない仕組みを保たずに済むように

## Implementation Decisions

### データの正とスキーマ

- Node の項目 (kind・title・summary・status・tags・links・関係・meta・詳細のパス・図のパス) は、アプリの DB を正とする ([ADR 0003](../adr/0003-node-source-of-truth-in-app.md))
- nodes テーブルを次のように変える。マイグレーションは既存の行を残す
  - リポジトリの名前の列 (今の `source_repo`): `owner/repo` の形を引き継ぎ、NULL を許す (リポジトリの無い Node)
  - 追加: GitHub のリポジトリ id (NULL を許し、NULL でない値は一意)、届くか (真偽)、作成日時
  - 詳細のパス: NULL を許す (リポジトリの無い Node は NULL。リポジトリがあるときの既定は `README.md`)
  - 削除: `source_sha`
- リポジトリの名前も、NULL でない値は一意 (1 リポジトリに Node は 1 つまで)
- 既存の行のリポジトリ id は NULL のまま移行し、つながりの更新 (下記) が最初に見たときに埋める
- `import_errors` テーブルは消す
- Node の入力の検証には、今の Zod のスキーマ (kind の登録表と kind ごとの meta を含む) を引き継ぐ。`node.yaml` という名前と、JSON Schema の公開 (`/schema/node.json`) はやめる

### Node のサービス (新しいモジュール)

DB と GitHub (今の `RepoSource` を広げたもの) を受け取って作る、1 つのモジュールにまとめる。画面の Server Actions・Cron・Webhook・seed は、すべてこれを呼ぶ。外向きの操作は次のとおり。

- **候補の一覧**: App から見えるリポジトリのうち、どの Node にも結び付いていないもの (リポジトリ id と名前で照合)
- **登録の初期値**: リポジトリ 1 つから、初期値を作る
  - id: リポジトリの名前を Node の id の形 (英小文字・数字・ハイフン、63 文字まで) に直したもの
  - title: リポジトリの名前
  - summary: リポジトリの description (無ければ空。空のままでは登録できない)
  - tags: topics
  - links: `repo` (GitHub の URL) と、あれば `homepage`
  - 詳細のパス: README があれば `README.md`
  - status: active
- **登録**: id の重なり、リポジトリの重なり、関係の先が存在するか、を検証して作る。id は以後変えない
- **編集**: id とリポジトリ以外の項目を直す。関係は、その Node から出る関係を丸ごと置き換える
- **削除できるかの判定と削除**: Asana との対応・devloop の設定・実行の記録・イテレーションのどれも無いときだけ消せる。消せないときは、理由と「archived にする」案内を返す。消すと、その Node に向いた関係も消える (cascade)
- **つながりの更新**: 次の 2 つを行う。Node を消すことはしない
  - リポジトリ id (無ければ名前) で GitHub を引き、名前の変更を反映し、届くかを記録する
  - Webhook からの「このリポジトリはもう届かない」を記録する
- **書き出し**: `{ version: 1, exportedAt, nodes: [...], relations: [...] }`。各 Node は項目とリポジトリ (`{ id, fullName } | null`) を持つ。Asana との対応と devloop の記録は含めない
- **読み込みのプレビューと読み込み**:
  - 先にファイル全体を検証する。検証の内容は、形、関係の先がファイルか DB にあるか、リポジトリが別の id の Node に既に結び付いていないか
  - プレビューは、追加と更新の件数と、エラーの一覧を返す
  - 読み込みは、検証をすべて済ませてから書き込む。書き込みは id での upsert と、無ければ足す関係だけにする (トランザクションは neon-http と PGlite の両方では使えないため、途中で落ちても同じファイルを読み込み直せば揃う形にする)。ファイルに無い Node と関係は消さない

### GitHub との接点

- `RepoSource` を広げ、リポジトリの id・description・topics・homepage・URL・archived を返せるようにする。id でリポジトリを引けるようにもする
- Webhook の扱いを、取り込みから「つながりの更新」に入れ替える
  - `repository` (renamed・deleted・transferred): 名前の更新、または届かない印
  - `installation_repositories` (removed) と `installation` (deleted): 対象の Node に届かない印
  - `installation_repositories` (added): そのリポジトリの Node があれば、つながりを更新する (届く印に戻す)。無ければ何もしない (候補に出るだけ)
  - `push`: 無視する
- 既存の取り込みの Cron は、全 Node のつながりの更新に置き換える。監査ログの古い分を消す処理は、今までどおり Cron に残す
- 詳細の Markdown と図は、表示のたびに Node のリポジトリから読む (今と同じ)。リポジトリが無い Node や、届かない Node では、詳細を「読めない」として返す

### 画面

- 新しい「Node」画面 (`/nodes`): 登録済みの一覧 (届かない印・status 付き) と、候補の一覧を並べる。「リポジトリ無しで作る」ボタンを置く
- 登録 (`/nodes/new`、候補から来るときは初期値入り) と編集 (`/nodes/[id]/edit`) は、同じフォームを使う
  - kind を選ぶと、その kind の meta の欄が出る。決まった欄に無いキーは、key-value の欄で足す
  - 関係の先は、登録済みの Node から選ぶ
  - 削除のボタンは編集画面に置く
- 3D のパネルに「編集」へのリンクを足す
- 設定画面に「書き出し」(JSON のダウンロード) と「読み込み」(ファイルを選ぶ → プレビュー → 実行) を足す
- ログイン必須の範囲 (今の `(app)` の配下) に置き、ナビゲーションに「Node」を足す

### MCP と devloop の契約

- `list_nodes`・`get_project` の `sourceRepo` は、項目の名前と `owner/repo` の形を変えない。リポジトリの無い Node では `null`
- `next_project` は、リポジトリがあり、届く Node だけを候補にする
- MCP から Node を登録・編集するツールは足さない

### 移行と後片付け

- マイグレーションで既存の行を残し、つながりの列を足す。本番の Neon への適用は、デプロイ前に持ち主が行う (M2 の `0002`・`0003` と同じ扱い)
- このリポジトリの `node.yaml` を消す。中身は既に DB にあり、マイグレーションで残る
- `node.yaml` の取り込み・解析・`/schema/node.json`・`import_errors` を読み書きする処理を消す
- fixtures を書き出し JSON の形 (1 ファイル) に変え、seed はサービスの読み込みを使う。fixtures のリポジトリは実在の名前でよい。開発環境で GitHub に届かなければ、詳細が出ないだけで動く
- DESIGN.md (方針・取り込みの流れ・テーブル)、SETUP.md (GitHub App の Webhook のイベント・`node.yaml` の書き方の節)、README を直す

## Testing Decisions

良いテストは外から見た振る舞いだけを確かめる。内部の関数の分け方や SQL の形は確かめない。

**合意済みの seam** (この 3 つ以外に、テストの境界を増やさない)

1. **Node のサービス**: 候補の一覧・登録の初期値・登録・編集・削除できるかの判定と削除・つながりの更新・書き出し・読み込みのプレビューと読み込みを、外向きの関数で確かめる。DB は既存の PGlite (`src/test/pglite.ts`) を使う。GitHub は `RepoSource` の偽物を使う (今の取り込みのテストと同じやり方)
2. **MCP と devloop の制御 (既存)**: `list_nodes`・`get_project` の `sourceRepo` が、リポジトリの無い Node で `null` になること。`next_project` が、リポジトリの無い Node と届かない Node を選ばないこと
3. **Webhook の解釈 (既存)**: `repository` の renamed・deleted・transferred と `installation_repositories` の removed・`installation` の deleted が、「つながりの更新」の指示になること。`push` が無視されること

**主に確かめること**

- 削除が、Asana との対応や devloop の記録があるときに拒まれること
- つながりの更新が、どの場合も Node を消さないこと
- 読み込みが、壊れたファイルで何も変えないこと
- 読み込みが、ファイルに無い Node を消さないこと
- 書き出したものを空の DB に読み込むと、同じ Node と関係が戻ること (往復)

**参考にする既存のテスト**: `src/lib/github/importer.test.ts` (偽物の RepoSource)、`src/lib/devloop/*.test.ts` (PGlite)、`src/lib/mcp/handler.test.ts`、`src/lib/github/webhook.test.ts`

画面 (フォーム) にはテストを書かない。フォームの処理はサービスを呼ぶだけにする。

## Out of Scope

- devloop 側の変更。今の `skills/devloop/SKILL.md` は、引数が無いとき、ローカルの `node.yaml` の `id` で Node の一覧を作る。これを MCP の `list_nodes` と `devloop.config.yaml` で作るように直すのは、devloop 側でやる。devloop リポジトリへの変更は、持ち主が言うまでしない。それまでローカルの `devloop/node.yaml` は消さずに置く
- MCP から Node を登録・編集するツール
- 1 つのリポジトリに複数の Node を置くこと
- リポジトリの無い Node の詳細 (アプリで Markdown を書くこと)
- kind をアプリで追加すること
- id の変更
- DB の自動バックアップ (定期的な書き出し)
- Asana との対応の作り方の変更 (今のまま、プロジェクトの notes の `piece-node-id`)

## Further Notes

- GitHub App の設定で、Webhook の `repository` イベントを購読する必要がある。購読に要る権限 (Metadata の読み取りで足りるか) は、実装の最初に確かめ、SETUP.md に書く。`push` の購読は外してよい
- 「DB は作り直せる」原則が Node については成り立たなくなる。DESIGN.md の方針の行を、ADR 0003 に合わせて書き直す
- M3 の仕様 ([mcp-devloop-local.md](mcp-devloop-local.md)) は Node の `sourceRepo` からローカルのクローンを探す。この仕様のあとも、その前提は変わらない
