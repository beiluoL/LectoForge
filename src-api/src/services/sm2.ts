/**
 * SM-2 间隔重复算法 —— 精确平移自 Web 端 WorkbenchServiceImpl.gradeReview。
 * 常量与公式与 Web 端保持一致，确保复习排程跨端不漂移（R2 风险）。
 *
 * ## 定点数约定
 * easeFactor（EF）在库中以「整数百分之一」存储：250 表示 2.50，130 表示 1.30。
 * 不用浮点是因为 SQLite REAL 的累计误差会让同一张卡在两端算出不同间隔；
 * 定点整数可保证逐位一致。对外暴露的 EF 一律是该整数域，÷100 才是教科书值。
 *
 * ## ⚠️ 已知算法边界：评分域不匹配（改动前必读）
 * 教科书 SM-2 评分域为 0..5，EF 增量 `0.1 - (5-q)(0.08 + (5-q)*0.02)`
 * 在 q=5 时为 +0.10、q=4 时 0.00、q=3 时 -0.14，即「答得好 EF 会涨」。
 * 但本实现把 quality 钳制在 **0..3**（见 gradeCard 首行），却仍套 5 分制公式，
 * 四档评分的实际 EF 增量为：
 *   q=3 → -0.14 ／ q=2 → -0.32 ／ q=1 → -0.54 ／ q=0 → -0.80
 * **任何评分下 EF 都单调下降**，长期复习后全部卡片会沉到 MIN_EF(1.30)，
 * 间隔增长退化为固定 ×1.3，「简单卡自动拉长间隔」的收益拿不到。
 *
 * 这是与 Web 端对齐的历史行为，**单改本端会立刻造成跨端排程漂移**。
 * 若要修正必须两端同步，可选方案：
 *   (a) 映射到 5 分制再入公式：`const q = quality * 5 / 3;`
 *   (b) 改用 Anki 变体，按档查表加减（q=3 时 +0.15）。
 * 修改前需评估存量卡片 EF 的迁移策略（是否统一回抬到 DEFAULT_EF）。
 */

/** 新卡初始 EF：2.50（定点 250） */
export const DEFAULT_EF = 250;
/** EF 下限：1.30（定点 130）。低于此值间隔增长已无意义，教科书规定截断 */
export const MIN_EF = 130;
/** 通过阈值：quality >= 2 视为想起来了；< 2 视为遗忘，触发 lapse 重排 */
export const PASS_QUALITY = 2;

/** 一张卡进入本次评分前的 SRS 状态快照（全部为定点整数 / 天数） */
export interface Sm2State {
  /** 熟练因子，定点百分之一，取值 [MIN_EF, +∞)，初始 DEFAULT_EF */
  easeFactor: number;
  /** 连续通过次数；一旦遗忘立即归零 */
  repetitions: number;
  /** 上次算出的复习间隔（天） */
  intervalDay: number;
  /** 累计遗忘次数，仅统计用，不参与排程 */
  lapseCount: number;
  /** 累计复习次数，仅统计用，不参与排程 */
  reviewCount: number;
}

/** 评分结果：新状态 + 本次判定，调用方据此回写数据库并算 nextReviewAt */
export interface Sm2Result extends Sm2State {
  /** 实际生效的评分（已钳制到 0..3） */
  quality: number;
  /** 本次是否判为遗忘（quality < PASS_QUALITY） */
  lapsed: boolean;
  /** 距下次复习的天数，等于 intervalDay，单独给出以便调用方直接加日期 */
  nextReviewDays: number;
}

/**
 * 对一张卡执行一次 SM-2 评分，返回新的排程状态。
 *
 * 纯函数：不读写数据库、不依赖当前时间，便于单测与跨端比对。
 * 调用方负责把 `nextReviewDays` 换算成 `nextReviewAt` 落库。
 *
 * 间隔阶梯（未遗忘时）：第 1 次通过 → 1 天，第 2 次 → 6 天，
 * 第 3 次起 → `上次间隔 × EF`（四舍五入）。遗忘则 repetitions 归零、间隔重置为 1 天。
 *
 * @param state 卡片当前 SRS 状态；各字段允许为 null/undefined，内部用 `??` 兜底为初值，
 *              因此新建卡片可直接传部分字段（如 `{ easeFactor: 0 } as Sm2State` 之外的空对象场景）。
 * @param qualityInput 用户评分，任意数字；内部先 `Math.round` 再钳制到 **0..3**
 *                     （0=完全忘 1=有印象 2=想起来了 3=秒答）。超界值不会抛错，静默截断。
 * @returns 新的 SRS 状态 + 本次判定。`easeFactor` 已应用 MIN_EF 下限；
 *          `intervalDay` 与 `nextReviewDays` 恒 >= 1，不会出现 0 天或负数间隔。
 */
export function gradeCard(state: Sm2State, qualityInput: number): Sm2Result {
  // 钳制到 0..3：上游可能传来滑杆浮点或越界值，这里静默截断而非抛错，
  // 保证复习流程不会因为一个脏评分中断。注意此处的 3 与上文「评分域不匹配」直接相关。
  const quality = Math.min(3, Math.max(0, Math.round(qualityInput)));
  let ef = state.easeFactor ?? DEFAULT_EF;
  let repetitions = state.repetitions ?? 0;
  let interval = state.intervalDay ?? 0;
  const lapsed = quality < PASS_QUALITY;

  // EF' = EF + (0.1 - (5-q)(0.08 + (5-q)*0.02))，下限 MIN_EF
  const q = quality;
  const efDouble = ef / 100 + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ef = Math.round(Math.max(MIN_EF / 100, efDouble) * 100);

  if (lapsed) {
    repetitions = 0;
    interval = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.round(interval * (ef / 100));
    }
  }

  const lapseCount = (state.lapseCount ?? 0) + (lapsed ? 1 : 0);
  const reviewCount = (state.reviewCount ?? 0) + 1;

  return {
    easeFactor: ef,
    repetitions,
    intervalDay: interval,
    lapseCount,
    reviewCount,
    quality,
    lapsed,
    nextReviewDays: interval,
  };
}
