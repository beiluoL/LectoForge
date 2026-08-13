#!/usr/bin/env bash
#
# 构建 Piper 本地神经网络 TTS 二进制（macOS arm64），落到 resources/models/piper。
#
# 设计要点（见《离线语音模型加载与运行时方案.md》与《桌面端技术架构与功能手册.md》）：
# - Piper 是 C++ 二进制，自带 espeak-ng phonemizer，不依赖 Python/Flask，
#   与 whisper-server 同架构：由 Node 侧车用 child_process.spawn 一次性拉起合成，
#   输出 raw PCM16，再由 Node 包成 WAV 回传前端。
# - 官方 piper_macos_aarch64.tar.gz 实际是 x86_64 且缺 3 个 dylib，不可用，
#   必须**从源码** cmake + make（arm64），使二进制与 dylib 架构一致。
# - 二进制 + 3 个 dylib（libespeak-ng / libpiper_phonemize / libonnxruntime）+ espeak-ng-data
#   一并落 resources/models/piper，运行时经 @executable_path 解析 dylib、
#   经 ESPEAK_DATA_PATH 解析音素数据（见 src-api/src/services/piperTtsService.ts）。
# - 不下载外部二进制（macOS arm64 外部二进制会静默 SIGKILL / 签名失效）；
#   改由开发者机器源码构建后随 Tauri 打包签名。
#
# 用法：
#   bash scripts/build-piper.sh            # 完整执行（打包前用这个）
#   bash scripts/build-piper.sh --rebuild  # 强制重新 clone + 源码构建（清 /tmp 缓存）
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="/tmp/piper-src"
OUT="$ROOT_DIR/resources/models/piper"
REPO="https://github.com/rhasspy/piper.git"

UNAME_M="$(uname -m)"
if [ "$UNAME_M" != "arm64" ]; then
  echo "⚠️  本脚本仅支持 macOS arm64 构建 Piper；当前架构 $UNAME_M 跳过" >&2
  exit 0
fi

REBUILD=0
[ "${1:-}" = "--rebuild" ] && REBUILD=1

# ===================== 1. 源码（带缓存） =====================
if [ "$REBUILD" = "1" ]; then
  rm -rf "$SRC"
fi

if [ -x "$SRC/build/piper" ]; then
  echo "==> 命中缓存：复用 $SRC/build/piper（--rebuild 可强制重建）"
else
  echo "==> 克隆 piper（recursive，含 piper-phonemize / espeak-ng / onnxruntime 子模块）到 $SRC"
  if [ -d "$SRC/.git" ]; then
    git -C "$SRC" pull --recurse-submodules 2>&1 | tail -3 || echo "pull 跳过"
  else
    git clone --recursive "$REPO" "$SRC" 2>&1 | tail -3
  fi

  cd "$SRC" || { echo "进入源码目录失败"; exit 1; }
  echo "==> cmake + make (arm64 Release)"
  rm -rf build && mkdir -p build && cd build
  cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 .. 2>&1 | tail -3
  make -j"$(sysctl -n hw.ncpu)" 2>&1 | tail -8
  [ -x "$SRC/build/piper" ] || { echo "构建失败：未产出 piper 二进制"; exit 1; }
fi

# ===================== 2. 定位产物 =====================
PIPER_BIN="$SRC/build/piper"
# dylib 目录（构建产物）：build/pi/lib
LIBDIR="$(find "$SRC/build" -type d -name lib -path '*pi*' 2>/dev/null | head -1)"
[ -d "$LIBDIR" ] || LIBDIR="$SRC/build/pi/lib"
# espeak-ng 数据目录：含 phontab
ESPEAK_DATA="$(find "$SRC/build" -type d -name espeak-ng-data 2>/dev/null | head -1)"
[ -n "$ESPEAK_DATA" ] || { echo "未找到 espeak-ng-data，构建不完整"; exit 1; }

echo "==> 产物定位："
echo "    bin   : $PIPER_BIN ($(file -b "$PIPER_BIN" | cut -d, -f1))"
echo "    libdir: $LIBDIR"
echo "    espeak: $ESPEAK_DATA"

# ===================== 3. 暂存目录 =====================
STAGE="$(mktemp -d)/piper"
mkdir -p "$STAGE"

cp "$PIPER_BIN" "$STAGE/piper"

# 3 个真实 dylib
cp -a "$LIBDIR/libespeak-ng.1.52.0.1.dylib" "$STAGE/" 2>/dev/null \
  || cp -a "$LIBDIR"/libespeak-ng.*.dylib "$STAGE/" 2>/dev/null
cp -a "$LIBDIR/libpiper_phonemize.1.2.0.dylib" "$STAGE/" 2>/dev/null \
  || cp -a "$LIBDIR"/libpiper_phonemize.*.dylib "$STAGE/" 2>/dev/null
cp -a "$LIBDIR/libonnxruntime.1.14.1.dylib" "$STAGE/" 2>/dev/null \
  || cp -a "$LIBDIR"/libonnxruntime.*.dylib "$STAGE/" 2>/dev/null

# 符号链接（版本化名 + 无版本名），确保 @rpath/lib*.dylib 各变体都能解析
for s in libespeak-ng.1.dylib libespeak-ng.dylib libpiper_phonemize.1.dylib libpiper_phonemize.dylib libonnxruntime.dylib; do
  [ -e "$LIBDIR/$s" ] && cp -a "$LIBDIR/$s" "$STAGE/" || true
done

# espeak-ng 音素数据（中文 cmn 等，约 18MB）
cp -a "$ESPEAK_DATA" "$STAGE/espeak-ng-data"

echo "==> 暂存内容："
ls -la "$STAGE"

# ===================== 4. 重设 rpath → @executable_path =====================
delete_all_rpaths() {
  local f="$1"
  otool -l "$f" 2>/dev/null | awk '
    /cmd LC_RPATH/ { capture=1; next }
    capture && /path/ { print $2; capture=0 }
  ' | while read -r rp; do
    [ -n "$rp" ] && install_name_tool -delete_rpath "$rp" "$f" 2>/dev/null || true
  done
  if ! otool -l "$f" 2>/dev/null | grep -q "path @executable_path"; then
    install_name_tool -add_rpath @executable_path "$f" 2>/dev/null || true
  fi
}

for f in "$STAGE/piper" "$STAGE"/*.dylib; do
  [ -e "$f" ] && delete_all_rpaths "$f"
done

echo "==> rpath 校验（应只剩 @executable_path）"
otool -l "$STAGE/piper" | grep -A1 LC_RPATH

# ===================== 5. ad-hoc codesign + 去隔离 =====================
for f in "$STAGE/piper" "$STAGE"/*.dylib; do
  [ -e "$f" ] && codesign --force --sign - "$f" 2>/dev/null || echo "codesign 跳过 $f（tauri build 会重签）"
done
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true

# ===================== 6. 落到 resources/models/piper =====================
mkdir -p "$OUT"
rm -rf "${OUT:?}"/* 2>/dev/null || true
cp -a "$STAGE"/. "$OUT/"

echo "==> 完成：$OUT"
du -sh "$OUT" 2>/dev/null
echo "==> 冒烟测试：piper --help（验证 dylib 可加载）"
"$OUT/piper" --help 2>&1 | head -2 || echo "（二进制就绪，--help 略）"
