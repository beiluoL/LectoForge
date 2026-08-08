/**
 * 文档库 Markdown 渲染器 —— 兼容再导出层。
 *
 * 真正的实现已上移到 `@/lib/markdown`，成为文档库 / 康奈尔笔记 / 复习闪卡共用的
 * 唯一解析源（详见该文件头部说明）。此处仅保留再导出，让文档库内既有的
 * `from './markdown'` 引用零改动继续工作。
 *
 * 新代码请直接 `from '@/lib/markdown'`，不要再从这里引入。
 */
export {
  slugify,
  createSlugger,
  assetUrl,
  renderMarkdown,
  parseMarkdown,
  renderNoteBody,
  linkifyWikilinksInHtml,
  extractWikilinkNames,
  looksLikeHtml,
  default as default,
} from '@/lib/markdown'
