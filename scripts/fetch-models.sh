#!/usr/bin/env bash
# =============================================================================
# LectoForge 离线模型资源拉取脚本
#
# 用途：把「拍照/图片/OCR/语音转文字」所需的离线模型与运行文件下载到
#       resources/models/，随 Tauri 打包进 .app（tauri.conf.json 的 bundle.resources
#       已映射 ../resources/models -> Resources/models）。
#
# 设计原则：
#   - 全部本地离线运行，不依赖任何云 API / CDN（运行期零外网）。
#   - 模型文件体积大（合计约 100~200MB），**不进 git**（见 .gitignore 的
#     resources/models/），改由本脚本在构建前拉取。CI / 新机器执行一次即可。
#   - tesseract.js 运行文件与语言包、whisper ggml 模型均来自稳定官方源；
#     whisper.wasm 为 whisper.cpp 的 emscripten 构建产物，需本地构建（见下）。
#
# 用法：
#   bash scripts/fetch-models.sh            # 拉取全部
#   WHISPER_WASM_URL=https://... bash scripts/fetch-models.sh   # 自定义 wasm 源
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="$ROOT/resources/models"
TES="$MODELS/tesseract"
WSP="$MODELS/whisper"
mkdir -p "$TES" "$WSP"

# 断点续传 + 失败时保留已有文件（已经下载过的不再重复拉，节省时间）
dl() {
  local url="$1" out="$2"
  if [[ -s "$out" ]]; then
    echo "  · 已存在，跳过: $(basename "$out")"
    return 0
  fi
  echo "  ↓ $url"
  curl -fSL --retry 3 --retry-delay 2 -o "$out" "$url" || {
    echo "  [警告] 下载失败: $url（可手动放置到 $out）"
    return 1
  }
}

echo "==> [1/3] tesseract.js 运行文件（worker + wasm core）"
dl "https://unpkg.com/tesseract.js@5/dist/worker.min.js"                "$TES/worker.min.js"
dl "https://unpkg.com/tesseract.js-core/tesseract-core.wasm.js"         "$TES/tesseract-core.wasm.js"
dl "https://unpkg.com/tesseract.js-core/tesseract-core.wasm"            "$TES/tesseract-core.wasm"
dl "https://unpkg.com/tesseract.js-core/tesseract-core-simd.wasm.js"    "$TES/tesseract-core-simd.wasm.js"
dl "https://unpkg.com/tesseract.js-core/tesseract-core-simd.wasm"       "$TES/tesseract-core-simd.wasm"

echo "==> [2/3] tesseract 语言包（chi_sim 简体中文 + eng 英文）"
dl "https://github.com/naptha/tessdata_fast/raw/master/chi_sim.traineddata.gz" "$TES/chi_sim.traineddata.gz"
dl "https://github.com/naptha/tessdata_fast/raw/master/eng.traineddata.gz"    "$TES/eng.traineddata.gz"

echo "==> [3/3] whisper 模型（ggml 量化，中文推荐 base / small）"
# ggerganov 官方在 HuggingFace 托管 ggml 系列模型，链接稳定。
# base-q5_0 ≈ 75MB（快、够用）；若中文识别要求更高，改用 ggml-small-q5_0.bin（≈ 150MB）。
dl "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_0.bin" "$WSP/ggml-base-q5_0.bin"

echo "==> whisper wasm（whisper.cpp emscripten 构建）"
# whisper.wasm 是构建产物，官方不提供稳定下载链接，需本地用 emscripten 构建：
#   git clone https://github.com/ggerganov/whisper.cpp
#   cd whisper.cpp && emmake make -C examples/whisper.wasm
# 构建产物 examples/whisper.wasm/whisper.wasm 与 whisper.js 复制到 $WSP 即可。
# 若你已有可下载镜像，可设环境变量覆盖：WHISPER_WASM_URL / WHISPER_JS_URL
if [[ -n "${WHISPER_WASM_URL:-}" ]]; then
  dl "$WHISPER_WASM_URL" "$WSP/whisper.wasm"
fi
if [[ -n "${WHISPER_JS_URL:-}" ]]; then
  dl "$WHISPER_JS_URL" "$WSP/whisper.js"
fi
if [[ ! -s "$WSP/whisper.wasm" ]]; then
  echo "  [提示] whisper.wasm 尚未就绪。语音转文字功能需它才能运行，请按上面"
  echo "        说明用 emscripten 构建 whisper.cpp 的 examples/whisper.wasm，并把"
  echo "        whisper.wasm 与 whisper.js 放到: $WSP"
  echo "        （OCR 与拍照/附件上传不依赖它，可独立使用。）"
fi

echo ""
echo "✅ 模型目录就绪: $MODELS"
echo "   tesseract: $(ls -lh "$TES" | wc -l | tr -d ' ') 个文件"
echo "   whisper:   $(ls -lh "$WSP" | wc -l | tr -d ' ') 个文件（whisper.wasm 缺失则语音功能暂不可用）"
