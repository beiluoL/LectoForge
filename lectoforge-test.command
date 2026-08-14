#!/bin/bash
# ============================================================
#  LectoForge 一键测试脚本
#  双击本文件即可：自动配置 Node 24 环境 → 释放被占用的端口 →
#  【编译前】检测产物类型并清理旧开发缓存 → 启动开发环境(tauri dev) →
#  自动打开应用窗口 → 跑冒烟测试 → 保持运行供你手动测试。
#  测试结束(按 Ctrl+C)后，自动清理不被复用的中间文件。
#
#  设计约束（资源友好）：
#  - 纯 bash，无额外依赖、无常驻进程；
#  - 启动前先检测端口(5173/8787)占用，占用则终止对应进程再重启；
#  - 编译前仅清理 vite 增量缓存(.vite)；src-ui/dist 是 tauri_build 编译期校验的【必需资源】，
#    不可删除（删了会导致 build.rs panic、窗口不弹），缺失时自动构建补齐；
#  - 退出时(Ctrl+C)仅清理 .vite 冗余缓存，保留 src-ui/dist 与 target/debug 以便下次快速启动；
#  - 不碰全局缓存(~/.npm ~/.cargo 等)。
# ============================================================

# ---------- 轻量辅助：释放端口（纯 bash，无新增依赖）----------
free_port() {
  local port="$1"
  local pids
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u)
  if [ -n "$pids" ]; then
    echo "🔌 端口 $port 已被占用，终止进程: $(echo "$pids" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u)
    if [ -n "$pids" ]; then
      echo "   端口 $port 仍未释放，强制终止..."
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
      sleep 1
    fi
  fi
}

# 删除一个缓存目录/文件；存在则报告占用大小并删除，不存在则跳过
rm_cache() {
  local p="$1"
  if [ -e "$p" ]; then
    local s
    s=$(du -sh "$p" 2>/dev/null | cut -f1)
    echo "   🗑  删除 $p (约 $s)"
    rm -rf "$p"
  else
    echo "   ✔  跳过 $p（不存在）"
  fi
}

# 检测本次重新编译是否会生成打包文件，并打印预期产物路径
detect_packaging() {
  echo "🔎 检测本次重新编译产物类型..."
  echo "   模式: 开发模式 (tauri dev)"
  echo "   本次【不会】生成打包文件(.app)，仅重新编译调试产物:"
  echo "     • src-tauri/target/debug （开发与调试用，保留以便增量重编）"
}

# 确保 tauri dev 编译期必需、但可能被误删/全新 clone 时缺失的资源路径存在。
# tauri.conf.json 的 bundle.resources 含 "../src-ui/dist": "web"，build.rs 的
# tauri_build::try_build().unwrap() 会在 tauri dev 阶段校验它必须存在，否则直接 panic：
#   "resource path `../src-ui/dist` doesn't exist" → 编译失败 → 窗口永不弹出。
# 开发模式实际由 vite 实时服务(5173)提供前端，dist 仅用于满足构建期校验，故缺失即补建。
ensure_dev_inputs() {
  if [ ! -d src-ui/dist ]; then
    echo "   🔨 src-ui/dist 缺失，构建前端以满足 tauri_build 资源校验..."
    (cd src-ui && npm run build)
  else
    echo "   ✔  src-ui/dist 存在，跳过构建"
  fi
}

set -e

# 进入本脚本所在目录（兼容从 Finder 双击，此时 cwd 默认是用户家目录）
cd "$(dirname "$0")"

# 统一使用 Node 24（项目硬性要求，避免 better-sqlite3 ABI 不匹配导致白屏）
export PATH="/Users/beiluo/.nvm/versions/node/v24.16.0/bin:$PATH"
# 部分原生依赖编译时需要下载 Node 头文件，旧 taobao 源证书已失效，指向可用的 npmmirror 源
export npm_config_disturl="https://registry.npmmirror.com/dist"

echo "🟢 Node 版本: $(node -v)"

# 1) 启动前：先释放可能残留的端口（前端 5173 / 后端 API 8787），并清理旧开发进程
echo "🧹 释放端口并清理残留进程..."
free_port 5173
free_port 8787
pkill -f "tauri dev" 2>/dev/null || true
pkill -f "cargo run" 2>/dev/null || true
pkill -f "tsx watch" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 2

# 2) 编译前：检测产物类型并清理旧开发缓存（开发模式不打包，只清理不被复用的 vite 增量缓存）
echo ""
echo "🧹 [编译前] 清理旧开发缓存..."
detect_packaging
echo "   清理不被复用的旧缓存（仅项目内）:"
# ⚠️ 注意：src-ui/dist 是 tauri_build 编译期校验的【必需资源】，绝不能删！
#   tauri.conf.json 的 bundle.resources 含 "../src-ui/dist": "web"，build.rs 的
#   tauri_build::try_build().unwrap() 会在 tauri dev 阶段校验它必须存在，
#   删了不重建会直接 panic（"resource path ../src-ui/dist doesn't exist"），窗口永不弹出。
#   开发模式实际由 vite 实时服务(5173)提供前端，dist 仅用于满足构建期校验。
rm_cache src-ui/node_modules/.vite    # 仅删 vite 增量缓存，可安全重建
# 注：target/debug 是调试重编缓存，保留以支撑增量编译（避免因全量重编再次占满磁盘）
if [ "${FRESH:-0}" = "1" ]; then
  echo "   FRESH=1：同时删除 target/debug 进行全量重编"
  rm_cache src-tauri/target/debug
fi
# 确保 tauri_build 校验所需的资源路径存在（缺失则补建，避免 build.rs panic）
ensure_dev_inputs
echo "   ✅ 旧缓存已清理，必需资源已就位，开始启动开发环境。"

# 退出时(Ctrl+C)清理冗余中间文件，避免磁盘浪费
cleanup_on_exit() {
  echo ""
  echo "🧹 [退出] 清理不被复用的中间文件..."
  echo "   ✔  跳过 src-ui/dist（tauri_build 必需资源，保留以便下次直接启动）"
  rm_cache src-ui/node_modules/.vite
  echo "   （保留 target/debug 以便下次增量重编）"
}
trap cleanup_on_exit EXIT

LOG="/tmp/lectoforge-test.log"
echo "🚀 启动开发环境 (tauri dev)，日志: $LOG"

# 后台启动 tauri dev（它会自动编译并弹出应用窗口）
npm run tauri:dev > "$LOG" 2>&1 &
DEV_PID=$!

echo "⏳ 等待应用就绪（前端 Vite + 后端 API on :8787）..."
READY=0
for i in $(seq 1 90); do
  if curl -s -m 2 http://127.0.0.1:8787/api/ai/config >/dev/null 2>&1; then
    READY=1
    break
  fi
  # 若进程已退出，提前失败
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "❌ 开发进程意外退出，请查看日志: $LOG"
    tail -40 "$LOG"
    exit 1
  fi
  sleep 2
done

if [ "$READY" -ne 1 ]; then
  echo "❌ 启动超时（>180s），请查看日志: $LOG"
  tail -40 "$LOG"
  kill "$DEV_PID" 2>/dev/null || true
  exit 1
fi

echo "✅ 后端 API 已就绪 (http://127.0.0.1:8787)"

# 冒烟测试：核心接口连通性
echo "🩺 冒烟测试..."
if curl -s -m 5 http://127.0.0.1:8787/api/ai-assistant/conversations >/dev/null 2>&1; then
  echo "  • 会话列表接口 OK"
else
  echo "  ⚠️  会话列表接口未响应（但应用已启动，可在 UI 中验证）"
fi
if curl -s -m 5 http://127.0.0.1:8787/api/ai/config >/dev/null 2>&1; then
  echo "  • AI 配置接口 OK"
else
  echo "  ⚠️  AI 配置接口未响应"
fi

echo ""
echo "🎉 后端已就绪；Rust 正在编译，应用窗口会在编译完成后自动弹出。"
echo "   现在就可以在界面里测试（例如 AI 助手对话）。"
echo "   测试结束后按 Ctrl+C 停止，脚本会自动清理冗余中间文件。"
echo "   （开发日志实时写入: $LOG）"
echo ""

# 保持运行并监控 Rust 编译结果：一旦编译失败（build.rs panic / cargo error）立即给出
# 明确报错，而不是静默退出让用户误以为“启动成功但窗口没弹”。正常情况会一直阻塞到 Ctrl+C。
while kill -0 "$DEV_PID" 2>/dev/null; do
  if grep -qiE "panicked at build.rs|build failed, waiting|error: could not compile" "$LOG" 2>/dev/null; then
    echo ""
    echo "❌ Rust 编译失败，窗口无法弹出。tauri_build / cargo 关键错误："
    grep -iE "panicked at|resource path|doesn't exist|build failed|could not compile" "$LOG" 2>/dev/null | tail -10
    echo "   完整日志: $LOG"
    break
  fi
  sleep 3
done
