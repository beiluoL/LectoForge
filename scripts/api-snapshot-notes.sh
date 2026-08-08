#!/usr/bin/env bash
#
# notes 模块专项契约快照
# ============================================================
# 为什么单独一份：/notes 有 8 个端点、十余条分支（标签云 CTE 双格式、
# 标签精确反查、mastery_lte / has_summary 的 snake+camel 双写法、
# 双链三种写法的反向引用、LIKE 通配符转义、resolve 大小写不敏感……），
# 主快照里那条默认 GET /notes 覆盖不到，必须逐分支比对。
#
# 用法（配合隔离测试库，避免污染真实数据）：
#   1. 起测试实例：tsx src/index.ts --port 8788 --data-dir /tmp/lf-refactor-test
#   2. 灌固定数据（时间戳写死）
#   3. 旧代码跑一次：bash scripts/api-snapshot-notes.sh notes-before
#   4. 新代码跑一次：bash scripts/api-snapshot-notes.sh notes-after
#   5. diff -r .refactor-baseline/notes-before .refactor-baseline/notes-after  → 必须为空
set -u

LABEL="${1:-notes-after}"
BASE_DIR=".refactor-baseline"
OUT="$BASE_DIR/$LABEL"
PORT="${API_PORT:-8788}"
BASE="http://127.0.0.1:$PORT/api/workbench"

mkdir -p "$OUT"

# name|相对路径|查询串(可为空，未编码，由 curl --data-urlencode 处理)
CASES=(
  "list_all|notes|"
  "list_by_capture|notes|captureId=1"
  "list_by_capture_zero|notes|captureId=0"
  "list_by_category|notes|categoryId=1"
  "list_keyword_title|notes|keyword=Vue3"
  "list_keyword_cue|notes|keyword=选举流程"
  "list_keyword_note|notes|keyword=正文"
  "list_keyword_summary|notes|keyword=已闭环"
  "list_keyword_none|notes|keyword=不存在的关键词zzz"
  "list_tag_csv|notes|tag=Vue"
  "list_tag_json|notes|tag=分布式"
  "list_tag_both_formats|notes|tag=前端"
  "list_tag_missing|notes|tag=不存在的标签"
  "list_tag_prefix_trap|notes|tag=算"
  "list_tag_blank|notes|tag="
  "list_mastery_snake|notes|mastery_lte=50"
  "list_mastery_camel|notes|masteryLte=50"
  "list_mastery_zero|notes|mastery_lte=0"
  "list_mastery_dirty|notes|mastery_lte=abc"
  "list_mastery_empty|notes|mastery_lte="
  "list_has_summary_true|notes|has_summary=true"
  "list_has_summary_false|notes|has_summary=false"
  "list_has_summary_one|notes|hasSummary=1"
  "list_has_summary_junk|notes|has_summary=yes"
  "list_has_summary_empty|notes|has_summary="
  "list_combo|notes|categoryId=1&mastery_lte=60&has_summary=false"
  "tags_cloud|notes/tags|"
  "resolve_plain|notes/resolve|title=Raft 共识"
  "resolve_case_insensitive|notes/resolve|title=VUE3 响应式原理"
  "resolve_alias|notes/resolve|title=Raft 共识|别名"
  "resolve_anchor|notes/resolve|title=Raft 共识#小节"
  "resolve_missing|notes/resolve|title=查无此篇"
  "resolve_blank|notes/resolve|title="
  "resolve_absent_param|notes/resolve|"
  "backlinks_1|notes/backlinks/1|"
  "backlinks_2|notes/backlinks/2|"
  "backlinks_wildcard_title|notes/backlinks/3|"
  "backlinks_none|notes/backlinks/6|"
  "backlinks_404|notes/backlinks/999999|"
  "backlinks_nan|notes/backlinks/abc|"
  "detail_1|notes/1|"
  "detail_5|notes/5|"
  "detail_404|notes/999999|"
)

ok=0
for entry in "${CASES[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  path="${rest%%|*}"
  query="${rest#*|}"

  args=(-s --max-time 8 -G "$BASE/$path")
  if [ -n "$query" ]; then
    # 用 & 拆多参数；每个参数走 --data-urlencode，中文与 % _ # | 都能安全编码
    IFS='&' read -r -a kvs <<< "$query"
    for kv in "${kvs[@]}"; do
      args+=(--data-urlencode "$kv")
    done
  fi
  # -w 附带 HTTP 状态码，404/400 这类错误分支也要逐一比对
  body=$(curl "${args[@]}" -w $'\n__STATUS__%{http_code}' 2>/dev/null || true)
  status="${body##*__STATUS__}"
  payload="${body%$'\n'__STATUS__*}"

  if command -v jq >/dev/null 2>&1 && printf '%s' "$payload" | jq -e . >/dev/null 2>&1; then
    payload=$(printf '%s' "$payload" | jq -S .)
  fi
  { printf 'HTTP %s\n' "$status"; printf '%s\n' "$payload"; } > "$OUT/$name.txt"
  ok=$((ok + 1))
done

echo "✅ notes 专项快照完成 [$LABEL]：$ok 个用例 → $OUT/"
