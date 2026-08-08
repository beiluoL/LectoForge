/**
 * 业务实体类型（收集箱 / 笔记 / 故事）的展示元信息。
 *
 * 【为什么要收敛】
 * 后端把这三类内容统一叫「实体」：全文检索 `SearchResult.type`、AI 关联
 * `AssociateItem.entityType`、AI 洞察报告的引用项，用的是同一套字面量
 * `'capture' | 'note' | 'story'`。但前端历史上抄了三份中文标签映射：
 *   - components/CommandPalette.vue  → TYPE_META（图标 + 标签）
 *   - components/AiAssociatePanel.vue → typeLabel()
 *   - views/AiInsights.vue           → typeLabel()
 * 三份内容一模一样，改一处漏两处只是时间问题（比如以后加 `palace` 实体）。
 * 这里作为唯一事实源，全项目一律 `from '@/constants/entity'`。
 *
 * 【图标为什么不放在这儿判空】
 * icon 名走项目统一的 lucide 包装器 Icon.vue，字符串即契约；这里给的三个名字
 * 与命令面板原实现完全一致，改名等于改视觉，不要顺手"优化"。
 */

/** 可被检索 / 被 AI 关联的业务实体类型 */
export type EntityType = 'capture' | 'note' | 'story';

/** 实体类型 → 中文标签 */
export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  capture: '收集箱',
  note: '笔记',
  story: '故事',
};

/** 实体类型 → lucide 图标名（Icon.vue 的 name 入参） */
export const ENTITY_TYPE_ICON: Record<EntityType, string> = {
  capture: 'inbox',
  note: 'file-text',
  story: 'pen-line',
};

/** 实体类型 → 图标 + 标签，命令面板那种"一次取俩"的场景直接用这张表 */
export const ENTITY_TYPE_META: Record<EntityType, { icon: string; label: string }> = {
  capture: { icon: ENTITY_TYPE_ICON.capture, label: ENTITY_TYPE_LABEL.capture },
  note: { icon: ENTITY_TYPE_ICON.note, label: ENTITY_TYPE_LABEL.note },
  story: { icon: ENTITY_TYPE_ICON.story, label: ENTITY_TYPE_LABEL.story },
};

/**
 * 宽松取标签：入参是后端来的裸字符串时用这个。
 * 认不出的类型原样返回（与被替换掉的两处 typeLabel() 行为一致），
 * 避免后端将来新增实体类型时前端渲染出空白。
 */
export function entityTypeLabel(t: string): string {
  return ENTITY_TYPE_LABEL[t as EntityType] ?? t;
}
