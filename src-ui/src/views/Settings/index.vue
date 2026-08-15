<template>
  <!-- 设置中心重设计（三栏式）：左侧导航 + 右侧自适应详情面板。
       视觉沿用工作台 --kb-* 设计令牌，保持整体风格一致。 -->
  <div class="kb-set-root animate-fade-in">
    <!-- 返回条（sticky 常驻）：standalone 无顶栏，这里是回到主界面的唯一出口 -->
    <div class="lf-backbar">
      <button type="button" class="kb-btn lf-back-btn" :title="backTitle" @click="goBack">
        <Icon name="arrow-left" :size="15" />
        {{ backLabel }}
        <kbd class="lf-kbd">Esc</kbd>
      </button>
      <span v-if="s.dirty.value" class="lf-dirty" title="修改尚未写入本机配置文件">
        <i class="lf-dirty-dot"></i> 有未保存的修改
      </span>
    </div>

    <div class="kb-set-body">
      <SettingsSidebar v-model:active="activeKey" />
      <SettingsDetailPanel :section="activeKey" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { onMounted, onUnmounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useSettings } from './useSettings'
import { useSearchStore } from '@/store/search-store'
import { useInboxStore } from '@/store/inbox-store'
import { useNoteStore } from '@/store/note-store'
import { toastState, confirmDialog } from '@/utils/toast'
import SettingsSidebar from './Sidebar.vue'
import SettingsDetailPanel from './DetailPanel.vue'

const router = useRouter()
const s = useSettings()
const searchStore = useSearchStore()
const inboxStore = useInboxStore()
const noteStore = useNoteStore()

const activeKey = ref('general')

/** 解析来源页，返回时优先回上一页 */
const backPath = ref<string | null>(null)
const backLabel = ref('返回工作台')
const backTitle = ref('返回工作台 · Esc')

function goBack() {
  if (backPath.value) router.back()
  else router.push('/workbench')
}

function overlayHoldsEsc(): boolean {
  return (
    searchStore.isOpen ||
    inboxStore.quickOpen ||
    noteStore.quickCreateOpen ||
    toastState.confirms.length > 0
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (overlayHoldsEsc()) return
  goBack()
}

onBeforeRouteLeave(async () => {
  if (!s.dirty.value) return true
  return await confirmDialog('设置有未保存的修改，确定离开吗？未保存的改动将丢失。')
})

onMounted(async () => {
  const prev = (window.history.state as { back?: unknown } | null)?.back
  backPath.value =
    typeof prev === 'string' && prev && !prev.startsWith('/settings') && !prev.startsWith('/onboarding')
      ? prev
      : null
  backLabel.value = backPath.value ? '返回' : '返回工作台'
  backTitle.value = backPath.value ? `返回上一页（${backPath.value}）· Esc` : '返回工作台 · Esc'

  window.addEventListener('keydown', onKeydown)
  await s.loadAll()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.kb-set-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--kb-background); }
.kb-set-body { flex: 1; min-height: 0; display: flex; }

/* 返回条：贴容器顶部常驻 */
.lf-backbar {
  display: flex;
  align-items: center;
  gap: .75rem;
  padding: .55rem 1.25rem;
  border-bottom: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-background) 82%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  flex-shrink: 0;
}
.lf-back-btn { display: inline-flex; align-items: center; gap: .375rem; font-weight: 600; }
.lf-back-btn:hover { color: var(--kb-primary); border-color: var(--kb-primary); }
.lf-kbd {
  margin-left: .125rem;
  padding: .05rem .3rem;
  border: 1px solid var(--kb-border);
  border-radius: 4px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
}
.lf-dirty {
  display: inline-flex;
  align-items: center;
  gap: .375rem;
  margin-left: auto;
  font-size: var(--kb-fs-caption);
  color: var(--kb-warning);
}
.lf-dirty-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--kb-warning); }
</style>
