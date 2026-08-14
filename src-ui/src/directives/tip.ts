/**
 * v-tip 自定义悬浮提示指令（替代原生 title）。
 *
 * 为什么不用原生 title：Tauri / WKWebView（macOS）默认不渲染 HTML `title` 的
 * 悬浮气泡，导致桌面端 tooltip 完全不显示。本指令用一个固定在 body 的共享气泡，
 * 在 hover / focus 时定位到目标元素附近，样式由 style.css 的 `.app-tooltip` 控制。
 *
 * 用法：<button v-tip="'立即保存'"> 或 v-tip="dynamicText"
 * 同时把文本写进 data-tip，便于 updated 钩子同步。
 */
import type { Directive } from 'vue';

let tipEl: HTMLDivElement | null = null;
let hideTimer: number | null = null;
let enterHandlers = new WeakMap<HTMLElement, () => void>();
let leaveHandlers = new WeakMap<HTMLElement, () => void>();

function ensureEl(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'app-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function place(target: HTMLElement, text: string) {
  const el = ensureEl();
  el.textContent = text;
  // 先显示才能量到尺寸
  el.classList.add('show');
  const r = target.getBoundingClientRect();
  const tr = el.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  let top = r.top - tr.height - 8;
  if (top < 8) top = r.bottom + 8; // 上方空间不足 → 放到下方
  left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - tr.height - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function hide() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (tipEl) tipEl.classList.remove('show');
}

export const tip: Directive<HTMLElement, string | undefined> = {
  mounted(el, binding) {
    const text = () => binding.value ?? el.getAttribute('data-tip') ?? '';
    const onEnter = () => {
      if (hideTimer) clearTimeout(hideTimer);
      place(el, text());
    };
    const onLeave = () => {
      hideTimer = window.setTimeout(hide, 120);
    };
    enterHandlers.set(el, onEnter);
    leaveHandlers.set(el, onLeave);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('focus', onEnter);
    el.addEventListener('blur', onLeave);
  },
  updated(el, binding) {
    el.setAttribute('data-tip', binding.value ?? '');
  },
  unmounted(el) {
    const onEnter = enterHandlers.get(el);
    const onLeave = leaveHandlers.get(el);
    if (onEnter) {
      el.removeEventListener('mouseenter', onEnter);
      enterHandlers.delete(el);
    }
    if (onLeave) {
      el.removeEventListener('mouseleave', onLeave);
      leaveHandlers.delete(el);
    }
    el.removeEventListener('focus', () => {});
    el.removeEventListener('blur', () => {});
  },
};
