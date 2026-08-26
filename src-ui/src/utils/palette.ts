/**
 * JS 侧数据色板：与 style.css 的 --kb-chart-* 令牌同源（双主题联动）。
 * 禁止在组件里再写死图表/模块/事件色；统一经 getChartPalette() / chartColor() 取色。
 */
export const CHART_TOKENS = [
  '--kb-chart-1',
  '--kb-chart-2',
  '--kb-chart-3',
  '--kb-chart-4',
  '--kb-chart-5',
  '--kb-chart-6',
] as const

/** 读取失败时的兜底（浅色主题值，仅用于 SSR / 极端环境） */
export const CHART_FALLBACK = ['#3B6FE0', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#14B8A6']

/** 读取当前主题下的 6 色 chart 色板（深色主题自动取提亮档） */
export function getChartPalette(): string[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [...CHART_FALLBACK]
  const cs = getComputedStyle(document.documentElement)
  return CHART_TOKENS.map((token, i) => cs.getPropertyValue(token).trim() || CHART_FALLBACK[i])
}

/** 取第 i 个 chart 色（循环取模） */
export function chartColor(i: number): string {
  themeTick.value // 建立响应依赖
  const idx = ((i % 6) + 6) % 6
  return getChartPalette()[idx]
}

/** 第 i 个 chart 色的软背景 CSS 变量引用（用于 color-mix / background） */
export function chartSoftVar(i: number): string {
  const idx = ((i % 6) + 6) % 6 + 1
  return `var(--kb-chart-${idx}-soft)`
}

/** 读取任意 CSS 令牌的当前实色（JS 存储 / 数据交换场景需要真实色值时使用） */
export function cssToken(name: string, fallback: string): string {
  themeTick.value
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
import { ref } from 'vue'

/**
 * 主题响应信号：data-theme / data-accent 变化时自增，
 * 让基于 chartColor()/cssToken() 的 computed 自动重算（主题切换后图表/模块色即时换档）。
 */
const themeTick = ref(0)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const mo = new MutationObserver(() => {
    themeTick.value++
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] })
}
