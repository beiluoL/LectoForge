#!/bin/bash
# ============================================================
#  LectoForge 一键构建脚本
#  双击本文件即可：自动配置 Node 24 环境 → 构建前端+后端 →
#  准备侧车二进制(.prod-modules) → 打包 Release(.app) →
#  构建成功后自动打开应用程序界面。
#  任何一步失败都会立即中止并提示查看日志。
# ============================================================
set -e

# 进入本脚本所在目录（兼容从 Finder 双击）
cd "$(dirname "$0")"

# 统一使用 Node 24（项目硬性要求，避免 better-sqlite3 ABI 不匹配）
export PATH="/Users/beiluo/.nvm/versions/node/v24.16.0/bin:$PATH"
export npm_config_disturl="https://registry.npmmirror.com/dist"

echo "🟢 Node 版本: $(node -v)"

# 清理可能残留的开发进程，避免端口/构建冲突
echo "🧹 清理残留进程..."
pkill -f "tauri dev" 2>/dev/null || true
pkill -f "cargo run" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 2

LOG="/tmp/lectoforge-build.log"
echo "📦 [1/3] 构建前端 + 后端 (build:all) ..."
npm run build:all > "$LOG" 2>&1
echo "✅ build:all 完成"

echo "🔧 [2/3] 准备侧车二进制与 .prod-modules (prepare-bin) ..."
bash scripts/prepare-bin.sh >> "$LOG" 2>&1
echo "✅ prepare-bin 完成"

echo "🏗️  [3/3] 打包 Release (.app) ... （Rust 编译较慢，请耐心等待）"
npm run tauri:build >> "$LOG" 2>&1
echo "✅ tauri:build 完成"

# 自动定位生成的 .app（兼容中文产品名）
APP=$(find src-tauri/target/release/bundle/macos -maxdepth 1 -name "*.app" 2>/dev/null | head -1)
if [ -z "$APP" ]; then
  echo "❌ 未找到打包产物 .app，请查看日志: $LOG"
  exit 1
fi

echo "🚀 构建成功，正在打开应用: $APP"
open "$APP"

echo ""
echo "🎉 完成！应用程序界面已自动打开。"
echo "   （构建日志: $LOG）"
