#!/bin/sh
# Every test, one after another (one Firefox at a time). Logs go to E:/postbarrel/tmp/tabstead-*.log
export TEMP=E:/postbarrel/tmp TMP=E:/postbarrel/tmp
cd "$(dirname "$0")/.." || exit 1
node build.mjs || exit 1
for t in model firefox sidebar features sleep restart startup stress; do
  timeout 3000 node test/$t.mjs > E:/postbarrel/tmp/tabstead-$t.log 2>&1
  echo "$t: exit $? / $(grep -E '^(all|✘|[0-9]+ of)' E:/postbarrel/tmp/tabstead-$t.log | tail -1)"
done
