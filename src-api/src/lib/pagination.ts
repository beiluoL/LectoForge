import type { PageQuery, ResolvedPage } from '../types/pagination';

/**
 * 未显式分页时兜底的安全上限。
 *
 * 为什么不是 20：本项目现有前端列表页（笔记 / 收集箱 / 卡片）都是「一次拉全量、
 * 前端自己过滤」的实现。若默认值取 20，升级瞬间用户会看到列表凭空少掉大半数据，
 * 属于破坏性变更。200 的定位是**安全网而非分页**——它拦住的是 SQLite 单查询
 * 返回上万行拖垮主线程的极端情况，同时对绝大多数真实用户（笔记数 < 200）完全无感。
 * 待前端列表接入 page/pageSize 后，可再把此值下调到 20/50。
 */
export const DEFAULT_PAGE_SIZE = 200;

/**
 * 单页硬上限。即使调用方显式传 pageSize=999999 也会被钳到这里，
 * 防止恶意/误写的入参把 better-sqlite3 的同步查询变成长时间阻塞。
 */
export const MAX_PAGE_SIZE = 500;

/**
 * 「已接入滚动加载」的接口所用的默认每页条数。
 *
 * 与 DEFAULT_PAGE_SIZE 分开定义，是因为两者语义完全不同：
 * - DEFAULT_PAGE_SIZE(200) 是**兜底安全网**，给还在一次性拉全量的老接口用；
 * - NOTES_PAGE_SIZE(30)   是**真正的分页粒度**，只给前端已能自行翻页的接口用。
 *
 * 30 的取法：常见桌面窗口下笔记网格一屏约 9~12 张卡，30 条 ≈ 2.5 屏，
 * 既保证首屏立刻填满、又留出足够缓冲让用户滚到底前就触发下一页预加载。
 *
 * ⚠️ 给某个接口切到这个值之前，必须先确认它的前端调用方已实现「加载更多」，
 * 否则用户会静默丢数据——这正是当初把全局默认设成 200 而非 20 的原因。
 */
export const NOTES_PAGE_SIZE = 30;

/** 把可能为字符串（query string 来的）的值转成正整数，失败返回 undefined。 */
function toPositiveInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  return i > 0 ? i : undefined;
}

/** 把可能为字符串的值转成非负整数（offset 允许 0），失败返回 undefined。 */
function toNonNegativeInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  return i >= 0 ? i : undefined;
}

/**
 * 从 Fastify 原始 query 对象里抽出分页四件套，转成强类型 PageQuery。
 *
 * 存在的意义：query string 里所有值都是 string，而 PageQuery 声明的是 number。
 * Controller 层用这个助手一行完成「抽取 + 类型转换」，既不用写 `as any`，
 * 也不用在每个 controller 里重复四行 Number() 样板。
 *
 * @param raw req.query（可为 undefined）
 * @returns 只含已成功解析字段的 PageQuery；全部缺省时返回空对象
 *
 * @example
 * const params: ListNoteQuery = { keyword: q.keyword, ...pickPage(req.query) };
 */
export function pickPage(raw: unknown): PageQuery {
  const q = (raw ?? {}) as Record<string, unknown>;
  const out: PageQuery = {};
  const page = toPositiveInt(q.page);
  const pageSize = toPositiveInt(q.pageSize ?? q.page_size);
  const limit = toPositiveInt(q.limit);
  const offset = toNonNegativeInt(q.offset);
  if (page !== undefined) out.page = page;
  if (pageSize !== undefined) out.pageSize = pageSize;
  if (limit !== undefined) out.limit = limit;
  if (offset !== undefined) out.offset = offset;
  return out;
}

/**
 * 把外部传入的分页意图归一化成 { limit, offset }。
 *
 * 该函数**永远返回有限的 limit**，这是它存在的全部意义：调用方只要接上它，
 * 就不可能再写出无上限的全表扫描。
 *
 * 两种写法都支持，page/pageSize 优先于 limit/offset：
 * 前者是给 UI 分页器用的，后者是给游标式滚动加载用的，同时传时以前者为准。
 *
 * @param q        原始 query 对象（字段可能是字符串，已内部做数字转换）
 * @param fallback 该接口未传参时的默认每页条数，缺省 DEFAULT_PAGE_SIZE；
 *                 已接入滚动加载的接口应显式传 NOTES_PAGE_SIZE
 * @returns        可直接用于 Drizzle `.limit(x).offset(y)` 的参数
 *
 * @example
 * const { limit, offset } = resolvePage(q, NOTES_PAGE_SIZE);
 * db.select().from(t).where(cond).limit(limit).offset(offset).all();
 */
export function resolvePage(q: PageQuery | undefined, fallback = DEFAULT_PAGE_SIZE): ResolvedPage {
  const page = toPositiveInt(q?.page);
  const pageSize = toPositiveInt(q?.pageSize);

  // 写法一：page/pageSize（优先）
  if (page !== undefined || pageSize !== undefined) {
    const size = Math.min(pageSize ?? fallback, MAX_PAGE_SIZE);
    const p = page ?? 1;
    return { limit: size, offset: (p - 1) * size };
  }

  // 写法二：limit/offset
  const limit = toPositiveInt(q?.limit);
  const offset = toNonNegativeInt(q?.offset);
  return {
    limit: Math.min(limit ?? fallback, MAX_PAGE_SIZE),
    offset: offset ?? 0,
  };
}
