#!/usr/bin/env bash
#
# 侧车打包准备脚本，做两件事：
#
#   1. 把本机 node 二进制复制为 Tauri externalBin 需要的三元组命名
#      （server-aarch64-apple-darwin / server-x86_64-apple-darwin）。
#   2. 生成**仅含生产依赖**的 node_modules 到 src-api/.prod-modules/，
#      供 tauri.conf.json 的 bundle.resources 打包（见下方「为什么要单独产一份」）。
#
# 用法：
#   bash scripts/prepare-bin.sh              # 完整执行（打包前用这个）
#   bash scripts/prepare-bin.sh --skip-deps  # 只更新 node 二进制，跳过依赖裁剪（日常调试用）
#
# ── 为什么要单独产一份依赖树 ────────────────────────────────────────────────
# tauri.conf.json 原先直接把 ../src-api/node_modules 整个打进 .app，
# 而那是**开发态**的依赖树，包含 typescript(23M)、esbuild(20M)、tsx、@types/*，
# 合计约 45M 纯属白搭——侧车跑的是编译好的 dist/index.js，运行期一个都用不上。
#
# 不能直接对 src-api/node_modules 执行 `npm ci --omit=dev`：那会就地删掉 tsx 与
# typescript，开发环境立刻废掉（npm run dev / build 全部失败）。因此改为在
# .prod-modules/ 里独立解析一棵干净的生产依赖树，开发树原封不动。
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/binaries"
API_DIR="$ROOT/src-api"
STAGE_DIR="$API_DIR/.prod-modules"

SKIP_DEPS=0
[ "${1:-}" = "--skip-deps" ] && SKIP_DEPS=1

# ===================== 1. Node 侧车二进制 =====================
mkdir -p "$BIN_DIR"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "未找到 node，请先安装 Node.js (https://nodejs.org)" >&2
  exit 1
fi

# 判定架构三元组
UNAME_M="$(uname -m)"
if [ "$UNAME_M" = "arm64" ]; then
  TRIPLE="aarch64-apple-darwin"
else
  TRIPLE="x86_64-apple-darwin"
fi

DEST="$BIN_DIR/server-$TRIPLE"
cp "$NODE_BIN" "$DEST"
chmod +x "$DEST"
echo "✅ 侧车二进制: $DEST  ($(du -h "$DEST" | cut -f1))"

if [ "$SKIP_DEPS" = "1" ]; then
  echo "⏭  已跳过生产依赖裁剪（--skip-deps）"
  exit 0
fi

# ===================== 2. 生产依赖树 =====================
echo ""
echo "📦 正在生成生产依赖树 → $STAGE_DIR"

BEFORE="$(du -sm "$API_DIR/node_modules" 2>/dev/null | cut -f1 || echo 0)"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp "$API_DIR/package.json" "$STAGE_DIR/"
[ -f "$API_DIR/package-lock.json" ] && cp "$API_DIR/package-lock.json" "$STAGE_DIR/"

pushd "$STAGE_DIR" >/dev/null
# better-sqlite3 是原生模块，必须允许运行 install 脚本（下载 prebuild 或本地编译），
# 所以这里绝不能加 --ignore-scripts，否则打出来的包一启动就报
# "Could not locate the bindings file"。
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi
popd >/dev/null

# ── 2.1 精简 better-sqlite3：只留运行期真正加载的 .node 与 lib ──
# build/ 里 16M 绝大部分是 node-gyp 的中间产物（obj.target/*.o、Makefile、
# 静态库），deps/ 是 9.5M 的 sqlite3 C 源码 tarball，只在**编译时**需要。
# 运行期 require('better-sqlite3') 只加载 lib/*.js + build/Release/better_sqlite3.node。
BS3="$STAGE_DIR/node_modules/better-sqlite3"
if [ -d "$BS3" ]; then
  NODE_FILE="$BS3/build/Release/better_sqlite3.node"
  if [ -f "$NODE_FILE" ]; then
    TMP_NODE="$(mktemp -d)/better_sqlite3.node"
    cp "$NODE_FILE" "$TMP_NODE"
    rm -rf "$BS3/build" "$BS3/deps" "$BS3/src" "$BS3/binding.gyp"
    mkdir -p "$BS3/build/Release"
    cp "$TMP_NODE" "$NODE_FILE"
    echo "   ├─ better-sqlite3 已精简（保留 build/Release/better_sqlite3.node）"
  else
    echo "   ├─ ⚠️  未找到 better_sqlite3.node，跳过精简（请检查原生模块是否编译成功）" >&2
  fi
fi

# ── 2.2 通用清理：文档、类型声明、测试与源码映射 ──
# .d.ts 只服务于编译期，dist 已经编好；.map 只服务于调试；
# test/ 与 docs/ 更是纯粹的搭车体积。运行期一律不读。
find "$STAGE_DIR/node_modules" \
  \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \
     -o -name '*.md' -o -name '*.markdown' -o -name 'LICENSE*' -o -name 'AUTHORS*' \
     -o -name '.npmignore' -o -name '.editorconfig' -o -name '*.flow' \) \
  -type f -delete 2>/dev/null || true

find "$STAGE_DIR/node_modules" \
  \( -name 'test' -o -name 'tests' -o -name '__tests__' -o -name 'docs' \
     -o -name 'example' -o -name 'examples' -o -name '.github' -o -name 'man' \) \
  -type d -prune -exec rm -rf {} + 2>/dev/null || true

# @types/* 整包移除：即便声明在 devDependencies，某些包会把它们提为传递依赖装进来
rm -rf "$STAGE_DIR/node_modules/@types" 2>/dev/null || true

AFTER="$(du -sm "$STAGE_DIR/node_modules" | cut -f1)"
echo "   └─ 完成"
echo ""
echo "📊 侧车依赖体积：${BEFORE}M（开发树） → ${AFTER}M（打包树），节省约 $((BEFORE - AFTER))M"
echo ""
echo "⚠️  记得确认 src-tauri/tauri.conf.json 的 resources 指向 .prod-modules/node_modules："
echo '      "../src-api/.prod-modules/node_modules": "api/node_modules"'
