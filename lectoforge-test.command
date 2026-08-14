#!/bin/bash
# ============================================================
#  LectoForge 一键测试脚本
#  双击本文件即可：自动配置 Node 24 环境 → 启动开发环境(tauri dev)
#  → 自动打开应用窗口 → 跑冒烟测试 → 保持运行供你手动测试。
#  需要停止时按 Ctrl+C 即可。
# ============================================================
set -e

# 进入本脚本所在目录（兼容从 Finder 双击，此时 cwd 默认是用户家目录）
cd "$(dirname "$0")"

# 统一使用 Node 24（项目硬性要求，避免 better-sqlite3 ABI 不匹配导致白屏）
export PATH="/Users/beiluo/.nvm/versions/node/v24.16.0/bin:$PATH"
# 部分原生依赖编译时需要下载 Node 头文件，旧 taobao 源证书已失效，指向可用的 npmmirror 源
export npm_config_disturl="https://registry.npmmirror.com/dist"

echo "🟢 Node 版本: $(node -v)"

# 清理可能残留的旧进程，避免端口(5173/8787)被占用
echo "🧹 清理残留进程..."
pkill -f "tauri dev" 2>/dev/null || true
pkill -f "cargo run" 2>/dev/null || true
pkill -f "tsx watch" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 2

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
echo "🎉 开发环境已启动，应用窗口应该已经弹出。"
echo "   现在就可以在界面里测试（例如 AI 助手对话）。"
echo "   测试结束后按 Ctrl+C 停止；停止后本终端窗口可关闭。"
echo "   （开发日志实时写入: $LOG）"
echo ""

# 保持前台运行，方便查看实时日志；Ctrl+C 会连同 tauri 一起停止
wait "$DEV_PID"
