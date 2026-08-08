#!/usr/bin/env bash
#
# LectoForge 重构契约快照脚本
# ============================================================
# 用途：在重构「前 / 后」各跑一次，对比后端只读端点的响应体，
#       证明结构重构没有改动任何业务逻辑（原则一：行为零退化）。
#
# 用法：
#   bash scripts/api-snapshot.sh before   # 重构前录基线 → .refactor-baseline/before/
#   bash scripts/api-snapshot.sh after    # 每批重构后录新值 → .refactor-baseline/after/
#   diff -r .refactor-baseline/before .refactor-baseline/after   # 必须为 空
#
# 前置：后端已在 http://127.0.0.1:<PORT> 运行（npm run dev:api 或宿主拉起）。
#       PORT 可用环境变量 API_PORT 覆盖，默认 8787。
#
# 说明：
#   - 仅覆盖代表性只读 GET 端点（约 20 个），不触碰写操作。
#   - 每个响应用 `jq -S .` 做稳定排序后再落盘，消除 Fastify 与 diff 的键序噪声。
#   - 若某端点本身当前就报错/返回非 JSON，会原样保存，重构后必须「以同样方式」报错才算通过。
#   - 注意：pomodoro/today、dashboard/stats 等含「当天日期」的字段在跨天后会自然漂移，
#     属预期噪声，review 时忽略；captures / notes / categories 等为 DB 稳定值，是核心证据。
set -u

LABEL="${1:-after}"
BASE_DIR=".refactor-baseline"
OUT="$BASE_DIR/$LABEL"
PORT="${API_PORT:-8787}"
HOST="http://127.0.0.1:$PORT"

mkdir -p "$OUT"

# name:path（path 可带查询串）
ENDPOINTS=(
  "health:api/health"
  "wb_overview:api/workbench/overview"
  "wb_captures:api/workbench/captures"
  "wb_captures_inbox:api/workbench/captures?status=INBOX"
  "wb_notes:api/workbench/notes"
  "wb_reviews_old:api/workbench/reviews"
  "wb_stories:api/workbench/stories"
  "wb_palaces:api/workbench/palaces"
  "wb_recall:api/workbench/recall"
  "categories:api/categories"
  "dashboard_stats:api/dashboard/stats"
  "search:api/search?q=test"
  "inbox_list:api/inbox/list"
  "pomodoro_today:api/pomodoro/today"
  "pomodoro_stats:api/pomodoro/stats"
  "pomodoro_config:api/pomodoro/config"
  "reviews_due:api/reviews/due"
  "library_list:api/library/list"
  "mindmaps:api/mindmaps"
  "config_init:api/config/init"
)

ok=0
fail=0
for entry in "${ENDPOINTS[@]}"; do
  name="${entry%%:*}"
  path="${entry#*:}"
  url="$HOST/$path"
  # --max-time 防止某个挂死的端点拖垮整轮；-s 静默
  body=$(curl -s --max-time 8 "$url" 2>/dev/null || true)
  if command -v jq >/dev/null 2>&1 && printf '%s' "$body" | jq -e . >/dev/null 2>&1; then
    normalized=$(printf '%s' "$body" | jq -S .)
    # health 端点的 bootId/pid/uptimeMs 每次重启必然变化（本就是为探测重启而设计），
    # 属预期噪声，归一化掉以免干扰「契约是否漂移」的判断。
    if [ "$name" = "health" ]; then
      normalized=$(printf '%s' "$normalized" | jq 'del(.data.bootId, .data.pid, .data.uptimeMs)')
    fi
    printf '%s' "$normalized" > "$OUT/$name.json"
    ok=$((ok + 1))
  else
    # 非 JSON（错误页 / 空响应 / 超时）→ 原样保存，保留回归证据
    printf '%s' "$body" > "$OUT/$name.json"
    fail=$((fail + 1))
  fi
done

echo "✅ 快照完成 [$LABEL]：$ok 个 JSON 已规范化，$fail 个非 JSON（含错误/超时，均属正常证据）"
echo "   输出目录：$OUT/"
echo "   对比命令：diff -r $BASE_DIR/before $BASE_DIR/after   （应为空）"
