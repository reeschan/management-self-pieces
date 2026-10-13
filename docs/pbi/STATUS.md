Codex: 利用上限 (2026-10-14 03:51 まで)。以降の PBI では codex を飛ばす
opencode: fnm のグローバル (/c/Users/owner/AppData/Roaming/fnm/node-versions/v26.8.1/installation) にある。PATH に足して使う (v1.19.0)
--skip 候補 (v11): agy (headless でコマンドが自動拒否される)。opencode は v10 以降 fnm の Node のグローバルを PATH に足して探す (runners.md)。Codex は 2026-10-14 03:51 まで上限だった
Antigravity: 使用不可 (2026-10-13 22:5x。headless でコマンドが自動拒否され、ファイルだけの PBI でも作業が進まない。許可ルールはリポジトリ外なので足していない)。このセッションの残りの PBI では agy を飛ばす

# STATUS

| PBI | モデル | 状態 | 差し戻し | 昇格 | 続行指示 | メモ |
|---|---|---|---|---|---|---|
| PBI-001 | sonnet | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。typecheck に next typegen を追加 (PBI の不備) |
| PBI-002 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-003 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。cacheComponents のため force-static を外した |
| PBI-004 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-005 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。auth-schema は手書き |
| PBI-006 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。instant=false + connection() |
| PBI-007 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-008 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。仕様の穴を PBI-017 で修正 |
| PBI-009 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-010 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-011 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-012 | sonnet | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。再起動の回避策は PBI-018 で解消 |
| PBI-013 | sonnet | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-014 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。許可リスト確認の漏れを PBI-019 で修正 |
| PBI-015 | sonnet | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-016 | haiku | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-017 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-018 | sonnet | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-019 | opus | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-040 | codex high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。typecheck は .next/dev の古い生成物で落ちる (PBI-048 で mcp/route.ts ができれば解消)。.next/dev を除いた tsc は通る |
| PBI-041 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | pnpm add が要るので agy を飛ばした (agy は headless でコマンドを自動拒否する)。一発合格 (typecheck の既知の環境要因は .next/dev を片付けて解消) |
| PBI-042 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | agy は pnpm db:generate のコマンド許可が無く作業できず、agent に切り替え。一発合格。typecheck は PBI-040 と同じ環境要因 |
| PBI-043 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | agy はコマンドを自動拒否して作業なし → agent。一発合格 |
| PBI-044 | codex high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 (検証はオーケストレーターが実行) |
| PBI-045 | codex high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。Codex のサンドボックスは node_modules を EPERM で読めず検証できなかった (オーケストレーターの再実行で全 pass) |
| PBI-046 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | agy 使用不可のため agent。一発合格。仕様より厳しく、http(s) 以外の Origin と Host 無しも拒否 |
| PBI-047 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | agy 使用不可のため agent。一発合格。initialize なしで tools/call が通ることを確認 |
| PBI-048 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | agy 使用不可のため agent。一発合格。検証コマンド 2 は二重引用符だと Git Bash で grep が誤る (検証コマンドの不備) |
| PBI-049 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | agy 使用不可のため agent。一発合格 |
| PBI-050 | codex high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | 一発合格。Codex は EPERM で typecheck/build を確かめられず、オーケストレーターが実行。検証コマンド 1 は Git Bash のパス変換で 0 になる (MSYS_NO_PATHCONV=1 で 1) |
| PBI-051 | codex medium（haiku 相当） | 完了 | 0/2 | 0/1 | 0/2 | opencode が PATH に無く (command not found) codex に切り替え。一発合格。登録例の二重引用符でトークンが設定ファイルに展開される問題 (PBI-050 の書き方由来) を PBI-052 で直す |
| PBI-052 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | 登録コマンドの例でトークンが展開されないよう引用符を直す (画面と SETUP.md)。一発合格。検証コマンド 1 は範囲外の行に当たる不備があり、オーケストレーターが直した |
| PBI-060 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格 |
| PBI-061 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格 |
| PBI-062 | codex high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-063 | codex high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-064 | agent sonnet high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | Codex が利用上限で途中終了 (task-cache.ts と service.ts は書けたがテストが無い)。オーケストレーターが誤って完了と記録したのを取り消し、agent sonnet で続きを行う。合格 (Codex が途中で止まり、agent sonnet が仕上げ) |
| PBI-065 | agent opus（opus 相当） | 完了 | 1/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格。差し戻し 1: アプリのコメントを Owner のコメントと取り違える不具合 (PAT の作成者が持ち主のため) |
| PBI-066 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格 |
| PBI-067 | codex high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | 一発合格 |
| PBI-068 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格。tools/list の既存テストの期待値変更は PBI の矛盾によるもので了承 |
| PBI-069 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格 |
| PBI-070 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格 |
| PBI-071 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格 |
| PBI-072 | agent sonnet high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | Codex が利用上限のため agent。一発合格 |
| PBI-073 | agent sonnet high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | Codex が利用上限のため agent。一発合格 |
| PBI-074 | agent sonnet high（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | Codex が利用上限のため agent。一発合格 |
| PBI-075 | agent opus（opus 相当） | 完了 | 0/2 | 0/1 | 0/2 | route 先頭の agy は使用不可のため agent。一発合格。検証コマンド 3・4 の不具合 (オーケストレーターの誤り) を直した |
| PBI-076 | agent haiku max（haiku 相当） | 完了 | 0/2 | 0/1 | 0/2 | opencode と Codex が使えないため agent。一発合格 |
| PBI-077 | opencode deepseek-v4.1-flash（sonnet 相当） | 完了 | 0/2 | 0/1 | 0/2 | v11 で起票。承認済み (2026-10-14「作業の続きどうぞ」)。一発合格 (opencode を fnm のグローバルから起動) |
