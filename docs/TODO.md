# TODO

MVP (docs/pbi の PBI-001〜) がすべて終わってから着手する。

## 1. 品質ガードの導入 (my-portfolio-second と同じ水準)

`stack-setup` スキルを使う。参考は [reeschan/my-portfolio-second](https://github.com/reeschan/my-portfolio-second)。

- [ ] tsconfig を厳しくする (`strict` に加えて `noUncheckedIndexedAccess` など。my-portfolio-second の ADR 0013 を参照)
- [ ] ESLint (typescript-eslint の型付きルール、複雑度の上限) と `eslint-config-prettier`
- [ ] Prettier (`.prettierrc.json` / `.prettierignore`、`format` / `format:check` スクリプト)
- [ ] `pnpm check` (lint → format:check → typecheck → test:unit → build) をまとめるスクリプト
- [ ] コミットゲート (`.githooks/pre-commit`、`.claude/hooks/commit-gate.mjs`)
- [ ] GitHub Actions (`test.yml`、`codeql.yml`)、`dependabot.yml`、ブランチの rulesets、PR テンプレート
- [ ] Playwright の E2E (ログイン画面、ダッシュボードの表示)
- [ ] `docs/adr/` を作り、ここまでの設計判断 (docs/DESIGN.md の内容) を ADR に分けて残す
- [ ] `CLAUDE.md` / `AGENTS.md`

## 2. 見た目を決める

- [ ] `style-guide` スキルを呼び出してテーマを決める (例: 「宇宙に成果物が浮かぶ、落ち着いた暗めのダッシュボード」)。出力の `theme.css` (Tailwind v4) を `src/app/globals.css` に取り込み、3D グラフの kind 別の色もテーマのトークンから取る
- [ ] `arch-diagram` スキルで、このアプリ自身のアーキ図を作って README に載せる。あわせて、このリポジトリにも `node.yaml` を置き、ダッシュボードに自分自身を表示する

## 3. 拡張 (後回し)

- [ ] `~/.claude/skills` のスキルを Node として取り込む (スキルを GitHub で管理して node.yaml を置く)
- [ ] MCP サーバー (Node の参照・チケットの作成を Claude Code から行う)
- [ ] 表示の追加 (時系列、カンバン、一覧)
- [ ] Asana の接続を PAT から OAuth (Better Auth の genericOAuth) に切り替える
- [ ] GitHub Issues / Linear の TrackerProvider
