<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">外观</h2>
    </header>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="palette" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">主题</h3>
          <p class="kb-set-card-desc">浅色 / 深色 / 跟随系统，实时生效并保存在本机。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>主题模式</span>
          <span class="kb-setting-desc">深色主题下自动切换提亮档强调色</span>
        </div>
        <div class="kb-setting-control">
          <div class="kb-filter-group">
            <button
              v-for="t in themeOptions"
              :key="t.value"
              class="kb-filter-btn"
              :class="{ active: appStore.settings.ui.theme === t.value }"
              @click="onThemeChange(t.value)"
            >
              {{ t.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>强调色</span>
          <span class="kb-setting-desc">主色，应用于按钮 / 高亮 / 链接</span>
        </div>
        <div class="kb-setting-control">
          <button
            v-for="a in accentOptions"
            :key="a.value"
            type="button"
            class="kb-color-dot"
            :class="{ 'is-selected': appStore.settings.ui.accent === a.value }"
            :style="{ background: a.color }"
            :title="a.label"
            :aria-label="a.label"
            @click="onAccentChange(a.value)"
          ></button>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>紧凑模式</span>
          <span class="kb-setting-desc">减小任务、笔记、文件树等列表行高与间距</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': appStore.settings.ui.compact }">
            <input type="checkbox" v-model="appStore.settings.ui.compact" @change="onCompactChange" />
          </label>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { useAppStore } from '@/store/app-store'
import { applyTheme, applyAccent, applyDensity, type ThemePref, type AccentPref } from '@/utils/ui-prefs'

const appStore = useAppStore()

/** 主题三选一（浅色 / 深色 / 跟随系统） */
const themeOptions: { value: ThemePref; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

/** 强调色 6 档（与 style.css data-accent 预设保持一致，双主题联动） */
const accentOptions: { value: AccentPref; label: string; color: string }[] = [
  { value: 'blue', label: '默认蓝', color: '#3B6FE0' },
  { value: 'indigo', label: '靛蓝', color: '#4F46E5' },
  { value: 'purple', label: '紫罗兰', color: '#7C3AED' },
  { value: 'green', label: '翡翠绿', color: '#10B981' },
  { value: 'orange', label: '琥珀橙', color: '#F59E0B' },
  { value: 'pink', label: '玫红', color: '#EC4899' },
]

function onThemeChange(t: ThemePref) {
  appStore.settings.ui.theme = t
  applyTheme(t)
}
function onAccentChange(accent: AccentPref) {
  appStore.settings.ui.accent = accent
  applyAccent(accent)
}
function onCompactChange() {
  applyDensity(appStore.settings.ui.compact)
}
</script>
