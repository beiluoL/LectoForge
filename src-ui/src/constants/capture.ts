/**
 * 旧版收集箱（`/api/workbench/captures`）的处理状态常量。
 *
 * 【状态大小写为什么是两套，务必看完再改】
 * `wb_capture` 一张表被两代收集箱共用：
 *   - 旧版 `/api/workbench/captures` 用**大写三态** INBOX / PROCESSED / ARCHIVED；
 *   - 新版 `/api/inbox/*` 用**小写三态** unprocessed / archived / trashed。
 * 后端在读写时做大小写转换，两边数据是通的。本文件只描述**大写这一套**，
 * 小写那套的类型在 `@/api/inbox` 的 `InboxStatus`，不要在这里混进来。
 *
 * 【当前唯一消费者是归档页，为什么还要抽出来】
 * `views/archive/WorkbenchCapture.vue` 已从路由摘除（见 views/archive/README.md），
 * 但源码保留、仍进 vue-tsc 类型检查。把散在组件里的字面量抽成常量表后：
 *   1) 状态字面量拼写错误会在编译期而不是运行期暴露；
 *   2) 未来若复活旧页面或新增"已整理"筛选，改一处即可；
 *   3) 归档组件不再自带私有映射，符合 README 里"改动公共 API 时同步归档件"的约定。
 * 注意本文件被 tree-shaking 摘掉不进产物，零运行时成本。
 */

/** 旧版收集箱处理状态字面量 */
export const CAPTURE_STATUS = {
  /** 待整理：刚捕获，还没消化 */
  INBOX: 'INBOX',
  /** 已整理：已沉淀成笔记 / 故事等 */
  PROCESSED: 'PROCESSED',
  /** 已归档：不再出现在待办视图 */
  ARCHIVED: 'ARCHIVED',
} as const;

export type CaptureStatus = (typeof CAPTURE_STATUS)[keyof typeof CAPTURE_STATUS];

/** 状态 → 中文标签 */
export const CAPTURE_STATUS_LABEL: Record<CaptureStatus, string> = {
  INBOX: '待整理',
  PROCESSED: '已整理',
  ARCHIVED: '已归档',
};

/**
 * 状态 → 主题色（`--kb-*` token，禁止写死十六进制）。
 * 组件那边再用它拼 `color-mix()` 出淡色底，颜色语义只在这里定义一次。
 */
export const CAPTURE_STATUS_COLOR: Record<CaptureStatus, string> = {
  INBOX: 'var(--kb-warning)',
  PROCESSED: 'var(--kb-primary)',
  ARCHIVED: 'var(--kb-muted-foreground)',
};

/** 未知 / 空状态时的兜底色，与 ARCHIVED 同色 */
export const CAPTURE_STATUS_FALLBACK_COLOR = 'var(--kb-muted-foreground)';

/** 顶部筛选页签；`value: ''` 表示不带 status 参数的「全部」 */
export const CAPTURE_TABS: ReadonlyArray<{ label: string; value: CaptureStatus | '' }> = [
  { label: '全部', value: '' },
  { label: '待整理', value: CAPTURE_STATUS.INBOX },
  { label: '已整理', value: CAPTURE_STATUS.PROCESSED },
  { label: '已归档', value: CAPTURE_STATUS.ARCHIVED },
];

/**
 * 宽松取标签：认不出的状态**原样返回**，`undefined` 返回空串。
 * 这两条兜底路径复刻自被替换掉的 statusLabel()，别简化成返回 '未知'——
 * 后端将来加状态时，页面上直接显示原始枚举值比显示"未知"更好排查。
 */
export function captureStatusLabel(s?: string): string {
  return CAPTURE_STATUS_LABEL[s as CaptureStatus] ?? s ?? '';
}

/** 宽松取色：认不出的状态退回灰色（与原 statusStyle() 一致） */
export function captureStatusColor(s?: string): string {
  return CAPTURE_STATUS_COLOR[s as CaptureStatus] ?? CAPTURE_STATUS_FALLBACK_COLOR;
}
