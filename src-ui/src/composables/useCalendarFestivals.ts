/**
 * useCalendarFestivals —— 组合当月节日信息（纯前端，无后端请求）。
 *
 * 职责：以 `currentDate`（YYYY-MM-DD 锚点）为中心，为「视图覆盖的每一天」生成
 * 节日信息 map（key=YYYY-MM-DD，value=Festival | null），供月视图 / 周视图 /
 * 日视图直接取用，避免每个格子各自调用 getFestivalInfo 重复遍历。
 *
 * 与 useCalendarStore 的关系：**不改 store 结构**，本组合式是视图层独立的派生数据
 * （store 只负责 events / anniversaries 等业务数据；节日是纯展示信息）。
 * 视图组件在 script setup 里调用本函数，把 map 交给模板。
 *
 * 性能：一次视图渲染只遍历可见区间的天数（月 42 / 周 7 / 日 1），
 * 每次遍历调 getFestivalInfo（O(1) Map 查询），总成本可忽略。
 */
import { computed, type Ref } from 'vue';
import dayjs from 'dayjs';
import { buildCells, type CalendarViewMode } from '@/lib/calendar';
import { getFestivalInfo, type Festival } from '@/lib/festival';

/** 某天的「节日 + 纪念日」渲染信息 */
export interface DayFestivalInfo {
  /** 节日信息（法定/传统/现代/动态），无则 null */
  festival: Festival | null;
  /** 该日命中纪念日数量（>0 时渲染 Heart 徽章） */
  anniversaryCount: number;
}

/**
 * 生成视图覆盖区间内每一天的节日信息 map。
 *
 * @param currentDate 当前锚点日（YYYY-MM-DD），来自 store.currentDate
 * @param viewMode    当前视图模式（月 / 周 / 日）
 * @param anniversaryHit 判断某天是否命中纪念日的回调（由调用方注入，避免本文件依赖 store）
 * @returns key=YYYY-MM-DD → DayFestivalInfo
 */
export function useCalendarFestivals(
  currentDate: Ref<string>,
  viewMode: Ref<CalendarViewMode>,
  anniversaryHit?: (dateKey: string) => number,
) {
  /**
   * 视图覆盖的完整单元格（与 store.refreshCurrentView 用同一份 buildCells，
   * 保证「请求的天」和「渲染的天」边界一致）。
   */
  const cells = computed(() => buildCells(currentDate.value, viewMode.value));

  /** 每日节日信息 map：key=YYYY-MM-DD → DayFestivalInfo */
  const festivalsByDate = computed<Record<string, DayFestivalInfo>>(() => {
    const map: Record<string, DayFestivalInfo> = {};
    for (const cell of cells.value) {
      const festival = getFestivalInfo(cell.key);
      map[cell.key] = {
        festival,
        anniversaryCount: anniversaryHit ? anniversaryHit(cell.key) : 0,
      };
    }
    return map;
  });

  /** 取某天的节日信息（视图模板直接调用） */
  function festivalOf(dateKey: string): Festival | null {
    return festivalsByDate.value[dateKey]?.festival ?? null;
  }

  /** 取某天的纪念日数量 */
  function anniversaryCountOf(dateKey: string): number {
    return festivalsByDate.value[dateKey]?.anniversaryCount ?? 0;
  }

  /** 视图区间是否包含今天（周/日视图整列底色判断用） */
  function containsToday(): boolean {
    const today = dayjs().format('YYYY-MM-DD');
    return cells.value.some((c) => c.key === today);
  }

  return { cells, festivalsByDate, festivalOf, anniversaryCountOf, containsToday };
}
