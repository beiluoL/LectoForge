/**
 * 数据导出（CSV）：复习记录 / 习惯打卡 / 任务清单。
 * 纯读取聚合，返回带 UTF-8 BOM 的 CSV 文本；controller 负责 Content-Disposition。
 */
import { db } from '../db';
import { wbReviewLog, wbHabit, wbHabitLog, wbTask } from '../db/schema';

/** 简单 CSV 转义：含逗号 / 引号 / 换行时加引号并转义内部引号 */
function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: (string | number | null)[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/** 复习记录：wb_review_log 全量（含旧卡组 NULL sourceType 行） */
export function exportReviewsCsv(): string {
  const rows = db.select().from(wbReviewLog).all();
  const lines: (string | number | null)[][] = [
    ['id', 'card_id', 'source_type', 'quality', 'interval_day', 'ease_factor', 'reviewed_at'],
  ];
  for (const r of rows) {
    lines.push([r.id, r.cardId, r.sourceType, r.quality, r.intervalDay, r.easeFactor, r.reviewedAt]);
  }
  return csv(lines);
}

/** 习惯打卡：习惯 + 打卡明细（按习惯名 / 日期排序） */
export function exportHabitsCsv(): string {
  const habits = db.select().from(wbHabit).all();
  const logs = db.select().from(wbHabitLog).all();
  const nameOf = new Map(habits.map((h) => [h.id, h.name]));
  const lines: (string | number | null)[][] = [
    ['habit_id', 'habit_name', 'log_date', 'status', 'note'],
  ];
  const sorted = [...logs].sort((a, b) => a.habitId - b.habitId || a.logDate.localeCompare(b.logDate));
  for (const l of sorted) {
    lines.push([l.habitId, nameOf.get(l.habitId) ?? '', l.logDate, l.status, l.note]);
  }
  return csv(lines);
}

/** 任务清单：wb_task 全量（含完成态 / 截止日） */
export function exportTasksCsv(): string {
  const rows = db.select().from(wbTask).all();
  const lines: (string | number | null)[][] = [
    ['id', 'title', 'status', 'completed', 'target_date', 'due_date', 'completed_at', 'list_id', 'parent_task_id'],
  ];
  for (const t of rows) {
    lines.push([
      t.id,
      t.title,
      t.status,
      t.completed,
      t.targetDate,
      t.dueDate,
      t.completedAt,
      t.listId,
      t.parentTaskId,
    ]);
  }
  return csv(lines);
}
