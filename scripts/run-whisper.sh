#!/usr/bin/env bash
# =============================================================================
# LectoForge 本地 Whisper STT 启动脚本（开发期 / 未打包场景用）
#
# 模拟面试的语音识别走本地 whisper-server(:8080)，语音不出本机。
# 生产构建由 src-tauri/src/lib.rs 的 WhisperSidecar 自动拉起（需二进制+模型随包）；
# 本脚本用于开发期或想手动掌控时单独启动 whisper-server。
#
# 前置：
#   1) 编译/下载 whisper.cpp 的 whisper-server 可执行文件，命名 whisper-server 放到 PATH 或本脚本同目录。
#      - 源码：https://github.com/ggerganov/whisper.cpp  （make whisper-server）
#   2) 下载一个 ggml 模型，例如 ggml-base.bin（约 140MB）：
#      https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-base.bin
#
# 用法：
#   bash scripts/run-whisper.sh                       # 用默认模型 models/ggml-base.bin
#   WHISPER_MODEL=/path/ggml-small.bin bash scripts/run-whisper.sh
#   WHISPER_BIN=/opt/whisper-server PORT=8080 bash scripts/run-whisper.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BIN="${WHISPER_BIN:-${WHISPER_BIN:-$(command -v whisper-server || true)}}"
PORT="${PORT:-8080}"
THREADS="${THREADS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 8)}"
MODEL="${WHISPER_MODEL:-$ROOT_DIR/resources/models/ggml-base.bin}"

if [[ -z "$BIN" || ! -x "$BIN" ]]; then
  echo "[run-whisper] 未找到 whisper-server 可执行文件。" >&2
  echo "  请先编译 whisper.cpp (make whisper-server) 并放到 PATH，" >&2
  echo "  或用 WHISPER_BIN=/path/whisper-server 指定。" >&2
  exit 1
fi

if [[ ! -f "$MODEL" ]]; then
  echo "[run-whisper] 未找到 whisper 模型: $MODEL" >&2
  echo "  请下载 ggml-base.bin 放到该路径，或用 WHISPER_MODEL=/path/xx.bin 指定。" >&2
  exit 1
fi

echo "[run-whisper] 启动 whisper-server: $BIN -m $MODEL --port $PORT -t $THREADS"
exec "$BIN" -m "$MODEL" --port "$PORT" -t "$THREADS"
