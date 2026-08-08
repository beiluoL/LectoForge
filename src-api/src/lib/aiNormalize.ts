/**
 * LLM 输出清洗工具 —— 纯函数，无 IO、无 DB、无 HTTP 上下文。
 * 从 routes/ai.ts 原样搬出，供各 ai*Service 共用，行为一字未改。
 */

/** 把模型返回的分数收敛到 0~100 整数。 */
export function normalizeScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** 模型偶尔会把数组写成字符串，这里统一收敛为字符串数组并限长。 */
export function normalizeList(v: unknown, max = 5): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
      .slice(0, max);
  }
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/\n|；|;/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, max);
  }
  return [];
}
