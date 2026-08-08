/**
 * 分页契约（纯类型，无运行时值 —— 遵守 types/ 层边界约定）。
 *
 * 设计取舍：本项目所有 list 接口对外返回的都是**裸数组**（由 index.ts 的 onSend
 * 统一包信封）。为了不破坏既有前端契约，分页采用「入参扩展、出参不变」的方式：
 * 只在 query 上追加可选的 page/pageSize，返回值仍是 T[]，不改成 { items, total }。
 *
 * 两套写法都支持，优先级 page/pageSize > limit/offset：
 *   - 业务侧友好：?page=2&pageSize=20
 *   - 贴近 SQL：  ?limit=20&offset=20
 */
export interface PageQuery {
  /** 页码，从 1 开始。传 0 或负数按 1 处理。 */
  page?: number;
  /** 每页条数，受 MAX_PAGE_SIZE 钳制。 */
  pageSize?: number;
  /** 直接指定 SQL LIMIT（page/pageSize 存在时被忽略）。 */
  limit?: number;
  /** 直接指定 SQL OFFSET（page/pageSize 存在时被忽略）。 */
  offset?: number;
}

/** 归一化后的分页参数，可直接喂给 Drizzle 的 .limit()/.offset()。 */
export interface ResolvedPage {
  limit: number;
  offset: number;
}
