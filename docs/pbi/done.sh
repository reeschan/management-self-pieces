#!/bin/sh
# usage: done.sh <PBI番号3桁> <モデル> <結果> <メモ> <コミットメッセージ>
set -e
n=$1; m=$2; r=$3; memo=$4; msg=$5
sed -i "s/^| PBI-$n | [a-z]* | [^|]* |\(.*\)| [^|]* |$/| PBI-$n | $m | 完了 |\1| $memo |/" docs/pbi/STATUS.md
python -c "import json,datetime,sys;open('docs/pbi/jev-log.jsonl','a',encoding='utf-8').write(json.dumps({'ts':datetime.datetime.now().isoformat(),'pbi':'PBI-'+sys.argv[1],'gate':'report','answer':None,'action':'Jev 不可のためオーケストレーターが仕分け: done_with_evidence','result':sys.argv[2]},ensure_ascii=False)+'\n')" "$n" "$r"
git add -A
git commit -qm "$msg"
git log --oneline -1
