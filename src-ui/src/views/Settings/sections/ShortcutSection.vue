<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">快捷键</h2>
    </header>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="keyboard" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">全局快捷键</h3>
          <p class="kb-set-card-desc">点击绑定格 → 按下新组合 → 自动捕获。带 ⌫ 可清除，带 🔒 可锁定防误改。</p>
        </div>
      </div>

      <div class="kb-shortcut-table">
        <div class="kb-shortcut-row kb-shortcut-head">
          <span>功能</span><span>绑定</span><span>状态</span>
        </div>
        <div v-for="m in SHORTCUT_META" :key="m.key" class="kb-shortcut-row">
          <div class="kb-shortcut-name">
            <span>{{ m.label }}</span>
            <span class="kb-setting-desc">{{ m.desc }}</span>
          </div>
          <div class="kb-shortcut-bind">
            <button
              class="kb-keybinding"
              :class="{ 'is-listening': listeningKey === m.key }"
              @click="startListen(m.key)"
            >
              <template v-if="listeningKey === m.key">按下组合键…</template>
              <template v-else>
                <kbd v-for="(k, i) in prefs.shortcuts[m.key]" :key="i">{{ k }}</kbd>
                <span v-if="!prefs.shortcuts[m.key].length" class="kb-setting-desc">未绑定</span>
              </template>
            </button>
            <button class="kb-btn kb-btn-sm kb-btn-ghost" title="清除绑定" @click="clearBind(m.key)">
              <Icon name="trash-2" :size="13" />
            </button>
            <button
              class="kb-btn kb-btn-sm"
              :class="{ 'kb-btn-primary': locked[m.key] }"
              :title="locked[m.key] ? '已锁定' : '锁定'"
              @click="locked[m.key] = !locked[m.key]"
            >
              <Icon name="lock" :size="13" v-if="locked[m.key]" />
              <Icon name="unlock" :size="13" v-else />
            </button>
          </div>
          <div class="kb-shortcut-status">
            <span
              class="kb-status-badge"
              :class="conflicts.has(m.key) ? 'is-warning' : (prefs.shortcuts[m.key].length ? 'is-ok' : 'is-off')"
            >
              <span class="dot"></span>
              {{ conflicts.has(m.key) ? '冲突' : (prefs.shortcuts[m.key].length ? '已注册' : '未注册') }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="conflicts.size" class="kb-conflict-tip">
        <Icon name="triangle-alert" :size="15" />
        检测到重复绑定，请为冲突项重新分配组合键。
      </div>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" @click="prefs.resetShortcuts()">
          <Icon name="rotate-ccw" :size="14" /> 恢复默认
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { usePrefsStore, SHORTCUT_META } from '@/store/prefs-store'

const prefs = usePrefsStore()
const listeningKey = ref<string | null>(null)
const locked = reactive<Record<string, boolean>>({})

const MOD_MAP: Record<string, string> = {
  Meta: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
}

/** 各快捷键当前组合序列化成字符串，便于冲突检测 */
const conflicts = computed(() => {
  const seen = new Map<string, string>()
  const out = new Set<string>()
  for (const m of SHORTCUT_META) {
    const combo = prefs.shortcuts[m.key]
    if (!combo.length) continue
    const key = combo.join('+')
    if (seen.has(key)) {
      out.add(m.key)
      out.add(seen.get(key)!)
    } else {
      seen.set(key, m.key)
    }
  }
  return out
})

function startListen(key: string) {
  if (locked[key]) return
  listeningKey.value = key
}

function clearBind(key: string) {
  if (locked[key]) return
  prefs.shortcuts[key] = []
}

function onKeydown(e: KeyboardEvent) {
  if (!listeningKey.value) return
  e.preventDefault()
  if (e.key === 'Escape') {
    listeningKey.value = null
    return
  }
  const mods: string[] = []
  if (e.metaKey) mods.push(MOD_MAP.Meta)
  if (e.ctrlKey) mods.push(MOD_MAP.Control)
  if (e.altKey) mods.push(MOD_MAP.Alt)
  if (e.shiftKey) mods.push(MOD_MAP.Shift)
  // 仅修饰键不算有效绑定
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return
  const mainKey = e.key.length === 1 ? e.key.toUpperCase() : e.key
  prefs.shortcuts[listeningKey.value] = [...mods, mainKey]
  listeningKey.value = null
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<style scoped>
.kb-shortcut-table { display: flex; flex-direction: column; }
.kb-shortcut-row { display: grid; grid-template-columns: 1fr auto 96px; gap: 1rem; align-items: center; padding: .6rem 0; border-bottom: 1px solid var(--kb-border); }
.kb-shortcut-row:last-child { border-bottom: none; }
.kb-shortcut-head { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); text-transform: uppercase; letter-spacing: .05em; padding-bottom: .4rem; }
.kb-shortcut-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.kb-shortcut-name > span:first-child { font-size: var(--kb-fs-body-md); font-weight: 500; color: var(--kb-foreground); }
.kb-shortcut-bind { display: flex; align-items: center; gap: .4rem; }
.kb-shortcut-status { display: flex; justify-content: flex-end; }
.kb-conflict-tip { display: flex; align-items: center; gap: .4rem; margin-top: .75rem; font-size: var(--kb-fs-body-sm); color: var(--kb-warning); }
.kb-conflict-tip :deep(svg) { flex-shrink: 0; }
.lf-actions { display: flex; align-items: center; gap: .625rem; margin-top: 1rem; }
</style>
