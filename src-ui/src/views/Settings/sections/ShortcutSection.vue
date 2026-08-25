<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">快捷键</h2>
    </header>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="keyboard" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">应用内快捷键</h3>
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

    <!-- OCR 全局快捷键（系统级）：与上面的「应用内快捷键」不同，应用失焦 / 隐藏到托盘时仍可触发，
         注册走 Tauri global-shortcut 插件，配置持久化到 ocr-shortcut-store（localStorage）。 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="scan" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">OCR 全局快捷键</h3>
          <p class="kb-set-card-desc">
            系统级：应用失焦或隐藏时也可触发截图识别，识别结果自动复制到剪贴板。
            点击组合键重新录制；每个快捷键可独立设置「隐藏窗口后截图」或「直接截图」。
          </p>
        </div>
      </div>

      <div v-if="!ocrShortcut.pluginAvailable" class="kb-conflict-tip" style="margin-bottom: 0.75rem;">
        <Icon name="triangle-alert" :size="15" />
        全局快捷键插件当前不可用（浏览器预览态），保存的配置将在桌面应用内生效。
      </div>

      <div class="kb-shortcut-table">
        <div class="kb-shortcut-row kb-shortcut-head">
          <span>组合键</span><span>行为模式</span><span></span>
        </div>
        <div v-for="s in ocrShortcuts" :key="s.id" class="kb-shortcut-row">
          <div class="kb-shortcut-name">
            <button
              class="kb-keybinding"
              :class="{ 'is-listening': ocrListeningId === s.id }"
              @click="startOcrListen(s.id)"
            >
              <template v-if="ocrListeningId === s.id">按下组合键…</template>
              <template v-else>
                <kbd v-for="(k, i) in acceleratorToDisplay(s.combo)" :key="i">{{ k }}</kbd>
                <span v-if="!s.combo" class="kb-setting-desc">未绑定</span>
              </template>
            </button>
            <span
              v-if="ocrRecordErr && ocrListeningId === s.id"
              class="kb-ocr-record-err"
            >{{ ocrRecordErr }}</span>
            <span v-else-if="ocrShortcut.regErrors[s.id]" class="kb-ocr-record-err">
              {{ ocrShortcut.regErrors[s.id] }}
            </span>
          </div>
          <div class="kb-ocr-behavior">
            <button
              class="kb-ocr-behavior-btn"
              :class="{ 'is-active': s.behavior === 'hide' }"
              title="先自动隐藏主窗口再截图识别，识别完成后恢复窗口原状（避免把本应用截进去）"
              @click="setBehavior(s.id, 'hide')"
            >隐藏窗口</button>
            <button
              class="kb-ocr-behavior-btn"
              :class="{ 'is-active': s.behavior === 'direct' }"
              title="直接截图识别，不隐藏窗口"
              @click="setBehavior(s.id, 'direct')"
            >直接截图</button>
          </div>
          <div class="kb-shortcut-bind">
            <button class="kb-btn kb-btn-sm kb-btn-ghost" title="删除此快捷键" @click="removeOcrShortcut(s.id)">
              <Icon name="trash-2" :size="13" />
            </button>
          </div>
        </div>
        <div v-if="!ocrShortcuts.length" class="kb-ocr-empty">暂无全局快捷键，点下方「新增快捷键」添加。</div>
      </div>

      <p class="kb-ocr-perm-tip">
        <Icon name="info" :size="13" />
        macOS 首次使用需在「系统设置 › 隐私与安全性 › 输入监视」中授权 LectoForge，否则注册会失败并在此提示。
      </p>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" @click="addOcrShortcut">
          <Icon name="plus" :size="14" /> 新增快捷键
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import Icon from '@/components/ui/Icon.vue'
import { usePrefsStore, SHORTCUT_META } from '@/store/prefs-store'
import {
  useOcrShortcutStore,
  acceleratorToDisplay,
  eventToAccelerator,
} from '@/store/ocr-shortcut-store'
import { notify } from '@/utils/toast'

const prefs = usePrefsStore()
const ocrShortcut = useOcrShortcutStore()
const { shortcuts: ocrShortcuts } = storeToRefs(ocrShortcut)
const listeningKey = ref<string | null>(null)
/** 正在录制的 OCR 全局快捷键 id（null = 无录制进行中） */
const ocrListeningId = ref<string | null>(null)
/** 录制过程中按键的校验错误（冲突 / 非法组合），实时提示且不写入 */
const ocrRecordErr = ref<string | null>(null)
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

/** —— OCR 全局快捷键 —— */

function startOcrListen(id: string) {
  ocrListeningId.value = id
  ocrRecordErr.value = null
}

function addOcrShortcut() {
  const id = ocrShortcut.addShortcut()
  ocrRecordErr.value = null
  startOcrListen(id)
  notify('新增快捷键：请按下组合键（需包含 ⌘ / ⌃ / ⌥ / ⇧）', 'info')
}

function removeOcrShortcut(id: string) {
  ocrShortcut.removeShortcut(id)
  if (ocrListeningId.value === id) ocrListeningId.value = null
}

function setBehavior(id: string, behavior: 'hide' | 'direct') {
  ocrShortcut.updateShortcut(id, { behavior })
}

function onKeydown(e: KeyboardEvent) {
  // OCR 全局快捷键录制优先于应用内录制
  if (ocrListeningId.value) {
    e.preventDefault()
    if (e.key === 'Escape') {
      ocrListeningId.value = null
      ocrRecordErr.value = null
      return
    }
    const combo = eventToAccelerator(e)
    if (!combo) return // 纯修饰键，继续等待有效组合
    const err = ocrShortcut.validateCombo(combo, ocrListeningId.value)
    if (err) {
      ocrRecordErr.value = err
      return // 冲突 / 非法：不写入，提示用户换一个
    }
    ocrRecordErr.value = null
    ocrShortcut.updateShortcut(ocrListeningId.value, { combo })
    ocrListeningId.value = null
    notify('快捷键已更新并重新注册', 'success')
    return
  }
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

/* OCR 全局快捷键专属样式 */
.kb-ocr-behavior { display: flex; gap: 4px; }
.kb-ocr-behavior-btn {
  padding: 4px 10px;
  font-size: var(--kb-fs-body-sm);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-sm);
  background: var(--kb-card);
  color: var(--kb-muted-foreground);
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s ease;
}
.kb-ocr-behavior-btn.is-active {
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  border-color: var(--kb-primary);
  color: var(--kb-primary);
  font-weight: 500;
}
.kb-ocr-behavior-btn:hover:not(.is-active) { color: var(--kb-foreground); }
.kb-ocr-record-err {
  font-size: var(--kb-fs-caption);
  color: var(--kb-destructive);
  line-height: 1.5;
}
.kb-ocr-empty {
  padding: 1rem 0;
  font-size: var(--kb-fs-body-sm);
  color: var(--kb-muted-foreground);
}
.kb-ocr-perm-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: .75rem 0 0;
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
}
.kb-ocr-perm-tip :deep(svg) { flex-shrink: 0; }
</style>
