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
          <p class="kb-set-card-desc">浅色 / 深色 / 跟随系统，实时预览。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label"><span>主题模式</span></div>
        <div class="kb-setting-control">
          <div class="kb-filter-group">
            <button class="kb-filter-btn" :class="{ active: prefs.theme === 'light' }" @click="prefs.theme = 'light'">
              <Icon name="sun" :size="14" /> 浅色
            </button>
            <button class="kb-filter-btn" :class="{ active: prefs.theme === 'dark' }" @click="prefs.theme = 'dark'">
              <Icon name="moon" :size="14" /> 深色
            </button>
            <button class="kb-filter-btn" :class="{ active: prefs.theme === 'system' }" @click="prefs.theme = 'system'">
              <Icon name="monitor" :size="14" /> 系统
            </button>
          </div>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>主题色</span>
          <span class="kb-setting-desc">主色，应用于按钮 / 高亮 / 链接</span>
        </div>
        <div class="kb-setting-control">
          <button
            v-for="c in ACCENT_PRESETS"
            :key="c.value"
            class="kb-color-dot"
            :class="{ 'is-selected': prefs.accentColor.toLowerCase() === c.value.toLowerCase() }"
            :style="{ background: c.value }"
            :title="c.label"
            @click="prefs.accentColor = c.value"
          ></button>
          <label class="kb-color-dot" :class="{ 'is-selected': isCustomAccent }" :style="{ background: prefs.accentColor, borderColor: 'var(--kb-border)' }" title="自定义">
            <input type="color" v-model="prefs.accentColor" style="opacity: 0; width: 0; height: 0; position: absolute;" />
          </label>
        </div>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="type" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">字体</h3>
          <p class="kb-set-card-desc">调整界面整体字号缩放。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>字号缩放</span>
          <span class="kb-setting-desc">当前 {{ Math.round(prefs.fontScale * 100) }}%</span>
        </div>
        <div class="kb-setting-control">
          <div class="kb-filter-group">
            <button
              v-for="opt in FONT_SCALE_OPTIONS"
              :key="opt"
              class="kb-filter-btn"
              :class="{ active: Math.abs(prefs.fontScale - opt) < 0.001 }"
              @click="prefs.fontScale = opt"
            >
              {{ Math.round(opt * 100) }}%
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="layout-dashboard" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">布局</h3>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>紧凑模式</span>
          <span class="kb-setting-desc">收紧卡片与行间距，容纳更多信息</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.compactMode }">
            <input type="checkbox" v-model="prefs.compactMode" />
          </label>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label"><span>导航位置</span></div>
        <div class="kb-setting-control">
          <div class="kb-filter-group">
            <button class="kb-filter-btn" :class="{ active: prefs.navPosition === 'left' }" @click="prefs.navPosition = 'left'">
              左侧
            </button>
            <button class="kb-filter-btn" :class="{ active: prefs.navPosition === 'top' }" @click="prefs.navPosition = 'top'">
              顶部
            </button>
          </div>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>透明窗口</span>
          <span class="kb-setting-desc">启用毛玻璃沉浸式窗口（需重启）</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.transparentWindow }">
            <input type="checkbox" v-model="prefs.transparentWindow" />
          </label>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { usePrefsStore, ACCENT_PRESETS, FONT_SCALE_OPTIONS } from '@/store/prefs-store'

const prefs = usePrefsStore()
const isCustomAccent = computed(
  () => !ACCENT_PRESETS.some((c) => c.value.toLowerCase() === prefs.accentColor.toLowerCase()),
)
</script>
