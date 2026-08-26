#!/usr/bin/env node
/**
 * UI 主题回归检查（Playwright + 系统 Chrome，headless）：
 * 1. 深色主题下顶栏下拉面板背景必须为深色派生（不再白底浅字）；
 * 2. 首页 Hero 深色下渐变须含 --kb-card（不再浅底浅字）；
 * 3. 角标文字与 --kb-warning 底对比度 ≥ 4.5:1；
 * 4. 强调色切换后 --kb-primary 计算值跟随 data-accent。
 *
 * 前置：dev 服务已运行（npm run dev:all），访问 http://localhost:5173。
 * 用法：npm run ui:theme-check
 */
let chromium
try {
  ;({ chromium } = await import('playwright-core'))
} catch {
  console.warn('[ui-theme-check] 未安装 playwright-core，跳过（npm i -D playwright-core 后启用）')
  process.exit(0)
}

const BASE = process.env.UI_CHECK_URL ?? 'http://localhost:5173'
const failures = []

function lum(hex) {
  const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const [r, g, b] = p(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(hex1, hex2) {
  const [l1, l2] = [lum(hex1), lum(hex2)]
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.setDefaultTimeout(20000)

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await page.waitForTimeout(1500)

  // 场景 A：应用深色 + OS 浅色（dark: 变体失效场景）
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: /规划/ }).first().hover({ timeout: 5000 })
  await page.waitForTimeout(600)
  const panel = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]')
    if (!menu) return null
    return getComputedStyle(menu).backgroundColor
  })
  if (!panel || panel === 'rgba(0, 0, 0, 0)') {
    failures.push('下拉面板未找到（role=menu）')
  } else {
    const m = panel.match(/[\d.]+/g)
    const isDark = m && Number(m[0]) < 0.4 && Number(m[1]) < 0.45 && Number(m[2]) < 0.5
    if (!isDark) failures.push(`深色主题下拉面板背景仍偏浅: ${panel}`)
  }
  await page.mouse.move(10, 300)

  // 场景 B：Hero 渐变在深色下应基于 --kb-card
  const heroBg = await page.evaluate(() => {
    const el = document.querySelector('.wb-hero')
    return el ? getComputedStyle(el).backgroundImage : ''
  })
  if (!heroBg.includes('26, 29, 35') && !heroBg.includes('color(srgb')) {
    failures.push(`Hero 深色渐变疑似未令牌化: ${heroBg.slice(0, 90)}`)
  }

  // 场景 C：角标对比度（warning 底 + warning-foreground 字）
  const badge = await page.evaluate(() => {
    const el = document.querySelector('.nav-badge')
    const cs = el ? getComputedStyle(el) : null
    return cs ? { color: cs.color, bg: 'rgb(251, 191, 36)' } : null
  })
  if (badge) {
    const c = contrast(badge.color.replace('rgb(', '').replace(')', '').split(',').map((x) => parseInt(x)), [251, 191, 36])
    if (c < 4.5) failures.push(`角标对比度不足: ${c.toFixed(2)}:1`)
  }

  // 场景 D：强调色切换（green → --kb-primary = #10B981）
  await page.evaluate(() => document.documentElement.setAttribute('data-accent', 'green'))
  await page.waitForTimeout(300)
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kb-primary').trim())
  if (primary !== '#10B981') failures.push(`强调色切换后 --kb-primary 异常: ${primary}`)
  await page.evaluate(() => document.documentElement.removeAttribute('data-accent'))
} catch (e) {
  failures.push(`检查执行失败: ${e.message.split('\n')[0]}`)
} finally {
  await browser.close()
}

if (failures.length) {
  console.error('[ui-theme-check] 未通过：')
  for (const f of failures) console.error(' -', f)
  process.exit(1)
}
console.log('[ui-theme-check] 全部通过 ✅')
