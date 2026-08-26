#!/usr/bin/env bash
# 字体自托管：从 Google Fonts 拉取 Noto Sans SC / Noto Serif SC / JetBrains Mono
# 的 woff2 子集到 src-ui/public/fonts/，并生成 fonts.css（@font-face + unicode-range）。
#
# 用法：bash scripts/fetch-fonts.sh
# 说明：需要网络；失败可重试（幂等覆盖）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/src-ui/public/fonts"
mkdir -p "$OUT_DIR"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
CSS_URL='https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@500;700&family=JetBrains+Mono:wght@400;500&display=swap'

echo "[fonts] 拉取 CSS（woff2 子集清单）…"
curl -fsSL --retry 3 -A "$UA" "$CSS_URL" -o "$OUT_DIR/fonts.raw.css"

# 逐块处理 @font-face：
# - Noto Sans/Serif SC 只自托管「拉丁 + 扩展」子集（CJK 交给 macOS 系统字体 PingFang/Songti，
#   既省体积又保证离线下中文渲染）；JetBrains Mono 全量自托管。
# - 下载每个 src url，并把 url() 改写为本地相对路径；manifest 记录 latin 子集供 preload。
python3 - "$OUT_DIR/fonts.raw.css" "$OUT_DIR" <<'PY'
import re, sys, urllib.request, pathlib, hashlib

raw, out_dir = sys.argv[1], pathlib.Path(sys.argv[2])
css = pathlib.Path(raw).read_text(encoding="utf-8")

blocks = re.findall(r"@font-face\s*\{[^}]+\}", css)
manifest = {}
url_re = re.compile(r"url\((https://[^)]+)\)\s*format\('woff2'\)")
weight_re = re.compile(r"font-weight:\s*(\d+)")
family_re = re.compile(r"font-family:\s*'([^']+)'")

def range_max(ur):
    """unicode-range 内最大码位（用于识别 CJK/emoji 大段）"""
    mx = 0
    for part in ur.split(","):
        part = part.strip()
        if not part.upper().startswith("U+"):
            continue
        body = part[2:].replace("?", "")
        hi = body.split("-")[-1] if "-" in body else body
        try:
            mx = max(mx, int(hi, 16))
        except ValueError:
            continue
    return mx

new_blocks = []
counters = {}
for b in blocks:
    m = url_re.search(b)
    if not m:
        continue
    fam = (family_re.search(b) or [None, "unknown"])[1]
    ur = re.search(r"unicode-range:\s*([^;]+);", b)
    urange = ur.group(1) if ur else ""
    # Noto 中文族跳过 CJK/emoji 大段（≥U+2E80）；JetBrains Mono 全量保留
    if "noto" in fam.lower() and range_max(urange) >= 0x2E80:
        continue
    weight = (weight_re.search(b) or [None, "400"])[1]
    key = f"{fam}-{weight}"
    n = counters.get(key, 0) + 1
    counters[key] = n
    url = m.group(1)
    digest = hashlib.sha1(url.encode()).hexdigest()[:10]
    fname = f"{re.sub(r'[^a-z0-9]+', '-', fam.lower())}-{weight}-{digest}.woff2"
    local = out_dir / fname
    if not local.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            local.write_bytes(r.read())
        print(f"  ↓ {fname} ({len(local.read_bytes())//1024}KB)")
    # 记录 latin 子集（preload 用）：unicode-range 含 U+0000-00FF 段
    ur = re.search(r"unicode-range:\s*([^;]+);", b)
    if "U+0000-00FF" in urange:
        manifest.setdefault(key, fname)
    new_blocks.append(b.replace(url, f"./{fname}"))

pathlib.Path(out_dir / "fonts.css").write_text("\n".join(new_blocks) + "\n", encoding="utf-8")
pathlib.Path(out_dir / "manifest.json").write_text(
    __import__("json").dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"[fonts] 完成：{sum(counters.values())} 个 woff2 子集 → {out_dir}")
PY

# 清理：删除未被 fonts.css 引用的 woff2（上一轮误下的 CJK 子集）
python3 - "$OUT_DIR" <<'PY'
import re, pathlib, sys
out = pathlib.Path(sys.argv[1])
css = (out / "fonts.css").read_text(encoding="utf-8")
keep = set(re.findall(r"url\(\./([^)]+)\)", css))
removed = 0
for f in out.glob("*.woff2"):
    if f.name not in keep:
        f.unlink()
        removed += 1
print(f"[fonts] 清理 {removed} 个未引用 woff2")
PY

rm -f "$OUT_DIR/fonts.raw.css"
