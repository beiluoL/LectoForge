/**
 * 全局共享的 Markdown 渲染引擎：markdown-it + highlight.js。
 *
 * 【为什么在 src/lib 而不是 views/DocLibrary】
 * 双链 [[笔记]] 是跨模块的核心语法：文档库、康奈尔笔记、复习闪卡都要解析。
 * 各处各写一份，语法迟早漂移（这边支持别名那边不支持）。所以渲染器收敛到这里作为
 * 唯一事实源；views/DocLibrary/markdown.ts 退化成再导出的薄壳，老引用零改动，
 * 新模块一律 `from '@/lib/markdown'`。
 *
 * 【与右侧大纲的锚点对齐】
 * 大纲跳转依赖预览区标题的 DOM id。这里导出的 createSlugger() 是 useTOC.ts 与渲染器
 * 共用的同一套 slug 算法：两边都按文档顺序遍历标题、共用同样的重名计数规则，
 * 因此第 N 个标题在两边一定得到相同的 anchorId。
 *
 * 【代码块复用项目既有视觉】
 * fence 渲染器手工拼出 .code-block-wrapper / .code-block-header / .code-line-numbers 结构，
 * 直接命中 style.css 里已有的全局代码块样式（深色底 + 行号 + 复制按钮），
 * 不引入新的视觉语言。配套主题选 github-dark，与 pre 的 #1a1d23 底色一致。
 *
 * 【Obsidian 式语法支持】
 * 通过自定义 inline 规则解析：
 *   - 双链：[[笔记]] / [[笔记#标题]] / [[笔记|别名]] / [[笔记#标题|别名]]
 *   - 嵌入块：![[笔记]] / ![[笔记#标题]]（转写在预览里内联渲染目标笔记内容）
 *   - 图片嵌入：![[图片.png]] / ![[图片.png|200]] / ![[图片.png|200x300]]
 * 以及把标准 Markdown 的本地图片 ![](相对路径) 也改写为同源资源 URL，确保能正常加载。
 * 所有渲染结果都通过 markdown-it 的合法 token（link_open / image / 自定义 obsidian_embed）
 * 产出，绝不插入 html_inline/html_block 原始 HTML——因为本项目 md 实例 html:false，
 * 那两个 token 的渲染器已被置空，插进去会被直接吞掉。
 */
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'

import 'highlight.js/styles/github-dark.css'

/** 单个标题文本 → 锚点 slug（保留中文，去掉标点，空白转连字符） */
export function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    // 去掉 Markdown 行内标记，避免 `**重点**` 生成带星号的锚点
    .replace(/[*_`~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 中英文标点统一剔除
    .replace(/[!"#$%&'()+,./:;<=>?@[\]^{|}·—～！“”‘’（），。：；？、《》【】]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'section'
}

/**
 * 创建一个带重名计数的 slug 生成器。
 * 同名标题依次得到 `xxx`、`xxx-1`、`xxx-2`，保证 DOM id 唯一。
 */
export function createSlugger(): (text: string) => string {
  const used = new Map<string, number>()
  return (text: string) => {
    const base = slugify(text)
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen}`
  }
}

/* 渲染时通过 env 透传的上下文。
 * 用 type 而非 interface：markdown-it 的 Env 带索引签名，
 * 只有 type 字面量才会获得隐式索引签名、从而能直接传给 md.render(src, env)。 */
type RenderEnv = {
  slugger?: (text: string) => string
  /** 当前正在渲染的笔记相对 id，用于把双链 / 图片的相对引用折算成库内路径 */
  noteId?: string
}

/* 不写 `const md: MarkdownIt`——markdown-it v15 的默认导出是「可调用的类」这个值，
 * 同名类型是另行具名导出的，直接拿默认导入当类型注解会报 TS2749，交给 TS 自行推断即可。 */
const md = new MarkdownIt({
  // html: false —— 笔记可能来自外部下载的 .md，桌面端 webview 里执行内联脚本风险太高，
  // 一律转义原始 HTML。需要富排版时用 Markdown 语法表达。
  html: false,
  linkify: true,
  typographer: false,
  // 单个换行即换行：与 Obsidian 阅读视图的默认行为一致，写笔记时更符合直觉
  breaks: true,
})

// =====================================================================
// Obsidian 式语法（双链 / 嵌入块 / 图片嵌入）
// =====================================================================

/** 视为图片的扩展名（与后端白名单保持一致） */
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif|ico|tiff?)$/i
/** 笔记扩展名 */
const MD_EXT = /\.(md|markdown|mdx)$/i

/** 取文件相对 id 的目录部分（不含尾部斜杠），根目录返回 '' */
function dirOf(id: string): string {
  const i = id.lastIndexOf('/')
  return i === -1 ? '' : id.slice(0, i)
}

/** 把相对引用折算成相对工作区根目录的路径（库内 id 形式）。
 * 与 Obsidian 一致：
 *  - 含 ./ 或 ../ → 相对当前笔记所在目录解析；
 *  - 含 / 但无相对标记（如 [[Folder/Sub/Note]]）→ 视为「从库根起的绝对路径」；
 *  - 单段裸名（如 [[笔记]]）→ 默认与当前笔记同目录。 */
function resolveLocalPath(noteId: string, ref: string): string {
  const r = ref.trim()
  if (!r) return ''
  const segs = r.split('/')
  const isRelative = segs.some((s) => s === '..') || /^\.\.?\//.test(r)
  if (isRelative) {
    const p = r.replace(/^\.\//, '')
    const parts = dirOf(noteId) ? dirOf(noteId).split('/') : []
    for (const seg of p.split('/')) {
      if (!seg || seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    return parts.join('/')
  }
  if (segs.length > 1) return r.replace(/^\.?\//, '') // 绝对路径（从库根起）
  const d = dirOf(noteId)
  return d ? `${d}/${r}` : r // 裸名：与当前笔记同目录
}

/** 构造同源资源 URL（后端 /api/library/asset 按库内相对路径返回二进制） */
export function assetUrl(relPath: string): string {
  return `/api/library/asset?path=${encodeURIComponent(relPath)}`
}

/** 给属性值转义（防 XSS / 属性截断） */
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 解析 [[...]] / ![[...]] 内部内容，拆出 目标 / 标题(#) / 别名或尺寸(|)。
 * Obsidian 语法里 `|` 是「别名/尺寸」分隔符，且出现在 `#标题` 之后，
 * 因此必须先按 `|` 切出别名/尺寸，再在剩余部分里按 `#` 切出标题。
 * 返回 { target, heading, pipe }，三者均为已 trim 的纯文本。
 */
function parseObsidianInner(inner: string): { target: string; heading: string; pipe: string } {
  let raw = inner
  let pipe = ''
  const pi = raw.indexOf('|')
  if (pi >= 0) {
    pipe = raw.slice(pi + 1).trim()
    raw = raw.slice(0, pi).trim()
  }
  let heading = ''
  const hi = raw.indexOf('#')
  if (hi >= 0) {
    heading = raw.slice(hi + 1).trim()
    raw = raw.slice(0, hi)
  }
  return { target: raw.trim(), heading: heading.trim(), pipe: pipe.trim() }
}

/**
 * 核心 inline 规则：在 state.pos 处识别 [[ 或 ![[，解析后产出对应 token。
 * 注册在 image / link 之前，从而抢在默认规则前消费双链与嵌入语法。
 */
function obsidianRule(state: any, silent: boolean): boolean {
  const src: string = state.src
  const pos: number = state.pos
  const code = src.charCodeAt(pos)

  const isEmbed = code === 0x21 /* ! */ // 嵌入块以 '!' 开头
  const bracketAt = isEmbed ? pos + 1 : pos // 第一个 '[' 的位置

  // 必须紧跟 "[[" 才是我们的语法
  if (src.charCodeAt(bracketAt) !== 0x5b /* [ */) return false
  if (src.charCodeAt(bracketAt + 1) !== 0x5b /* [ */) return false

  // 找到配对的 "]]"
  let i = bracketAt + 2
  const max = src.length
  while (i < max) {
    if (src.charCodeAt(i) === 0x5d /* ] */ && src.charCodeAt(i + 1) === 0x5d /* ] */) break
    i += 1
  }
  if (i >= max) return false // 没有闭合，交给默认规则（当作普通文本）

  const inner = src.slice(bracketAt + 2, i)
  const consumedEnd = i + 2 // 跳过第二个 ']'
  const { target, heading, pipe } = parseObsidianInner(inner)
  if (!target) return false

  const noteId: string = (state.env && state.env.noteId) || ''
  const isImage = IMG_EXT.test(target)

  // —— 图片嵌入：![[xxx.png]] / ![[xxx.png|WxH]] ——
  // 注意：不走 markdown-it 的默认 image 渲染器（它对程序插入的 image token 会因
  // children 为 null 而崩溃），改用自定义 obsidian_embed 渲染器直接输出 <img> 安全 HTML。
  if (isEmbed && isImage) {
    const rel = resolveLocalPath(noteId, target)
    const m = pipe.match(/^(\d+)(?:x(\d+))?$/i)
    const sizeAttr = m ? ` width="${m[1]}"${m[2] ? ` height="${m[2]}"` : ''}` : ''
    const html =
      `<img class="dl-embed-img" src="${assetUrl(rel)}" alt="${escAttr(target)}" ` +
      `data-asset-name="${escAttr(target.split('/').pop() || target)}"${sizeAttr}>`
    const token = state.push('obsidian_embed', '', 0)
    token.content = html
    state.pos = consumedEnd
    return true
  }

  // —— 笔记嵌入块：![[笔记]] / ![[笔记#标题]] ——
  if (isEmbed) {
    const resolvedId =
      target.includes('/') || MD_EXT.test(target) ? resolveLocalPath(noteId, target) : ''
    const display = pipe || target
    const html =
      `<div class="dl-embed" data-embed-name="${escAttr(target)}"` +
      `${resolvedId ? ` data-embed-id="${escAttr(resolvedId)}"` : ''}` +
      `${heading ? ` data-heading="${escAttr(heading)}"` : ''}>` +
      `<div class="dl-embed-head"><span class="dl-embed-title">${escAttr(display)}</span>` +
      `<button type="button" class="dl-embed-open" data-embed-name="${escAttr(target)}"` +
      `${resolvedId ? ` data-embed-id="${escAttr(resolvedId)}"` : ''}>打开原笔记</button></div>` +
      `<div class="dl-embed-body dl-md">加载中…</div></div>`
    const token = state.push('obsidian_embed', '', 0)
    token.content = html
    state.pos = consumedEnd
    return true
  }

  // —— 双链：[[笔记]] / [[笔记#标题]] / [[笔记|别名]] ——
  const resolvedId =
    target.includes('/') || MD_EXT.test(target) ? resolveLocalPath(noteId, target) : ''
  const display = pipe || target
  const open = state.push('link_open', 'a', 1)
  open.attrSet('href', '#')
  open.attrSet('class', 'dl-wikilink')
  open.attrSet('data-wikilink-name', target)
  if (resolvedId) open.attrSet('data-wikilink-id', resolvedId)
  if (heading) open.attrSet('data-heading', heading)
  open.attrSet('title', heading ? `${display} › ${heading}` : display)
  const text = state.push('text', '', 0)
  text.content = display
  state.push('link_close', 'a', -1)
  state.pos = consumedEnd
  return true
}

// 自定义 token 渲染器：直接输出我们构造的安全 HTML（不受 html:false 影响）
md.renderer.rules.obsidian_embed = (tokens, idx) => tokens[idx].content

// 抢在默认 image / link 规则前注册，确保 [[ / ![[ 被优先识别
md.inline.ruler.before('image', 'obsidian', obsidianRule)

/**
 * 标准 Markdown 图片 ![](src) 的本地文件改写：
 * 把相对 / 绝对（库内）路径改写为同源资源 URL，使本地图片也能正常加载；
 * 外链(http/https)、data:、blob: 保持原样。
 */
const defaultImageRule = md.renderer.rules.image
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = String(token.attrGet('src') ?? '')
  if (!/^(https?:|data:|blob:)/i.test(src)) {
    const noteId: string = ((env as RenderEnv | undefined)?.noteId as string) || ''
    const rel = resolveLocalPath(noteId, src)
    token.attrSet('src', assetUrl(rel))
    const cls = token.attrGet('class')
    token.attrSet('class', cls ? `${cls} dl-embed-img` : 'dl-embed-img')
  }
  return defaultImageRule
    ? defaultImageRule(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
}

/** 标题：注入与大纲一致的锚点 id */
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const inline = tokens[idx + 1]
  const text = inline && inline.type === 'inline' ? inline.content : ''
  // env 的官方类型是宽松的索引签名，取值时收窄成本地约定的形状
  const slugger = (env as RenderEnv | undefined)?.slugger
  if (slugger) token.attrSet('id', slugger(text))
  token.attrJoin('class', 'dl-md-heading')
  return self.renderToken(tokens, idx, options)
}

/** 链接：统一新窗口打开，实际跳转行为由 EditorArea 的点击代理接管 */
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]
  // attrGet 的返回类型含 number（属性值可以是数字），统一成字符串再做匹配
  const href = String(token.attrGet('href') ?? '')
  if (/^https?:\/\//i.test(href)) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return self.renderToken(tokens, idx, options)
}

/** 代码块：语法高亮 + 行号 + 复制按钮，套用项目已有的 .code-block-* 全局样式 */
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const info = (token.info || '').trim()
  const lang = info.split(/\s+/)[0] || ''
  const code = token.content.replace(/\n$/, '')

  let highlighted: string
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      highlighted = md.utils.escapeHtml(code)
    }
  } else {
    // 不做 highlightAuto：自动探测在长文里开销明显，且经常猜错语言
    highlighted = md.utils.escapeHtml(code)
  }

  const lineCount = code.split('\n').length
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => `<span class="code-line-num">${i + 1}</span>`).join('')
  const langLabel = lang ? md.utils.escapeHtml(lang) : 'text'

  return (
    `<div class="code-block-wrapper">` +
    `<div class="code-block-header">` +
    `<span class="code-lang">${langLabel}</span>` +
    `<button class="code-copy-btn" type="button" data-dl-copy><span class="copy-label">复制</span></button>` +
    `</div>` +
    `<div class="code-block-body">` +
    `<div class="code-line-numbers">${lineNumbers}</div>` +
    `<pre><code class="hljs language-${langLabel}">${highlighted}</code></pre>` +
    `</div>` +
    `</div>`
  )
}

/** 表格：包一层容器，窄栏时可横向滚动而不撑破布局 */
const defaultTableOpen = md.renderer.rules.table_open
md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
  const inner = defaultTableOpen
    ? defaultTableOpen(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
  return `<div class="dl-md-table-wrap">${inner}`
}
const defaultTableClose = md.renderer.rules.table_close
md.renderer.rules.table_close = (tokens, idx, options, env, self) => {
  const inner = defaultTableClose
    ? defaultTableClose(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
  return `${inner}</div>`
}

/** 渲染 Markdown 为 HTML；每次渲染使用独立的 slugger，保证锚点从头计数。
 * @param ctx.noteId 当前笔记的相对 id，用于把双链 / 图片的相对引用折算成库内路径。 */
export function renderMarkdown(source: string, ctx?: { noteId?: string }): string {
  const env: RenderEnv = { slugger: createSlugger(), noteId: ctx?.noteId ?? '' }
  return md.render(source ?? '', env)
}

/** 供 useTOC 复用同一个解析器实例（避免重复实例化与规则不一致） */
export function parseMarkdown(source: string) {
  return md.parse(source ?? '', {})
}

// =====================================================================
// 康奈尔笔记复用层
//
// 笔记栏（wb_note.note_column）是 contenteditable 产出的 HTML 片段，不是 Markdown，
// 直接丢给 md.render() 会因为 html:false 被整段转义成源码。
// 但双链体验必须和文档库完全一致，所以这里做两条路：
//   - 内容是 HTML  → 走 DOM 遍历，只在「文本节点」里把 [[x]] 换成 <a class="dl-wikilink">；
//   - 内容是纯文本 → 直接复用上面的 markdown-it 实例（拿到完整 Obsidian 语法支持）。
// 关键点：HTML 分支绝不用正则去改 HTML 字符串——那会误伤属性值里的方括号，
// 也会在标签中间插入锚点导致 DOM 结构损坏。遍历文本节点是唯一安全的做法。
// =====================================================================

/** 双链匹配：非贪婪，禁止跨行与嵌套方括号 */
const WIKILINK_RE = /\[\[([^\][\n]+)\]\]/g

/** 粗判是否为富文本编辑器产出的 HTML 片段（有成对块级/行内标签即算） */
export function looksLikeHtml(src: string): boolean {
  return /<(div|p|br|ul|ol|li|h[1-6]|strong|em|u|b|i|span|blockquote|pre|code|table|img)\b[^>]*>/i.test(src || '')
}

/** 构造一个双链锚点元素，属性与 markdown 分支产出的完全一致，共用同一套点击代理与样式 */
function buildWikilinkAnchor(doc: Document, inner: string): HTMLAnchorElement {
  const { target, heading, pipe } = parseObsidianInner(inner)
  const display = pipe || target || inner
  const a = doc.createElement('a')
  a.setAttribute('href', '#')
  a.setAttribute('class', 'dl-wikilink')
  a.setAttribute('data-wikilink-name', target)
  if (heading) a.setAttribute('data-heading', heading)
  a.setAttribute('title', heading ? `${display} › ${heading}` : display)
  a.textContent = display
  return a
}

/**
 * 在 HTML 片段的文本节点里把 [[双链]] 替换成锚点。
 * 跳过 a / code / pre 内部：链接里套链接是非法 DOM，代码块里的 [[ 是字面量。
 */
export function linkifyWikilinksInHtml(html: string): string {
  if (!html) return ''
  if (!/\[\[/.test(html)) return html // 没有双链就零开销原样返回
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let node = walker.nextNode() as Text | null
  while (node) {
    const parentTag = node.parentElement?.tagName.toLowerCase() ?? ''
    if (!['a', 'code', 'pre', 'script', 'style'].includes(parentTag) && WIKILINK_RE.test(node.data)) {
      targets.push(node)
    }
    WIKILINK_RE.lastIndex = 0
    node = walker.nextNode() as Text | null
  }
  for (const text of targets) {
    const frag = doc.createDocumentFragment()
    let last = 0
    let m: RegExpExecArray | null
    WIKILINK_RE.lastIndex = 0
    while ((m = WIKILINK_RE.exec(text.data))) {
      if (m.index > last) frag.appendChild(doc.createTextNode(text.data.slice(last, m.index)))
      frag.appendChild(buildWikilinkAnchor(doc, m[1]))
      last = m.index + m[0].length
    }
    if (last < text.data.length) frag.appendChild(doc.createTextNode(text.data.slice(last)))
    text.parentNode?.replaceChild(frag, text)
  }
  return doc.body.innerHTML
}

/**
 * 渲染康奈尔笔记正文（沉浸阅读模式用）。
 * 自动识别 HTML / Markdown 两种存储形态，两者最终都产出带 .dl-wikilink 的双链锚点。
 */
export function renderNoteBody(source: string): string {
  const src = source ?? ''
  if (!src.trim()) return ''
  return looksLikeHtml(src) ? linkifyWikilinksInHtml(src) : renderMarkdown(src)
}

/** 抽取正文里引用到的全部双链目标名（去重、保序），用于正向引用统计 */
export function extractWikilinkNames(source: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(source || ''))) {
    const { target } = parseObsidianInner(m[1])
    const name = target.trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

export default md
