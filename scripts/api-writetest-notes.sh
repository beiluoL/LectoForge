#!/usr/bin/env bash
#
# notes 写路径行为对比（POST / PUT / DELETE + markCaptureProcessed 副作用）
# ============================================================
# 只读快照证明不了写路径，而 notes 的写操作带一个隐式副作用：
# 新建/更新笔记时会把来源收集箱流转成 PROCESSED，但 ARCHIVED 的不动。
# 本脚本在隔离测试库上按固定顺序打一串写请求，把响应与副作用一起落盘，
# 新旧代码各跑一次后 diff 必须为空。
#
# 前置：测试实例已在 API_PORT（默认 8788）运行，且数据已用 seed 脚本重置。
# 用法：bash scripts/api-writetest-notes.sh notes-write-before|notes-write-after
set -u

LABEL="${1:-notes-write-after}"
OUT=".refactor-baseline/$LABEL"
PORT="${API_PORT:-8788}"
BASE="http://127.0.0.1:$PORT/api/workbench"
mkdir -p "$OUT"

# 时间戳每次运行必然不同，属预期噪声：统一替换成 <TS> 后再比对
norm() {
  sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z/<TS>/g'
}

req() {
  local name="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s --max-time 8 -X "$method" "$BASE/$path" -w $'\n__STATUS__%{http_code}')
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi
  local raw status payload
  raw=$(curl "${args[@]}" 2>/dev/null || true)
  status="${raw##*__STATUS__}"
  payload="${raw%$'\n'__STATUS__*}"
  if command -v jq >/dev/null 2>&1 && printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
    payload=$(printf '%s' "$payload" | jq -S .)
  fi
  { printf 'HTTP %s\n' "$status"; printf '%s\n' "$payload"; } | norm > "$OUT/$name.txt"
}

# 1) 缺 title → 400
req 01_create_no_title POST notes '{"cueColumn":"x"}'
# 2) 关联 INBOX 收集箱 → 该 capture 应被流转成 PROCESSED
req 02_create_with_inbox_capture POST notes '{"title":"新建A","captureId":1,"tags":"x,y","mastery":3,"noteColumn":"引用 [[Raft 共识]]"}'
# 3) 关联 ARCHIVED 收集箱 → 已归档的不许被改回 PROCESSED
req 03_create_with_archived_capture POST notes '{"title":"新建B","captureId":2,"summaryColumn":"S"}'
# 4) 只给必填字段，其余走默认值
req 04_create_minimal POST notes '{"title":"新建C"}'
# 5) 副作用核对：capture 1 应变 PROCESSED，capture 2 仍为 ARCHIVED
req 05_captures_after_create GET captures ''
# 8) 更新：部分字段 + 关联 INBOX 之外的 capture
req 08_update_partial PUT notes/1 '{"mastery":42,"summaryColumn":"补上总结"}'
# 9) 更新时显式传 null 的字段应保留原值（原实现用 !== undefined 判定）
req 09_update_null_capture PUT notes/1 '{"captureId":null,"title":null}'
# 10) 更新不存在的 → 404
req 10_update_404 PUT notes/999999 '{"title":"x"}'
# 11) 删除 → 204
req 11_delete_ok DELETE notes/9 ''
# 12) 删除不存在的 → 原实现同样返回 204（不做存在性校验）
req 12_delete_missing DELETE notes/999999 ''
# 13) 终态列表
req 13_final_list GET notes ''
req 14_final_tags GET notes/tags ''

echo "✅ notes 写路径用例完成 [$LABEL] → $OUT/"
