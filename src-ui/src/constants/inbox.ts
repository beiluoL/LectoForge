/**
 * 收集箱条目类型（新版 /api/inbox 小写五态）的展示元信息。
 *
 * 【与 constants/capture.ts 的区别，别搞混】
 * 这里是**条目类型**（速记 / 剪藏 / 图片 / 语音 / 附件），对应 `wb_capture.type`；
 * capture.ts 那份是旧版收集箱的**处理状态**（INBOX / PROCESSED / ARCHIVED）。
 * 两者同表不同列，一个描述"这是什么"，一个描述"处理到哪一步了"。
 *
 * 【为什么单独成文件】
 * InboxList.vue 里原本是两个 if 链函数 typeIcon()/typeLabel()，一旦收集箱详情、
 * 批量操作条、快速捕获面板任意一处要显示类型，就得再抄一遍 if 链。抽成表后
 * 新增一种类型只改这一个文件，且 Record<InboxType, string> 会强制补全所有分支。
 */
import type { InboxType } from '@/api/inbox';

/** 条目类型 → 中文标签 */
export const INBOX_TYPE_LABEL: Record<InboxType, string> = {
  text: '速记',
  link: '网页剪藏',
  image: '图片',
  audio: '语音灵感',
  file: '附件',
};

/** 条目类型 → lucide 图标名（Icon.vue 的 name 入参） */
export const INBOX_TYPE_ICON: Record<InboxType, string> = {
  text: 'pen-line',
  link: 'link',
  image: 'image',
  audio: 'mic',
  file: 'paperclip',
};

/**
 * 宽松取标签：认不出的类型退回「速记」。
 * 这与被替换掉的 typeLabel() 完全一致——它的 if 链末尾就是 `return '速记'`，
 * 也就是说 text 与任何未知值都落到速记，不要改成返回原值。
 */
export function inboxTypeLabel(t: InboxType): string {
  return INBOX_TYPE_LABEL[t] ?? INBOX_TYPE_LABEL.text;
}

/** 宽松取图标：认不出的类型退回 pen-line（同上，与原 typeIcon() 行为一致） */
export function inboxTypeIcon(t: InboxType): string {
  return INBOX_TYPE_ICON[t] ?? INBOX_TYPE_ICON.text;
}
