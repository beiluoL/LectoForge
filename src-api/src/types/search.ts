/** 全局搜索统一返回结构（跨 收集箱 / 康奈尔笔记 / 费曼故事 三表聚合） */
export interface SearchResult {
  type: 'capture' | 'note' | 'story';
  id: number;
  title: string;
  /** 匹配到的正文前 30 字摘要（已截断） */
  content: string;
  /** 前端 router.push 的目标路径 */
  path: string;
}
