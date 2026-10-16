# management-self-pieces

持ち主 1 人の成果物を Node として眺め、チケットと AI による開発 (devloop) を管理するアプリの用語集。

## 成果物とチケット

**Node**:
持ち主の成果物 1 つ (アプリ・スキル・文書など)。中身はアプリが持つ。リポジトリを 0 か 1 つ持ち、1 つのリポジトリが持つ Node は 1 つまで。
_Avoid_: プロジェクト、作品

**Node のリポジトリ**:
Node に結び付いた GitHub のリポジトリ。詳細の説明や図のファイルはここから読む。
_Avoid_: ソース、取り込み元

**Node の候補**:
GitHub App から見えるが、まだ Node として登録していないリポジトリ。持ち主が選んで Node にする。
_Avoid_: 未取り込み

**Tracker**:
Node のチケットを持つ外部サービス。いまは Asana だけで、Node と Asana のプロジェクトは 1 対 1。
_Avoid_: チケット管理

**看板**:
Node ごとの、devloop が使う項目の並び。Asana のプロジェクトのセクションを列とする。
_Avoid_: ボード、カンバン

**列**:
看板の段階の 1 つ (Inbox・Backlog・Sprint・In Progress・Biz Review・Done・Rejected・Owner 判断)。Asana のセクションにあたる。
_Avoid_: ステータス、カラム

**項目**:
看板に載る 1 件の仕事 (story・bug・debt・experiment・chore)。Asana のタスクにあたり、meta を notes に埋め込んで持つ。
_Avoid_: チケット (Tracker 全般の話と区別するため)、カード

## devloop

**devloop**:
AI のチーム (PM・Biz・TL・開発メンバー) が、Node の開発を持ち主の代わりに少しずつ進め続ける仕組み。
_Avoid_: 自動開発、ループ

**イテレーション**:
devloop の 1 周。plan から release までのフェーズを通り、番号 (NNN) を持つ。
_Avoid_: スプリント (列の Sprint と紛らわしいため)

**フェーズ**:
イテレーションの段階 (plan・build・verify・review・retro・groom・release)。
_Avoid_: ステップ

**tick**:
ランナーが devloop を 1 回呼ぶこと。1 回の tick で進めるのは 1 つの Node の 1 フェーズだけ。

**実行**:
1 回の tick の記録。開始・ハートビート・終了 (succeeded・failed・noop・rate_limited) を持つ。
_Avoid_: ジョブ、ラン

**自律度**:
Node ごとに、devloop にどこまで任せるかの段階 (L0〜L3)。L0 は plan と groom だけ。

**Owner 判断**:
devloop が自分で決めずに、持ち主に答えを求める項目。「Owner 判断」の列に置かれ、持ち主がコメントすると答えたことになる。
_Avoid_: 承認待ち、エスカレーション

**一時停止**:
Node 1 つの devloop を止めた状態。理由を持ち、持ち主が画面で再開する。3 回続けて失敗したときは自動でこの状態になる。

**全体停止**:
すべての Node の devloop を止めるスイッチ。

## 外からの入口

**MCP の口**:
アプリが外部のエージェント向けに出す MCP の入口。画面と同じデプロイから出す。
_Avoid_: API、MCP サーバー (アプリと別物に聞こえるため)

**エージェント用トークン**:
MCP の口を呼ぶための鍵。画面で発行し、権限・期限・失効を持つ。
_Avoid_: API キー、PAT (Asana の PAT と紛らわしいため)

**権限**:
エージェント用トークンが呼べるツールの範囲。read・board・loop の 3 つ。
_Avoid_: ロール、スコープ

**監査ログ**:
MCP の口への呼び出しと、弾いた呼び出しの記録。

**IP 許可リスト**:
MCP の口を呼んでよい送信元 IP の範囲の一覧。ループバックは対象外。
_Avoid_: ホワイトリスト

## ローカル

**ローカル機能**:
アプリが持ち主の PC で動き、明示的に有効にしたときだけ使える機能 (Claude Code の起動、フックの受け口)。Vercel では常に無効。
_Avoid_: 開発モード

**Claude セッション**:
アプリがローカル機能で起動した Claude Code の対話セッション。状態は 起動した・作業中・返答待ち・要対応・終了 のどれか。
_Avoid_: ジョブ、エージェント

**ローカルのクローン**:
Node のリポジトリの、持ち主の PC 上の作業コピー。`LOCAL_REPOS_ROOT` の下にリポジトリ名で置く。
_Avoid_: ワークスペース
