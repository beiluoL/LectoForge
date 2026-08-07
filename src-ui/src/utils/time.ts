// 时间格式化工具：基于 dayjs，统一全项目的「相对时间」口径。
//
// 之所以不直接用 dayjs 的 relativeTime 插件：它的中文输出是「几秒前 / 1 天前」，
// 而设计稿要求的是更口语的「刚刚 / 5分钟前 / 昨天」。这里用 diff 手写阶梯，
// 保证文案可控，同时保留 dayjs 做日期解析与跨天判断（避免手算时区踩坑）。
import dayjs from 'dayjs';
import isYesterday from 'dayjs/plugin/isYesterday';
import isToday from 'dayjs/plugin/isToday';

dayjs.extend(isYesterday);
dayjs.extend(isToday);

/**
 * 人性化相对时间。
 * - < 1 分钟      → 刚刚
 * - < 60 分钟     → N分钟前
 * - 今天内        → N小时前
 * - 昨天          → 昨天 HH:mm
 * - 今年内        → M月D日
 * - 更早          → YYYY年M月D日
 */
export function fromNow(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = dayjs(input);
  if (!d.isValid()) return '';

  const now = dayjs();
  const diffMin = now.diff(d, 'minute');

  // 容忍轻微的服务端 / 客户端时钟偏差，未来时间一律显示「刚刚」
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (d.isToday()) return `${now.diff(d, 'hour')}小时前`;
  if (d.isYesterday()) return `昨天 ${d.format('HH:mm')}`;
  if (d.year() === now.year()) return d.format('M月D日');
  return d.format('YYYY年M月D日');
}

/** 绝对时间，用于 title 悬浮提示（相对时间看不出确切时刻时的补充） */
export function formatDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = dayjs(input);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '';
}
