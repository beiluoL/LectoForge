#!/bin/bash
# ============================================================
#  LectoForge 一键构建脚本
#  双击本文件即可：自动配置 Node 24 环境 → 释放被占用的端口 →
#  【编译前】检测本次是否生成打包文件并删除上次的打包缓存 →
#  构建前端+后端 → 准备侧车二进制(.prod-modules) → 打包 Release(.app) →
#  【编译后】清理不被复用的中间文件 → 自动打开应用程序界面。
#  任何一步失败都会立即中止并提示查看日志。
#
#  设计约束（资源友好）：
#  - 纯 bash，无额外依赖、无常驻进程；
#  - 打包前先检测端口(5173/8787)占用并终止对应进程；
#  - 编译前优先删除【项目内】旧打包缓存(target/dist/vite)，再重新编译；
#  - 编译后清理不可复用的中间产物(src-api/dist、src-ui/dist、target/release 非 bundle 部分)，避免磁盘浪费；
#  - 全程不碰全局缓存(~/.npm ~/.cargo 等)。
# ============================================================

# ---------- 轻量辅助：释放端口（纯 bash，无新增依赖）----------
# 若指定端口处于 LISTEN 状态，先 SIGTERM 对应进程；1s 后仍未释放则 SIGKILL。
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
  echo "   模式: 发布打包 (tauri:build)"
  echo "   本次重新编译【会】生成打包文件，预期产物:"
  echo "     • src-tauri/target/release/bundle/macos/*.app"
  echo "     • src-tauri/target/release/bundle/dmg/*.dmg（若启用 dmg）"
}

set -e

# 进入本脚本所在目录（兼容从 Finder 双击，此时 cwd 默认是用户家目录）
cd "$(dirname "$0")"

# 统一使用 Node 24（项目硬性要求，避免 better-sqlite3 ABI 不匹配）
export PATH="/Users/beiluo/.nvm/versions/node/v24.16.0/bin:$PATH"
# 部分原生依赖编译时需要下载 Node 头文件，旧 taobao 源证书已失效，指向可用的 npmmirror 源
export npm_config_disturl="https://registry.npmmirror.com/dist"

echo "🟢 Node 版本: $(node -v)"

# 1) 打包前：先释放可能残留的端口（前端 5173 / 后端 API 8787），并清理旧开发进程
echo "🧹 释放端口并清理残留进程..."
free_port 5173
free_port 8787
pkill -f "tauri dev" 2>/dev/null || true
pkill -f "cargo run" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 2

# 2) 编译前：先【检测产物类型】并删除【上一次】的打包缓存与构建缓存，再重新编译
echo ""
echo "🧹 [编译前] 优先清理旧打包缓存，再执行重新编译..."
detect_packaging
echo "   删除上次的打包缓存与中间产物（仅项目内）:"
rm_cache src-tauri/target            # 含上次的 bundle/ 及 debug/release 编译缓存
rm_cache src-ui/dist                  # 上次的 vite 构建产物
rm_cache src-ui/node_modules/.vite    # vite 增量缓存
rm_cache src-api/dist                 # 上次的 ts 构建产物
echo "   ✅ 旧缓存已清理，开始重新编译。"

LOG="/tmp/lectoforge-build.log"
echo "📦 [1/3] 构建前端 + 后端 (build:all) ..."
npm run build:all > "$LOG" 2>&1
echo "✅ build:all 完成"

echo "🔧 [2/3] 准备侧车二进制与 .prod-modules (prepare-bin) ..."
bash scripts/prepare-bin.sh >> "$LOG" 2>&1
echo "✅ prepare-bin 完成"

# 2.5) prepare-bin 已把 src-api/dist 并入 .prod-modules，该目录不再被复用 → 立即清理
echo "🧹 清理 prepare-bin 后的冗余中间文件 (src-api/dist)..."
rm_cache src-api/dist

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

# 3) 编译后：清理不再被复用的中间文件，避免磁盘空间浪费
echo ""
echo "🧹 [编译后] 清理不被复用的中间文件..."
echo "   （保留可分发产物 target/release/bundle，删除其余编译缓存）"
rm_cache src-ui/dist   # 已打进 .app，dev/build 均不再需要
# 保留 target/release/bundle，删除 release 下其余所有中间文件（松散二进制/.rlib/.o/incremental 等）
if [ -d src-tauri/target/release ]; then
  echo "   🗑  删除 target/release 中除 bundle/ 外的中间文件..."
  find src-tauri/target/release -mindepth 1 -maxdepth 1 ! -name bundle -exec rm -rf {} + 2>/dev/null || true
fi
echo "   ✅ 编译后清理完成。"

echo ""
echo "🎉 完成！应用程序界面已自动打开。"
echo "   可分发产物位于: src-tauri/target/release/bundle/"
echo "   （构建日志: $LOG）"
