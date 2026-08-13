#!/usr/bin/env bash
# 构建 whisper.cpp 的 whisper-server 二进制（macOS arm64），落到 resources/models/whisper-server。
#
# 设计要点（见《离线语音模型加载与运行时方案.md》）：
# - whisper.cpp v1.9.2 官方【不】提供 macOS arm64 预编译 whisper-server，须源码构建。
# - 不下载二进制（macOS arm64 外部二进制会静默 SIGKILL / 签名失效）；
#   改由开发者机器构建后随 Tauri 打包签名（包内签名二进制不受 Gatekeeper 隔离影响）。
# - 克隆到 /tmp（不污染仓库，resources/models 已被 .gitignore 忽略）。
# - 用 make 优先（本机已装），cmake 兜底（自动 brew install）。
# - 产物 strip + ad-hoc codesign，确保本地可直接运行；tauri build 时会整体重签。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="/tmp/whisper-build-src"
OUT="$ROOT_DIR/resources/models/whisper-server"
REPO="https://github.com/ggerganov/whisper.cpp"

mkdir -p "$(dirname "$OUT")"

echo "==> 克隆 whisper.cpp (recursive) 到 $SRC"
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" pull --recurse-submodules 2>&1 | tail -3 || echo "pull 跳过"
else
  git clone --depth 1 --recursive "$REPO" "$SRC" 2>&1 | tail -3
fi

cd "$SRC" || { echo "进入源码目录失败"; exit 1; }

echo "==> 构建 whisper-server"
BIN=""
if command -v make >/dev/null 2>&1; then
  echo "--- make whisper-server ---"
  make whisper-server 2>&1 | tail -8 || echo "make 失败，尝试 cmake"
  [ -x "$SRC/whisper-server" ] && BIN="$SRC/whisper-server"
fi

if [ -z "$BIN" ]; then
  echo "--- fallback: cmake ---"
  if ! command -v cmake >/dev/null 2>&1; then
    echo "安装 cmake (brew)..."
    brew install cmake 2>&1 | tail -3
  fi
  cmake -B build -DWHISPER_SERVER=ON -DCMAKE_BUILD_TYPE=Release . 2>&1 | tail -3
  cmake --build build --config Release --target whisper-server -j"$(sysctl -n hw.ncpu)" 2>&1 | tail -8
  [ -x "$SRC/build/bin/whisper-server" ] && BIN="$SRC/build/bin/whisper-server"
fi

[ -n "$BIN" ] && [ -x "$BIN" ] || { echo "构建失败：未产出 whisper-server"; exit 1; }

echo "==> strip + ad-hoc codesign"
strip "$BIN"
codesign --force --deep --sign - "$BIN" 2>/dev/null || echo "codesign ad-hoc 跳过（无影响，tauri build 会重签）"

cp "$BIN" "$OUT"
echo "==> 完成：$OUT ($(du -h "$OUT" | cut -f1))"
"$OUT" --help 2>&1 | head -3 || echo "（二进制就绪，--help 略）"
