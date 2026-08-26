<template>
  <!-- 离线模拟面试 / 语音通话：对话气泡 + 实时字幕 + 大按钮通话控制。
       全屏布局：顶栏（DesktopTopNav）保留，内容区铺满；滚动收口到对话容器。
       配色一律用 --kb-* token，不写死颜色；Tailwind 仅用于布局。 -->
  <div class="iv-root">
    <header class="iv-head">
      <div class="iv-head-title">
        <Icon name="mic" :size="'xl'" class="iv-head-icon" />
        <div>
          <h1 class="iv-h1">模拟面试</h1>
          <p class="iv-sub">
            {{ statusHint }}
          </p>
        </div>
      </div>
      <span class="iv-state" :class="stateClass">
        <i class="iv-state-dot"></i>{{ stateLabel }}
      </span>
    </header>

    <!-- 预设角色选择区（影响面试官人设 + 智能追问风格；通话中锁定） -->
    <div class="iv-roles">
      <button
        v-for="r in ROLES"
        :key="r"
        type="button"
        class="iv-role"
        :class="{ 'is-active': selectedRole === r }"
        :disabled="inCall"
        @click="selectedRole = r"
      >
        {{ r }}
      </button>
    </div>

    <!-- 对话区（面试官左 / 用户右；点评与总结居中卡片） -->
    <div ref="scrollEl" class="iv-chat">
      <div v-if="!messages.length" class="iv-empty">
        <Icon name="messages-square" :size="'40px'" />
        <p>点击下方「开始通话」，面试官会用语音向你提问。</p>
        <p class="iv-empty-hint">回答请点击麦克风，系统本地转写后即时点评。</p>
      </div>

      <div
        v-for="m in messages"
        :key="m.id"
        class="iv-row"
        :class="rowClass(m)"
      >
        <span v-if="m.role === 'interviewer'" class="iv-avatar iv-avatar-left">
          <Icon name="bot" :size="'md'" />
        </span>

        <!-- 面试官提问气泡 -->
        <div v-if="m.role === 'interviewer'" class="iv-bubble iv-bubble-left">
          <span v-if="m.followUp" class="iv-followup-tag">⚡ 追问</span>
          <p class="iv-bubble-text">{{ m.text }}</p>
          <span v-if="m.speaking" class="iv-caption">正在朗读…</span>
        </div>

        <!-- 用户回答气泡 -->
        <div v-else-if="m.role === 'user'" class="iv-bubble iv-bubble-right">
          <p class="iv-bubble-text">{{ m.text }}</p>
        </div>

        <!-- 点评卡片（评分 + 点评语） -->
        <div v-else-if="m.role === 'evaluation'" class="iv-eval">
          <div class="iv-eval-head">
            <Icon name="clipboard-check" :size="'md'" />
            <span>本轮点评</span>
            <span class="iv-score" :class="scoreClass(m.score)">评分 {{ m.score }}</span>
          </div>
          <p class="iv-eval-comment">{{ m.comment }}</p>
        </div>

        <!-- 系统 / 总结 -->
        <div v-else class="iv-system">
          <Icon :name="m.role === 'end' ? 'flag' : 'info'" :size="'15px'" />
          <span>{{ m.text }}</span>
        </div>

        <span v-if="m.role === 'user'" class="iv-avatar iv-avatar-right">
          <Icon name="user" :size="'md'" />
        </span>
      </div>
    </div>

    <!-- 底部控制条 -->
    <footer class="iv-bar">
      <!-- 通话前：开始 -->
      <button
        v-if="!inCall"
        class="iv-call iv-call-start"
        @click="startCall"
      >
        <Icon name="phone-call" :size="'22px'" />
        开始通话
      </button>

      <!-- 通话中：麦克风回答 / 发送 + 结束 -->
      <template v-else>
        <div class="iv-bar-actions">
          <button
            class="iv-mic"
            :class="{ 'is-recording': recorder.recording.value }"
            :disabled="speaking || answering"
            @click="toggleRecord"
          >
            <Icon :name="recorder.recording.value ? 'square' : 'mic'" :size="'22px'" />
            {{ recorder.recording.value ? '停止并发送' : '回答（麦克风）' }}
          </button>

          <button class="iv-call iv-call-end" @click="endCall">
            <Icon name="phone-off" :size="'lg'" />
            结束通话
          </button>
        </div>
        <p v-if="recorder.error.value" class="iv-err">
          <Icon name="alert-triangle" :size="'sm'" /> {{ recorder.error.value }}
        </p>
      </template>
    </footer>
  </div>
</template>

<script setup lang="ts">
// 离线模拟面试通话视图。
// 关键链路：开始 → POST /interview/start(SSE) → 朗读 question(speechSynthesis)
//          → 用户录音 stop()→Blob → POST /interview/transcribe(multipart) → 显示字幕
//          → POST /interview/answer(SSE) → 先 evaluation 后 question(朗读)/end(总结)。
// 语音合成刻意按标点切句、逐句 Speak、onend 串联，营造「流式通话」感；开始前 cancel 防堆叠。
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useVoiceRecorder } from '@/composables/useVoiceRecorder'
import { notify, getApiError } from '@/utils/toast'
import { postSSE } from '@/api/sse'
import { transcribe } from '@/lib/stt/sttDispatch'
import { synthesize, stopSynthesis } from '@/lib/tts/ttsDispatch'

type Role = 'interviewer' | 'user' | 'evaluation' | 'system' | 'end'
interface Msg {
  id: number
  role: Role
  text: string
  /** 面试官气泡：是否正在朗读（实时字幕态） */
  speaking?: boolean
  /** 点评分数（0~100） */
  score?: number
  comment?: string
  /** 面试官提问气泡：⚡ 追问（针对上一轮薄弱点的深入提问） */
  followUp?: boolean
}

/** 预设面试角色（与后端 INTERVIEW_ROLE_PROMPTS 的 key 对齐） */
const ROLES = ['通用面试官', '大厂架构师', 'HR面试官', '同级评审', '技术主管']
/** 当前选中的角色（默认与后端 DEFAULT_ROLE 一致：通用面试官） */
const selectedRole = ref<string>('通用面试官')

type Status = 'idle' | 'connecting' | 'speaking' | 'await' | 'listening' | 'answering' | 'ended'

const recorder = useVoiceRecorder()
const messages = ref<Msg[]>([])
const sessionId = ref<string | null>(null)
const status = ref<Status>('idle')
const speaking = ref(false)
const answering = ref(false)
const inCall = computed(() => status.value !== 'idle' && status.value !== 'ended')
const scrollEl = ref<HTMLElement | null>(null)

/** 当前 SSE 流的取消器（结束通话 / 离开页面时中止） */
let sseAbort: AbortController | null = null
let msgSeq = 0

const stateLabel = computed(() => {
  switch (status.value) {
    case 'connecting': return '连接中'
    case 'speaking': return '面试官讲话中'
    case 'await': return '等待你回答'
    case 'listening': return '聆听中'
    case 'answering': return '点评中'
    case 'ended': return '已结束'
    default: return '待开始'
  }
})
const stateClass = computed(() => `is-${status.value === 'idle' || status.value === 'ended' ? 'off' : 'on'}`)
const statusHint = computed(() => {
  if (status.value === 'idle') return '完全离线：语音不出本机，由本地 Whisper + 系统嗓音驱动。'
  if (status.value === 'connecting') return '正在接通面试官…'
  if (status.value === 'speaking') return '面试官正在朗读题目，请倾听。'
  if (status.value === 'await') return '点击麦克风，口头回答后系统会转写并点评。'
  if (status.value === 'listening') return '正在录音，再次点击即停止并发送给面试官。'
  if (status.value === 'answering') return '正在转写并生成点评…'
  return '本次面试已结束。'
})

function rowClass(m: Msg): string {
  if (m.role === 'interviewer') return 'is-left'
  if (m.role === 'user') return 'is-right'
  if (m.role === 'evaluation') return 'is-eval'
  return 'is-system'
}
function scoreClass(score?: number): string {
  if (score == null) return ''
  if (score >= 80) return 'is-good'
  if (score >= 60) return 'is-mid'
  return 'is-low'
}

function pushMsg(m: Omit<Msg, 'id'>): Msg {
  const msg: Msg = { id: ++msgSeq, ...m }
  messages.value.push(msg)
  void scrollToBottom()
  return msg
}

async function scrollToBottom() {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

// ---------------------- TTS（window.speechSynthesis，统一封装于 @/lib/tts/tts） ----------------------

/**
 * 朗读文本：委托给共享 TTS 模块，使用用户选中的嗓音（默认回落最优中文嗓音），
 * 并做轻微降速 + 句间停顿，比原生匀速更自然。
 */
async function speak(text: string): Promise<void> {
  speaking.value = true
  try {
    await synthesize(text)
  } finally {
    speaking.value = false
  }
}

function stopSpeech() {
  stopSynthesis()
  speaking.value = false
}

// ---------------------- 通话流程 ----------------------

async function startCall() {
  if (status.value === 'connecting') return
  messages.value = []
  sessionId.value = null
  status.value = 'connecting'
  const ctrl = new AbortController()
  sseAbort = ctrl
  try {
    for await (const ev of postSSE('/interview/start', { role: selectedRole.value }, { signal: ctrl.signal })) {
      if (ev.event === 'question') {
        const d = ev.data as { sessionId: string; text: string; questionId?: string; followUp?: boolean }
        sessionId.value = d.sessionId
        const msg = pushMsg({ role: 'interviewer', text: d.text, speaking: true, followUp: !!d.followUp })
        status.value = 'speaking'
        await speak(d.text)
        msg.speaking = false
        // 朗读完毕，进入等待回答态
        if (status.value === 'speaking') status.value = 'await'
      } else if (ev.event === 'end') {
        const d = ev.data as { summary?: string }
        if (d?.summary) pushMsg({ role: 'end', text: d.summary })
        finishCall()
      }
    }
  } catch (e) {
    if (isAbort(e)) return
    notify(getApiError(e, '连接面试官失败'), 'error')
    finishCall()
  }
}

/** 麦克风按钮：未录音→开始；录音中→停止并发送 */
async function toggleRecord() {
  if (recorder.recording.value) {
    await stopAndAnswer()
  } else {
    if (!recorder.supported) {
      notify('当前环境不支持录音（需要麦克风权限）', 'error')
      return
    }
    const ok = await recorder.start()
    if (ok) {
      status.value = 'listening'
    } else if (recorder.error.value) {
      notify(recorder.error.value, 'error')
    }
  }
}

/** 停止录音 → 转写 → 提交答案 → 消费点评/下一题 SSE */
async function stopAndAnswer() {
  const rec = await recorder.stop()
  if (!rec) return
  status.value = 'answering'
  answering.value = true

  // 1) 转写（按设置页 runtime 分发：native→后端 whisper-server / wasm→前端 worker）
  let transcript: string
  try {
    const r = await transcribe(rec.blob, rec.fileName)
    transcript = r.text
  } catch (e) {
    answering.value = false
    notify(getApiError(e, '语音转写失败'), 'error')
    status.value = 'await'
    return
  }
  if (!transcript) {
    answering.value = false
    notify('没有识别到语音，请再试一次', 'info')
    status.value = 'await'
    return
  }
  pushMsg({ role: 'user', text: transcript })

  // 2) 提交答案，消费 SSE
  const ctrl = new AbortController()
  sseAbort = ctrl
  try {
    for await (const ev of postSSE(
      '/interview/answer',
      { sessionId: sessionId.value, transcript },
      { signal: ctrl.signal },
    )) {
      if (ev.event === 'evaluation') {
        const d = ev.data as { score: number; comment: string }
        pushMsg({ role: 'evaluation', text: '', score: d.score, comment: d.comment })
      } else if (ev.event === 'question') {
        const d = ev.data as { sessionId: string; text: string; questionId?: string; followUp?: boolean }
        sessionId.value = d.sessionId
        const msg = pushMsg({ role: 'interviewer', text: d.text, speaking: true, followUp: !!d.followUp })
        status.value = 'speaking'
        await speak(d.text)
        msg.speaking = false
        if (status.value === 'speaking') status.value = 'await'
      } else if (ev.event === 'end') {
        const d = ev.data as { summary?: string }
        if (d?.summary) pushMsg({ role: 'end', text: d.summary })
        finishCall()
        break
      }
    }
  } catch (e) {
    if (isAbort(e)) return
    notify(getApiError(e, '提交答案失败'), 'error')
  } finally {
    answering.value = false
  }
}

/** 结束通话：取消语音、停录音、中止 SSE、复位状态 */
function endCall() {
  stopSpeech()
  if (recorder.recording.value) recorder.cancel()
  sseAbort?.abort()
  sseAbort = null
  if (status.value !== 'idle' && status.value !== 'ended') {
    pushMsg({ role: 'system', text: '通话已结束。' })
  }
  finishCall()
}

function finishCall() {
  stopSpeech()
  sseAbort?.abort()
  sseAbort = null
  status.value = 'ended'
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

onBeforeUnmount(() => {
  stopSpeech()
  if (recorder.recording.value) recorder.cancel()
  sseAbort?.abort()
})
</script>

<style scoped>
.iv-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 56rem;
  margin: 0 auto;
  width: 100%;
}

/* 头部 */
.iv-head {
  display: flex;
  align-items: center;
  gap: .75rem;
  padding: .25rem .25rem .75rem;
  border-bottom: 1px solid var(--kb-border);
}
.iv-head-title { display: flex; align-items: center; gap: .625rem; }
.iv-head-icon { color: var(--kb-primary); flex-shrink: 0; }
.iv-h1 { font-size: var(--kb-fs-h3); font-weight: 700; color: var(--kb-foreground); margin: 0; }
.iv-sub { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin: .15rem 0 0; }
.iv-state {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: .375rem;
  font-size: var(--kb-fs-caption);
  padding: .2rem .6rem;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
}
.iv-state-dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
.iv-state.is-on { color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 12%, transparent); }

/* 预设角色选择区 */
.iv-roles {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
  padding: .25rem .25rem .75rem;
}
.iv-role {
  padding: .35rem .85rem;
  border-radius: 999px;
  font-size: var(--kb-fs-caption);
  font-weight: 500;
  color: var(--kb-muted-foreground);
  background: var(--kb-muted);
  border: 1px solid var(--kb-border);
  cursor: pointer;
  transition: color .15s ease, background .15s ease, border-color .15s ease;
}
.iv-role:hover:not(:disabled) { color: var(--kb-foreground); }
.iv-role.is-active {
  color: var(--kb-primary-foreground);
  background: var(--kb-primary);
  border-color: var(--kb-primary);
}
.iv-role:disabled { opacity: .5; cursor: not-allowed; }

/* 对话区 */
.iv-chat {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem .25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.iv-empty {
  margin: auto;
  text-align: center;
  color: var(--kb-muted-foreground);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .5rem;
}
.iv-empty-hint { font-size: var(--kb-fs-caption); opacity: .8; }

.iv-row { display: flex; align-items: flex-end; gap: .5rem; }
.iv-row.is-right { flex-direction: row; justify-content: flex-end; }
.iv-row.is-right .iv-avatar-right { order: 2; }
.iv-row.is-eval, .iv-row.is-system { justify-content: center; }

.iv-avatar {
  width: 30px; height: 30px; flex-shrink: 0;
  border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
  color: var(--kb-primary);
}
.iv-avatar-right { background: var(--kb-muted); color: var(--kb-muted-foreground); }

.iv-bubble {
  max-width: min(78%, 40rem);
  padding: .6rem .85rem;
  border-radius: var(--kb-radius-lg);
  font-size: var(--kb-fs-body-md);
  line-height: 1.55;
}
.iv-bubble-left {
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  border-bottom-left-radius: 4px;
  color: var(--kb-foreground);
}
.iv-bubble-right {
  background: var(--kb-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.iv-bubble-right .iv-bubble-text { color: #fff; }
.iv-bubble-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
.iv-followup-tag {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  margin-bottom: .4rem;
  padding: .12rem .55rem;
  border-radius: 999px;
  font-size: var(--kb-fs-caption);
  font-weight: 600;
  color: var(--kb-warning);
  background: color-mix(in srgb, var(--kb-warning) 14%, transparent);
  align-self: flex-start;
}
.iv-caption {
  display: inline-block;
  margin-top: .35rem;
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
}

/* 点评卡片 */
.iv-eval {
  width: min(90%, 42rem);
  background: color-mix(in srgb, var(--kb-accent) 8%, var(--kb-card));
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-lg);
  padding: .7rem .9rem;
}
.iv-eval-head {
  display: flex;
  align-items: center;
  gap: .4rem;
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  color: var(--kb-foreground);
}
.iv-score {
  margin-left: auto;
  font-weight: 700;
  padding: .1rem .5rem;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
.iv-score.is-good { color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 14%, transparent); }
.iv-score.is-mid { color: var(--kb-warning); background: color-mix(in srgb, var(--kb-warning) 16%, transparent); }
.iv-score.is-low { color: var(--kb-destructive); background: color-mix(in srgb, var(--kb-destructive) 14%, transparent); }
.iv-eval-comment { margin: .4rem 0 0; font-size: var(--kb-fs-body-sm); color: var(--kb-muted-foreground); line-height: 1.55; white-space: pre-wrap; }

/* 系统 / 总结 */
.iv-system {
  display: inline-flex;
  align-items: center;
  gap: .4rem;
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
  background: var(--kb-muted);
  padding: .35rem .75rem;
  border-radius: 999px;
  max-width: 90%;
}

/* 底部控制条 */
.iv-bar {
  border-top: 1px solid var(--kb-border);
  padding: .85rem .25rem .25rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .5rem;
}
.iv-bar-actions { display: flex; gap: .75rem; align-items: center; }

.iv-call {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  padding: .7rem 1.6rem;
  border-radius: 999px;
  font-size: 1rem;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: transform .12s ease, opacity .12s ease, background .15s ease;
}
.iv-call:active { transform: scale(.97); }
.iv-call-start { background: var(--kb-primary); color: #fff; }
.iv-call-start:hover { opacity: .9; }
.iv-call-end { background: transparent; color: var(--kb-destructive); border-color: var(--kb-destructive); }
.iv-call-end:hover { background: color-mix(in srgb, var(--kb-destructive) 10%, transparent); }

.iv-mic {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  padding: .7rem 1.4rem;
  border-radius: 999px;
  font-size: .95rem;
  font-weight: 600;
  background: var(--kb-card);
  color: var(--kb-foreground);
  border: 1px solid var(--kb-border);
  cursor: pointer;
  transition: background .15s ease, opacity .12s ease;
}
.iv-mic:hover:not(:disabled) { background: var(--kb-muted); }
.iv-mic:disabled { opacity: .5; cursor: not-allowed; }
.iv-mic.is-recording {
  background: var(--kb-destructive);
  color: #fff;
  border-color: var(--kb-destructive);
  animation: iv-pulse 1.4s ease-in-out infinite;
}
@keyframes iv-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }

.iv-err {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  font-size: var(--kb-fs-caption);
  color: var(--kb-destructive);
}
</style>
