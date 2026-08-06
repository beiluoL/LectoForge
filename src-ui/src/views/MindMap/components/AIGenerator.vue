<template>
  <div class="mm-ai-mask" @click.self="close">
    <section class="mm-ai-panel" role="dialog" aria-label="AI 生成思维导图">
      <header class="mm-ai-head">
        <span class="mm-ai-title">
          <Icon name="ai-sparkle" size="md" style="color: var(--kb-highlight);" />
          AI 生成思维导图
        </span>
        <button type="button" class="mm-icon-btn" title="关闭" @click="close">
          <Icon name="x" size="sm" />
        </button>
      </header>

      <div class="mm-ai-body">
        <label class="kb-label" for="mm-ai-topic">主题或一句话需求</label>
        <textarea
          id="mm-ai-topic"
          ref="inputRef"
          v-model="topic"
          class="kb-input mm-ai-textarea"
          rows="3"
          placeholder="例如：帮我生成一个《Java 全栈学习路线》的思维导图大纲"
          @keydown.meta.enter="submit"
          @keydown.ctrl.enter="submit"
        />

        <div class="mm-ai-presets">
          <button
            v-for="p in PRESETS"
            :key="p"
            type="button"
            class="mm-ai-chip"
            @click="topic = p"
          >
            {{ p }}
          </button>
        </div>

        <div class="mm-ai-params">
          <div>
            <label class="kb-label" for="mm-ai-branches">一级分支</label>
            <select id="mm-ai-branches" v-model.number="branches" class="kb-select">
              <option v-for="v in [3, 4, 5, 6, 8]" :key="v" :value="v">{{ v }} 个</option>
            </select>
          </div>
          <div>
            <label class="kb-label" for="mm-ai-depth">层级深度</label>
            <select id="mm-ai-depth" v-model.number="depth" class="kb-select">
              <option v-for="v in [2, 3, 4, 5]" :key="v" :value="v">{{ v }} 级</option>
            </select>
          </div>
        </div>

        <p class="mm-ai-warn">
          <Icon name="alert-circle" size="xs" />
          生成结果会<strong>覆盖当前大纲</strong>，请先确认已保存需要保留的内容。
        </p>
      </div>

      <footer class="mm-ai-foot">
        <span class="mm-ai-hint">⌘/Ctrl + Enter 快速生成</span>
        <span class="flex-1" />
        <button type="button" class="kb-btn kb-btn-sm" @click="close">取消</button>
        <button
          type="button"
          class="kb-btn kb-btn-sm kb-btn-primary"
          :disabled="mapState.aiLoading || !topic.trim()"
          @click="submit"
        >
          <Icon :name="mapState.aiLoading ? 'loader' : 'ai-sparkle'" size="xs" :class="mapState.aiLoading ? 'animate-spin' : ''" />
          {{ mapState.aiLoading ? '生成中…' : '生成大纲' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 生成弹窗
 *
 * 只负责收集「主题 + 分支数 + 深度」并派发，真正的请求与状态覆盖在 store 的 generateByAi 里，
 * 这样导图视图 / 大纲视图不需要感知 AI 的存在，拿到新的 outlineData 自然就重渲染了。
 * 后端未配置 Key 时返回的是 Mock 结构（不是错误），生成流程照常走完，只是提示文案不同。
 */
import { nextTick, onMounted, ref } from 'vue'

import Icon from '@/components/ui/Icon.vue'

import { generateByAi, mapState } from '../useMindMapStore'

const emit = defineEmits<{ (e: 'close'): void }>()

const PRESETS = [
  'Java 全栈学习路线',
  '微服务架构设计',
  'Vue 3 源码核心机制',
  '产品需求文档撰写方法',
]

const topic = ref('')
const branches = ref(5)
const depth = ref(3)
const inputRef = ref<HTMLTextAreaElement | null>(null)

onMounted(() => {
  void nextTick(() => inputRef.value?.focus())
})

function close() {
  if (mapState.aiLoading) return // 生成中关掉会让用户以为失败了，索性挡住
  emit('close')
}

async function submit() {
  if (mapState.aiLoading || !topic.value.trim()) return
  const ok = await generateByAi(topic.value, { depth: depth.value, branches: branches.value })
  if (ok) emit('close')
}
</script>
