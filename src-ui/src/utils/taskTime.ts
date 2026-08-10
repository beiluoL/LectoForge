/**
 * 任务「具体时刻」的 UI 层旁路存储。
 *
 * 为什么需要这么一层：后端 `wb_task` 只有 `target_date` / `due_date` 两列，
 * 且 `taskService.normalizeDate()` 用 /^\d{4}-\d{2}-\d{2}$/ 硬校验，
 * 往里塞 "2026-08-11 15:00" 会直接被 controller 翻成 400。
 * 本次是纯 UI 层的控件替换，不允许动后端契约与 `taskStore.updateTask`，
 * 所以「几点做」先落在浏览器本地，日期仍然唯一以服务端为准：
 *
 *   localStorage key = lf.task.time.v1
 *   value            = { [taskId]: 'HH:mm' }
 *
 * 迁移路径：后端若补上 `target_time` 列，只需把下面两个函数改成读写 task 字段，
 * 调用方（TaskItem.vue）一行都不用动。
 */
import { reactive } from 'vue';

const STORAGE_KEY = 'lf.task.time.v1';
/** 只接受 00:00 – 23:59，脏数据一律丢弃，避免旧版本 / 手改 localStorage 污染面板 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && HHMM.test(v)) clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

/** 单例响应式表：多个 TaskItem 共享，写入后所有胶囊自动重渲染 */
const timeMap = reactive<Record<string, string>>(load());

function flush(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timeMap));
  } catch {
    /* 隐私模式 / 配额满：时刻退化成本次会话有效，不影响日期落库 */
  }
}

/** 读某条任务的时刻；未设置（全天）返回 null */
export function readTaskTime(taskId: number): string | null {
  return timeMap[String(taskId)] ?? null;
}

/** 写入时刻；传 null 表示「全天」，会把该任务的记录删掉 */
export function writeTaskTime(taskId: number, time: string | null): void {
  const key = String(taskId);
  if (time && HHMM.test(time)) {
    timeMap[key] = time;
  } else {
    delete timeMap[key];
  }
  flush();
}
