/* 四象限视图层的展示元数据。
 *
 * 单独成文件而不是塞进 QuadrantCard.vue：`<script setup>` 不允许出现 export 语句，
 * 而卡片组件和弹窗都要引用同一份 QuadrantMeta，只能提到外面来。
 */
import type { QuadrantGroupKey, QuadrantKey } from '@/api/quadrant';

export interface QuadrantMeta {
  /** 业务枚举（连字符），提交给后端用 */
  key: QuadrantKey;
  /** 响应分组键（下划线），从 store.tasks 取数用 */
  group: QuadrantGroupKey;
  /** 罗马序号 Ⅰ~Ⅳ */
  order: string;
  label: string;
  /** 一句话行动建议：立刻做 / 计划做 / 委托做 / 尽量别做 */
  hint: string;
  /** lucide 图标名 */
  icon: string;
  /** 强色，一律取自 --kb-* token，禁止写死十六进制 */
  color: string;
}

/**
 * 四象限配置的唯一定义处（页面、卡片、弹窗共用这一份）。
 *
 * 配色映射说明：项目 token 里没有 success / info 两色，因此
 * 蓝借 --kb-primary、绿借 --kb-accent，红黄直接对应 destructive / warning。
 * 顺序即 2×2 网格的渲染顺序：Ⅰ左上 Ⅱ右上 Ⅲ左下 Ⅳ右下。
 */
export const QUADRANTS: QuadrantMeta[] = [
  {
    key: 'urgent-important',
    group: 'urgent_important',
    order: 'Ⅰ',
    label: '重要且紧急',
    hint: '立刻做',
    icon: 'flame',
    color: 'var(--kb-destructive)',
  },
  {
    key: 'not-urgent-important',
    group: 'not_urgent_important',
    order: 'Ⅱ',
    label: '重要不紧急',
    hint: '计划做',
    icon: 'target',
    color: 'var(--kb-warning)',
  },
  {
    key: 'urgent-not-important',
    group: 'urgent_not_important',
    order: 'Ⅲ',
    label: '紧急不重要',
    hint: '能委托就委托',
    icon: 'zap',
    color: 'var(--kb-primary)',
  },
  {
    key: 'not-urgent-not-important',
    group: 'not_urgent_not_important',
    order: 'Ⅳ',
    label: '不重要不紧急',
    hint: '尽量别做',
    icon: 'coffee',
    color: 'var(--kb-accent)',
  },
];
