<template>
  <aside class="kb-set-sidebar">
    <div class="kb-set-side-title">
      <Icon name="settings" :size="20" class="kb-set-side-icon" />
      设置
    </div>

    <template v-for="grp in grouped" :key="grp.label || 'main'">
      <div v-if="grp.label" class="kb-set-group-label">{{ grp.label }}</div>
      <button
        v-for="item in grp.items"
        :key="item.key"
        class="kb-set-nav-item"
        :class="{ 'is-active': active === item.key }"
        @click="active = item.key"
      >
        <Icon :name="item.icon" :size="16" class="kb-set-nav-icon" />
        <span class="kb-set-nav-label">{{ item.label }}</span>
        <span v-if="item.badge" class="kb-set-nav-badge" :class="item.badgeTone || 'warning'">{{ item.badge }}</span>
      </button>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useSettings } from './useSettings'

const active = defineModel<string>('active', { default: 'general' })

interface NavItem {
  key: string
  label: string
  icon: string
  group?: string
  badge?: string
  badgeTone?: 'warning' | 'danger' | 'success'
}

const s = useSettings()

/** AI 分区角标：未启用 / 已就绪时不显示，待配置时提示 */
const aiBadge = computed<string | undefined>(() => {
  if (!s.form.enabled) return undefined
  return s.saved.configured ? undefined : '待配置'
})

const navItems: NavItem[] = [
  { key: 'general', label: '通用设置', icon: 'settings', group: '基础' },
  { key: 'data', label: '数据管理', icon: 'database', group: '基础' },
  { key: 'ai', label: 'AI 模型服务', icon: 'bot', group: 'AI', badge: aiBadge.value, badgeTone: 'warning' },
  { key: 'local-model', label: '本地模型', icon: 'cpu', group: 'AI' },
  { key: 'appearance', label: '外观', icon: 'palette', group: '体验' },
  { key: 'about', label: '关于', icon: 'info', group: '' },
]

const grouped = computed(() => {
  const items = navItems.map((item) =>
    item.key === 'ai' ? { ...item, badge: aiBadge.value } : item,
  )
  const groups: { label: string; items: NavItem[] }[] = []
  let current: { label: string; items: NavItem[] } | null = null
  for (const item of items) {
    const label = item.group || ''
    if (!current || current.label !== label) {
      current = { label, items: [] }
      groups.push(current)
    }
    current.items.push(item)
  }
  return groups
})
</script>
