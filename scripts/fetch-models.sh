#!/usr/bin/env bash
# =============================================================================
# LectoForge 离线模型资源准备脚本
#
# 用途：准备「拍照/图片/OCR/语音转文字」所需的离线资源。
#   - tesseract.js 运行文件 + 语言包：直接下载，随包内置（resources/models/tesseract/）。
#   - whisper-server 原生 STT 二进制：macOS 无官方预编译包，必须从 whisper.cpp 源码
#     构建，产物放到 resources/models/whisper-server，随 Tauri 打包并被签名（运行期
#     包内签名二进制不受 Gatekeeper 隔离，规避 macOS arm64 静默 SIGKILL）。
#   - whisper 模型权重（ggml-*.bin）：【运行时按需下载】到用户可写 dataDir，不随包
#     内置（见设计文档《离线语音模型加载与运行时方案.md》）。本脚本不再预下载模型。
#   - whisper.wasm（WASM 兜底路径）：需本地用 emscripten 构建，见下。
#
# 设计原则：
#   - 应用运行期零外网依赖（模型已下载后完全离线）。
#   - 模型权重体积大（30~180MB），不进 git（见 .gitignore 的 resources/models/）。
#   - 任何单步失败都不阻断其它步骤（best-effort），并给出明确提示。
#
# 用法：
#   bash scripts/fetch-models.sh                 # 准备 tesseract + 检查 whisper 资源
#   WHISPER_BUILD=1 bash scripts/fetch-models.sh # 额外尝试从源码构建 whisper-server
# =============================================================================
set -uo pipefail   # 注意：不用 -e，单步失败不中断整脚本（避免一处 404 导致后续全停）

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="$ROOT/resources/models"
TES="$MODELS/tesseract"
WSP="$MODELS/whisper"
WSB="$MODELS/whisper-server"   # 原生 STT 二进制（由 whisper.cpp 源码构建）
mkdir -p "$TES" "$WSP"

# 断点续传 + 失败时保留已有文件（已经下载过的不再重复拉，节省时间）
dl() {
  local url="$1"
  local out="$2"
  if [[ -z "$url" ]]; then
    echo "  [警告] 下载 URL 为空，跳过"
    return 1
  fi
  if [[ -s "$out" ]]; then
    echo "  · 已存在，跳过: $(basename "$out")"
    return 0
  fi
  echo "  ↓ $url"
  if curl -fSL --retry 3 --retry-delay 2 --retry-all-errors --max-time 120 -o "$out" "$url"; then
    return 0
  else
    echo "  [警告] 下载失败: $url（可手动放置到 $out）"
    return 1
  fi
}

# 多镜像回退下载：依次尝试多个 URL，任一成功即落盘；全部失败才告警。
# 用法：dl_any <out> <url1> [url2 ...]
dl_any() {
  local out="$1"; shift
  if [[ -s "$out" ]]; then
    echo "  · 已存在，跳过: $(basename "$out")"
    return 0
  fi
  local url
  for url in "$@"; do
    [[ -z "$url" ]] && continue
    echo "  ↓ $url"
    if curl -fSL --retry 3 --retry-delay 2 --retry-all-errors --max-time 180 -o "$out" "$url"; then
      return 0
    fi
    echo "  [重试] 该镜像失败，尝试下一个: $url"
  done
  echo "  [警告] 所有镜像均下载失败: $(basename "$out")（可手动放置到 $out）"
  return 1
}

# 构建 whisper-server 原生二进制（macOS 无官方预编译包，必须从源码构建）
build_whisper_server() {
  echo "==> [whisper] 尝试从源码构建 whisper-server（需要 git + cmake + 编译器）"
  if ! command -v cmake >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
    echo "  [跳过] 未检测到 cmake/git，跳过自动构建。"
    echo "        请手动构建 whisper.cpp 的 whisper-server 并放到: $WSB"
    return 0
  fi
  local src="$MODELS/whisper.cpp"
  if [[ ! -d "$src" ]]; then
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$src" || {
      echo "  [警告] 克隆 whisper.cpp 失败，跳过构建。";
      return 0;
    }
  fi
  ( cd "$src" && cmake -B build -DWHISPER_SERVER=ON && cmake --build build -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" ) || {
    echo "  [警告] 构建 whisper-server 失败，请手动构建。";
    return 0;
  }
  local built
  built="$(find "$src/build" -name 'whisper-server' -type f 2>/dev/null | head -1)"
  if [[ -n "$built" ]]; then
    cp "$built" "$WSB"
    echo "  ✓ whisper-server 已构建并放置到: $WSB"
  else
    echo "  [警告] 未找到构建产物 whisper-server，请手动构建。"
  fi
  return 0
}

echo "==> [1/3] tesseract.js 运行文件（worker + wasm core）"
dl "https://unpkg.com/tesseract.js@5/dist/worker.min.js"                "$TES/worker.min.js"
dl "https://unpkg.com/tesseract.js-core/tesseract-core.wasm.js"         "$TES/tesseract-core.wasm.js"
dl "https://unpkg.com/tesseract.js-core/tesseract-core.wasm"            "$TES/tesseract-core.wasm"
dl "https://unpkg.com/tesseract.js-core/tesseract-core-simd.wasm.js"    "$TES/tesseract-core-simd.wasm.js"
dl "https://unpkg.com/tesseract.js-core/tesseract-core-simd.wasm"       "$TES/tesseract-core-simd.wasm"

echo "==> [2/3] tesseract 语言包（chi_sim 简体中文 + eng 英文）"
# 注：tesseract-ocr/tessdata 主分支提供未二次 gzip 的 .traineddata 文件，
# 与 createWorker 的 gzip:false 对应；旧版 .traineddata.gz 仍被兼容。
# raw.githubusercontent.com 在部分网络环境下间歇性 502，故优先使用 ghproxy.net 镜像，
# 官方地址作为兜底。ghproxy.net 仅透传 raw.githubusercontent.com 内容，文件一致。
dl_any "$TES/chi_sim.traineddata" \
  "https://ghproxy.net/https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/chi_sim.traineddata" \
  "https://github.com/tesseract-ocr/tessdata/raw/main/chi_sim.traineddata"
dl_any "$TES/eng.traineddata" \
  "https://ghproxy.net/https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/eng.traineddata" \
  "https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata"

echo "==> [3/3] whisper 原生 STT 资源"
if [[ -s "$WSB" ]]; then
  echo "  · whisper-server 已存在，跳过构建: $WSB"
else
  if [[ -n "${WHISPER_BUILD:-}" ]]; then
    build_whisper_server
  else
    echo "  [提示] whisper-server 未就绪（原生 STT 需要它）。"
    echo "        手动构建：克隆 whisper.cpp → cmake -DWHISPER_SERVER=ON → 把 whisper-server 放到"
    echo "        $WSB"
    echo "        或运行：WHISPER_BUILD=1 bash scripts/fetch-models.sh"
    echo "        （模型权重改为运行时在「设置 → 本地模型」中按需下载，不再由本脚本拉取。）"
  fi
fi

echo "==> whisper wasm（WASM 兜底路径，whisper.cpp emscripten 构建）"
# whisper.wasm 是构建产物，官方不提供稳定下载链接，需本地用 emscripten 构建：
#   git clone https://github.com/ggml-org/whisper.cpp
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
  echo "  [提示] whisper.wasm 尚未就绪。WASM 兜底路径需它才能运行，请按上面"
  echo "        说明用 emscripten 构建 whisper.cpp 的 examples/whisper.wasm，并把"
  echo "        whisper.wasm 与 whisper.js 放到: $WSP"
  echo "        （OCR 与拍照/附件上传不依赖它，可独立使用。）"
fi

echo ""
echo "✅ 模型目录就绪: $MODELS"
echo "   tesseract: $(ls -lh "$TES" 2>/dev/null | wc -l | tr -d ' ') 个文件"
echo "   whisper:   $(ls -lh "$WSP" 2>/dev/null | wc -l | tr -d ' ') 个文件"
echo "   · whisper 模型权重（ggml-*.bin）由「设置→本地模型」运行时按需下载到用户目录。"
