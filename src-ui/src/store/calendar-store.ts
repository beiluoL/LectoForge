/**
 * useCalendarStore —— 日历视图全局状态。
 *
 * 设计要点：
 * - `events` 只保存「当前视图覆盖区间」内的事件，由 `fetchEvents(start, end)` 拉取。
 *   🔴 性能红线：日历**永远**按日期范围查询，绝不存在「全量拉取」形态；
 *   翻页/切视图时调用方负责算出正确的 start_date / end_date 再请求。
 * - `eventsByDate` 是唯一的按日索引派生：把每条事件展开到它覆盖的所有本地日键上
 *   （跨天事件会同时挂在多天），月视图的 42 个格子直接读这个 map，而不是各自 filter
 *   一遍 events——事件多了一屏能省几十次遍历。
 * - createEvent / updateEvent / deleteEvent 统一「乐观更新 + 失败回滚」：
 *   create 走「成功后重拉当前视图」（新事件该排哪一天由后端/范围决定，前端猜不准）；
 *   update / delete 先就地改，失败再回滚。
 *
 * ID 不可变：defineStore 第一参数 'calendar' 是 store 的唯一标识，永不修改。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import dayjs from 'dayjs';
import {
  createCalendarEvent as apiCreateEvent,
  deleteCalendarEvent as apiDeleteEvent,
  fetchCalendarEvents,
  updateCalendarEvent as apiUpdateEvent,
  type CalendarEvent,
  type CreateCalendarEventInput,
  type UpdateCalendarEventInput,
} from '@/api/calendar';
import {
  coveredDayKeys,
  shiftAnchor,
  todayKey,
  visibleRange,
  type CalendarViewMode,
} from '@/lib/calendar';
import { notify } from '@/utils/toast';

/**
 * 本地时间 → UTC ISO 的三种收敛口径（集中在一处，避免时区对不齐）。
 *
 * 库里 start_time / end_time 一律存 UTC ISO，这样「字符串字典序 === 时间先后序」，
 * 范围查询能直接吃 (user_id, start_time) 索引。dayjs 默认把无时区串当本机时区解析，
 * 因此下面三个函数吃进来的都是「本地」值：
 *
 * - toUtcIsoExact：定时事件的起止，保留精确时刻（不做日界裁剪）；
 * - startOfDayUtc：全天事件的开始，归一到当天 00:00；
 * - endOfDayUtc：全天事件的结束，归一到当天 23:59:59.999。
 *
 * 非法值退化为「此刻」，保证请求永远能发出去（脏数据不会卡死整个日历）。
 */
function toUtcIsoExact(local: string | null | undefined): string {
  const d = dayjs(local);
  return d.isValid() ? d.toISOString() : dayjs().toISOString();
}
function startOfDayUtc(local: string | null | undefined): string {
  const d = dayjs(local);
  return d.isValid() ? d.startOf('day').toISOString() : dayjs().startOf('day').toISOString();
}
function endOfDayUtc(local: string | null | undefined): string {
  const d = dayjs(local);
  return d.isValid() ? d.endOf('day').toISOString() : dayjs().endOf('day').toISOString();
}

/** 把表单里的本地日期/时刻串归一成后端要的 UTC ISO 载荷 */
function normalizePayload(data: CreateCalendarEventInput): CreateCalendarEventInput {
  const isAllDay = data.isAllDay === true || data.isAllDay === 1 ? 1 : 0;
  if (isAllDay) {
    // 全天：开始取当天 00:00，结束取当天 23:59:59.999（空集则同天）
    return {
      ...data,
      isAllDay: 1,
      startTime: startOfDayUtc(data.startTime),
      endTime: data.endTime ? endOfDayUtc(data.endTime) : endOfDayUtc(data.startTime),
    };
  }
  return {
    ...data,
    isAllDay: 0,
    startTime: toUtcIsoExact(data.startTime),
    endTime: data.endTime ? toUtcIsoExact(data.endTime) : null,
  };
}

export const useCalendarStore = defineStore('calendar', () => {
  /** 当前视图区间内的全部事件（单一真相源，视图只从它派生） */
  const events = ref<CalendarEvent[]>([]);
  /** 当前聚焦的本地日键 YYYY-MM-DD */
  const currentDate = ref<string>(todayKey());
  /** 视图模式：月 / 周 / 日 */
  const viewMode = ref<CalendarViewMode>('month');
  const loading = ref(false);
  const error = ref('');

  /**
   * 按本地日键索引的事件表：key=YYYY-MM-DD，value=该日事件数组。
   * 每条事件通过 coveredDayKeys 展开到它覆盖的全部天（跨天事件多天命中）。
   * 数组按「全天优先、再按开始时刻」排序，和后端 listEventsInRange 的口径一致。
   */
  const eventsByDate = computed<Record<string, CalendarEvent[]>>(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events.value) {
      const keys = coveredDayKeys(ev.startTime, ev.endTime);
      for (const key of keys) {
        (map[key] ??= []).push(ev);
      }
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
        return a.startTime.localeCompare(b.startTime);
      });
    }
    return map;
  });

  /** 拉取指定区间的事件（性能红线：两个参数都必填） */
  async function fetchEvents(startDate: string, endDate: string) {
    loading.value = true;
    error.value = '';
    try {
      events.value = await fetchCalendarEvents(startDate, endDate);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '日历事件加载失败';
      events.value = [];
      notify(error.value, 'error');
    } finally {
      loading.value = false;
    }
  }

  /**
   * 重拉「当前视图」覆盖的区间。
   * 视图层翻页/切换模式/首屏挂载时调用；区间来自 lib/calendar 的 visibleRange，
   * 与渲染网格的边界是同一份计算，保证「请求的天」和「显示的天」永远对齐。
   */
  async function refreshCurrentView() {
    const { start, end } = visibleRange(currentDate.value, viewMode.value);
    await fetchEvents(start, end);
  }

  /** 切换聚焦日期（通常也切换 currentDate） */
  function setCurrentDate(key: string) {
    currentDate.value = key;
  }

  /** 切换视图模式后，立即按新模式重拉区间 */
  async function setViewMode(mode: CalendarViewMode) {
    viewMode.value = mode;
    await refreshCurrentView();
  }

  /** 翻页：按当前模式前进/后退 delta 步（月+1月 / 周+1周 / 日+1天） */
  async function shift(delta: number) {
    currentDate.value = shiftAnchor(currentDate.value, viewMode.value, delta);
    await refreshCurrentView();
  }

  /** 回到今天 */
  async function goToday() {
    currentDate.value = todayKey();
    await refreshCurrentView();
  }

  /** 新建事件（normalize 到 UTC ISO，成功后重拉当前视图） */
  async function createEvent(data: CreateCalendarEventInput): Promise<CalendarEvent | undefined> {
    const payload = normalizePayload(data);
    try {
      const created = await apiCreateEvent(payload);
      await refreshCurrentView();
      notify('事件已创建', 'success');
      return created;
    } catch (e) {
      notify(e instanceof Error ? e.message : '创建失败', 'error');
      return undefined;
    }
  }

  /** 局部更新（乐观替换，失败回滚整段重拉） */
  async function updateEvent(id: number, data: UpdateCalendarEventInput): Promise<CalendarEvent | undefined> {
    const idx = events.value.findIndex((e) => e.id === id);
    if (idx === -1) return undefined;
    const prev = events.value[idx];
    const merged: CalendarEvent = { ...prev, ...data } as CalendarEvent;
    events.value[idx] = merged; // 乐观
    try {
      const updated = await apiUpdateEvent(id, normalizePayload(data as CreateCalendarEventInput));
      events.value[idx] = updated;
      return updated;
    } catch (e) {
      events.value[idx] = prev; // 回滚
      notify(e instanceof Error ? e.message : '更新失败', 'error');
      return undefined;
    }
  }

  /** 删除事件（乐观摘除，失败插回原索引） */
  async function deleteEvent(id: number): Promise<boolean> {
    const idx = events.value.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const [removed] = events.value.splice(idx, 1);
    try {
      await apiDeleteEvent(id);
      notify('事件已删除', 'success');
      return true;
    } catch (e) {
      events.value.splice(Math.min(idx, events.value.length), 0, removed);
      notify(e instanceof Error ? e.message : '删除失败', 'error');
      return false;
    }
  }

  return {
    events,
    currentDate,
    viewMode,
    loading,
    error,
    eventsByDate,
    fetchEvents,
    refreshCurrentView,
    setCurrentDate,
    setViewMode,
    shift,
    goToday,
    createEvent,
    updateEvent,
    deleteEvent,
  };
});
