/**
 * useTOC —— 从 Markdown 文本提取 H1~H6 大纲的组合式函数。
 *
 * 【为什么用 markdown-it 解析而不是正则】
 * 正则 `/^#{1,6}\s+(.*)$/gm` 会把围栏代码块里的注释（例如 shell 脚本的 `# 安装依赖`）
 * 误当成标题，也认不出 Setext 形式的标题（下划线式 `===` / `---`）。
 * 这里直接吃 markdown-it 的 token 流，结果和预览区渲染出的标题严格一一对应。
 *
 * 【锚点如何保证和预览区一致】
 * 与 @/lib/markdown 的 heading_open 渲染器共用 createSlugger()：同样按文档顺序遍历、
 * 同样的重名计数，所以第 N 个标题两边算出的 id 必然相同。
 */
import { computed, type ComputedRef, type Ref } from 'vue'

import { createSlugger, parseMarkdown } from '@/lib/markdown'

export interface TocItem {
  /** 标题级别 1~6 */
  level: number
  /** 标题纯文本 */
  title: string
  /** 预览区对应 DOM 节点的 id */
  anchorId: string
}

/** 从 Markdown 字符串提取大纲（纯函数，便于单测与非响应式场景复用） */
export function extractTOC(source: string): TocItem[] {
  if (!source) return []
  const tokens = parseMarkdown(source)
  const slugger = createSlugger()
  const items: TocItem[] = []

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type !== 'heading_open') continue
    const inline = tokens[i + 1]
    const raw = inline && inline.type === 'inline' ? inline.content : ''
    // token.tag 形如 'h2'
    const level = Number(token.tag.slice(1)) || 1
    // 标题里的行内 Markdown 标记不该出现在大纲文字里
    const title = raw
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .replace(/~~([^~]*)~~/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim()
    items.push({ level, title: title || '(无标题)', anchorId: slugger(raw) })
  }
  return items
}

/**
 * 响应式大纲。
 * @param source Markdown 文本的 ref / getter
 * @returns toc（大纲数组）、minLevel（最浅层级，用于计算缩进基准）、isEmpty
 */
export function useTOC(source: Ref<string> | (() => string)): {
  toc: ComputedRef<TocItem[]>
  minLevel: ComputedRef<number>
  isEmpty: ComputedRef<boolean>
} {
  const read = typeof source === 'function' ? source : () => source.value

  const toc = computed(() => extractTOC(read()))
  // 全文最浅的标题层级作为缩进基准：整篇都从 H2 起步时，H2 不该被缩进一格
  const minLevel = computed(() => (toc.value.length ? Math.min(...toc.value.map((t) => t.level)) : 1))
  const isEmpty = computed(() => toc.value.length === 0)

  return { toc, minLevel, isEmpty }
}

export default useTOC
