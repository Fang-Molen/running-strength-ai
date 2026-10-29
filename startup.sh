#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
FK_NO_TEST_PLAN=1 FANGKUN_DEEPSEEK_ENABLED=false nohup npm run dev >>/tmp/fangkun-local-preview.log 2>&1 &
