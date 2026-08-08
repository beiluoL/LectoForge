/**
 * 数据迁移模块类型契约 —— 纯类型文件，不得出现任何运行时值。
 *
 * 消费的是 Web 端 GET /api/workbench/export 产出的 JSON。两端字段已对齐（均为 Wb* 契约），
 * 但导出侧的字段类型偏宽松（时间可能是 Date / 字符串 / 数字，数值可能是字符串），
 * 因此这里刻意用宽松的 AnyRow 承接，收敛动作全部交给 Service 的 normIso / num / numOrNull。
 */

/** 导出 JSON 里的一行记录，字段形态由 Web 端决定，此处不做强约束 */
export type AnyRow = Record<string, any>;

/** 导入载荷：可能是 { data: {...} } 包装体，也可能是裸的数据对象 */
export interface ImportPayload {
  data?: AnyRow;
  [key: string]: unknown;
}

/** 各集合实际落库条数 */
export interface ImportSummary {
  captures: number;
  notes: number;
  palaces: number;
  reviewCards: number;
  reviewLogs: number;
  palaceLoci: number;
  recallSessions: number;
  stories: number;
}

export interface ImportResultVO {
  ok: true;
  imported: ImportSummary;
}

/**
 * Service 层不接触 FastifyReply，只回报「失败成什么样」，由 Controller 翻译成 HTTP 状态码：
 * - missingData      → 400 缺少 data 对象
 * - emptyCollections → 400 data 里一个已知集合都没有
 * - conflict         → 409 本地已有数据，拒绝重复导入
 */
export type ImportOutcome =
  | { kind: 'ok'; data: ImportResultVO }
  | { kind: 'missingData' }
  | { kind: 'emptyCollections' }
  | { kind: 'conflict' };
