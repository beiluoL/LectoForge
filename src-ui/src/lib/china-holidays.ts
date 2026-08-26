/**
 * 中国法定节假日数据包（离线本地，前端直用）。
 *
 * 数据范围：2024 / 2025 / 2026 三个完整年度（国务院办公厅每年公布的节假日安排）。
 * 包含两类条目：
 * - isOffDay: true  = 法定休息日（含调休拼出的连休）；
 * - isOffDay: false = 调休补班日（周末上班，日历上以「班」灰/橙标签提示）。
 *
 * 数据量每年约 30 条，直接放在前端 lib 不会显著增大构建产物（压缩后 < 2KB），
 * 且离线可用、无网络依赖，符合桌面应用「本地优先」的定位。
 *
 * ⚠️ 更新口径：每逢国务院公布下一年度安排后，在此追加新年度数据；
 * 未来若数据膨胀（>10 年）可改为后端静态资源 + GET /api/calendar/holidays 下发。
 */
export interface Holiday {
  /** 日期键 YYYY-MM-DD */
  date: string;
  /** 节日名称（如 元旦 / 春节 / 国庆节） */
  name: string;
  /** true = 休息日（休）；false = 调休补班日（班） */
  isOffDay: boolean;
}

export const CHINA_HOLIDAYS: Holiday[] = [
  /* ==================== 2024 年 ==================== */
  // 元旦：1/1 放假（1/1 周一，直接休）
  { date: '2024-01-01', name: '元旦', isOffDay: true },
  // 春节：2/10 除夕 ~ 2/17 初八 放假；2/4（周日）、2/18（周日）补班
  { date: '2024-02-04', name: '春节补班', isOffDay: false },
  { date: '2024-02-10', name: '春节', isOffDay: true },
  { date: '2024-02-11', name: '春节', isOffDay: true },
  { date: '2024-02-12', name: '春节', isOffDay: true },
  { date: '2024-02-13', name: '春节', isOffDay: true },
  { date: '2024-02-14', name: '春节', isOffDay: true },
  { date: '2024-02-15', name: '春节', isOffDay: true },
  { date: '2024-02-16', name: '春节', isOffDay: true },
  { date: '2024-02-17', name: '春节', isOffDay: true },
  { date: '2024-02-18', name: '春节补班', isOffDay: false },
  // 清明：4/4 ~ 4/6 放假；4/7（周日）补班
  { date: '2024-04-04', name: '清明节', isOffDay: true },
  { date: '2024-04-05', name: '清明节', isOffDay: true },
  { date: '2024-04-06', name: '清明节', isOffDay: true },
  { date: '2024-04-07', name: '清明补班', isOffDay: false },
  // 劳动节：5/1 ~ 5/5 放假；4/28（周日）、5/11（周六）补班
  { date: '2024-04-28', name: '劳动节补班', isOffDay: false },
  { date: '2024-05-01', name: '劳动节', isOffDay: true },
  { date: '2024-05-02', name: '劳动节', isOffDay: true },
  { date: '2024-05-03', name: '劳动节', isOffDay: true },
  { date: '2024-05-04', name: '劳动节', isOffDay: true },
  { date: '2024-05-05', name: '劳动节', isOffDay: true },
  { date: '2024-05-11', name: '劳动节补班', isOffDay: false },
  // 端午：6/8 ~ 6/10 放假（6/10 端午周一）
  { date: '2024-06-08', name: '端午节', isOffDay: true },
  { date: '2024-06-09', name: '端午节', isOffDay: true },
  { date: '2024-06-10', name: '端午节', isOffDay: true },
  // 中秋：9/15 ~ 9/17 放假；9/14（周六）补班
  { date: '2024-09-14', name: '中秋补班', isOffDay: false },
  { date: '2024-09-15', name: '中秋节', isOffDay: true },
  { date: '2024-09-16', name: '中秋节', isOffDay: true },
  { date: '2024-09-17', name: '中秋节', isOffDay: true },
  // 国庆：10/1 ~ 10/7 放假；9/29（周日）、10/12（周六）补班
  { date: '2024-09-29', name: '国庆补班', isOffDay: false },
  { date: '2024-10-01', name: '国庆节', isOffDay: true },
  { date: '2024-10-02', name: '国庆节', isOffDay: true },
  { date: '2024-10-03', name: '国庆节', isOffDay: true },
  { date: '2024-10-04', name: '国庆节', isOffDay: true },
  { date: '2024-10-05', name: '国庆节', isOffDay: true },
  { date: '2024-10-06', name: '国庆节', isOffDay: true },
  { date: '2024-10-07', name: '国庆节', isOffDay: true },
  { date: '2024-10-12', name: '国庆补班', isOffDay: false },

  /* ==================== 2025 年 ==================== */
  // 元旦：1/1 放假（周三）
  { date: '2025-01-01', name: '元旦', isOffDay: true },
  // 春节：1/28 除夕 ~ 2/4 初七 放假；1/26（周日）、2/8（周六）补班
  { date: '2025-01-26', name: '春节补班', isOffDay: false },
  { date: '2025-01-28', name: '春节', isOffDay: true },
  { date: '2025-01-29', name: '春节', isOffDay: true },
  { date: '2025-01-30', name: '春节', isOffDay: true },
  { date: '2025-01-31', name: '春节', isOffDay: true },
  { date: '2025-02-01', name: '春节', isOffDay: true },
  { date: '2025-02-02', name: '春节', isOffDay: true },
  { date: '2025-02-03', name: '春节', isOffDay: true },
  { date: '2025-02-04', name: '春节', isOffDay: true },
  { date: '2025-02-08', name: '春节补班', isOffDay: false },
  // 清明：4/4 ~ 4/6 放假（4/4 清明周五，无补班）
  { date: '2025-04-04', name: '清明节', isOffDay: true },
  { date: '2025-04-05', name: '清明节', isOffDay: true },
  { date: '2025-04-06', name: '清明节', isOffDay: true },
  // 劳动节：5/1 ~ 5/5 放假；4/27（周日）补班
  { date: '2025-04-27', name: '劳动节补班', isOffDay: false },
  { date: '2025-05-01', name: '劳动节', isOffDay: true },
  { date: '2025-05-02', name: '劳动节', isOffDay: true },
  { date: '2025-05-03', name: '劳动节', isOffDay: true },
  { date: '2025-05-04', name: '劳动节', isOffDay: true },
  { date: '2025-05-05', name: '劳动节', isOffDay: true },
  // 端午：5/31 ~ 6/2 放假（5/31 端午周六，无补班）
  { date: '2025-05-31', name: '端午节', isOffDay: true },
  { date: '2025-06-01', name: '端午节', isOffDay: true },
  { date: '2025-06-02', name: '端午节', isOffDay: true },
  // 国庆 + 中秋：10/1 ~ 10/8 放假；9/28（周日）、10/11（周六）补班
  { date: '2025-09-28', name: '国庆补班', isOffDay: false },
  { date: '2025-10-01', name: '国庆节', isOffDay: true },
  { date: '2025-10-02', name: '国庆节', isOffDay: true },
  { date: '2025-10-03', name: '国庆节', isOffDay: true },
  { date: '2025-10-04', name: '国庆节', isOffDay: true },
  { date: '2025-10-05', name: '国庆节', isOffDay: true },
  { date: '2025-10-06', name: '中秋节', isOffDay: true },
  { date: '2025-10-07', name: '国庆节', isOffDay: true },
  { date: '2025-10-08', name: '国庆节', isOffDay: true },
  { date: '2025-10-11', name: '国庆补班', isOffDay: false },

  /* ==================== 2026 年 ==================== */
  // 元旦：1/1 ~ 1/3 放假（1/1 周四，连休 3 天，无补班）
  { date: '2026-01-01', name: '元旦', isOffDay: true },
  { date: '2026-01-02', name: '元旦', isOffDay: true },
  { date: '2026-01-03', name: '元旦', isOffDay: true },
  // 春节：2/15 除夕 ~ 2/22 初七 放假；2/14（周六）、2/28（周六）补班
  { date: '2026-02-14', name: '春节补班', isOffDay: false },
  { date: '2026-02-15', name: '春节', isOffDay: true },
  { date: '2026-02-16', name: '春节', isOffDay: true },
  { date: '2026-02-17', name: '春节', isOffDay: true },
  { date: '2026-02-18', name: '春节', isOffDay: true },
  { date: '2026-02-19', name: '春节', isOffDay: true },
  { date: '2026-02-20', name: '春节', isOffDay: true },
  { date: '2026-02-21', name: '春节', isOffDay: true },
  { date: '2026-02-22', name: '春节', isOffDay: true },
  { date: '2026-02-28', name: '春节补班', isOffDay: false },
  // 清明：4/4 ~ 4/6 放假（4/5 清明周日，无补班）
  { date: '2026-04-04', name: '清明节', isOffDay: true },
  { date: '2026-04-05', name: '清明节', isOffDay: true },
  { date: '2026-04-06', name: '清明节', isOffDay: true },
  // 劳动节：5/1 ~ 5/5 放假；4/26（周日）、5/9（周六）补班
  { date: '2026-04-26', name: '劳动节补班', isOffDay: false },
  { date: '2026-05-01', name: '劳动节', isOffDay: true },
  { date: '2026-05-02', name: '劳动节', isOffDay: true },
  { date: '2026-05-03', name: '劳动节', isOffDay: true },
  { date: '2026-05-04', name: '劳动节', isOffDay: true },
  { date: '2026-05-05', name: '劳动节', isOffDay: true },
  { date: '2026-05-09', name: '劳动节补班', isOffDay: false },
  // 端午：6/19 ~ 6/21 放假（6/19 端午周五，无补班）
  { date: '2026-06-19', name: '端午节', isOffDay: true },
  { date: '2026-06-20', name: '端午节', isOffDay: true },
  { date: '2026-06-21', name: '端午节', isOffDay: true },
  // 中秋：9/25 ~ 9/27 放假（9/25 中秋周五，无补班）
  { date: '2026-09-25', name: '中秋节', isOffDay: true },
  { date: '2026-09-26', name: '中秋节', isOffDay: true },
  { date: '2026-09-27', name: '中秋节', isOffDay: true },
  // 国庆：10/1 ~ 10/7 放假；9/20（周日）、10/10（周六）补班
  { date: '2026-09-20', name: '国庆补班', isOffDay: false },
  { date: '2026-10-01', name: '国庆节', isOffDay: true },
  { date: '2026-10-02', name: '国庆节', isOffDay: true },
  { date: '2026-10-03', name: '国庆节', isOffDay: true },
  { date: '2026-10-04', name: '国庆节', isOffDay: true },
  { date: '2026-10-05', name: '国庆节', isOffDay: true },
  { date: '2026-10-06', name: '国庆节', isOffDay: true },
  { date: '2026-10-07', name: '国庆节', isOffDay: true },
  { date: '2026-10-10', name: '国庆补班', isOffDay: false },
];

/** 日期键 → 节假日条目 的索引（一次性构建，避免逐格 filter） */
const holidayByDate = new Map<string, Holiday>(CHINA_HOLIDAYS.map((h) => [h.date, h]));

/**
 * 取某天的节假日信息（无则返回 undefined）。
 * @param dateKey 本地日键 YYYY-MM-DD
 */
export function getHoliday(dateKey: string): Holiday | undefined {
  return holidayByDate.get(dateKey);
}

/**
 * 判断某天是否为法定休息日（「休」标签）。
 * 纯休息日判断，不含补班日——补班日虽然也是法定安排，但语义相反。
 */
export function isHolidayOff(dateKey: string): boolean {
  return holidayByDate.get(dateKey)?.isOffDay === true;
}

/**
 * 判断某天是否为调休补班日（「班」标签）。
 */
export function isMakeupWorkday(dateKey: string): boolean {
  const h = holidayByDate.get(dateKey);
  return !!h && !h.isOffDay;
}
