<template>
  <div v-if="show" class="wb-drawer-mask" @click.self="$emit('update:show', false)">
    <div class="wb-drawer">
      <header class="wb-drawer-head">
        <div>
          <span class="wb-eyebrow wb-eyebrow-sm">AI Loci</span>
          <h2 class="wb-drawer-title">AI 生成记忆位点</h2>
        </div>
        <button class="wb-icon-btn" @click="$emit('update:show', false)"><Icon name="x" :size="18" /></button>
      </header>
      <div class="wb-drawer-body">
        <p class="kb-body-sm mb-3" style="color: var(--kb-muted-foreground);">
          给一个主题和要点，AI 会生成有序位点（含名称、知识点与联想图像），确认后一键批量落库。
        </p>

        <div class="space-y-3">
          <div>
            <label class="kb-label">场景主题</label>
            <input :value="theme" @input="$emit('update:theme', ($event.target as HTMLInputElement).value)" class="kb-input" placeholder="如：我的卧室 / 公司走廊" />
          </div>
          <div>
            <label class="kb-label">要点（每行一个，可留空由 AI 自由发挥）</label>
            <textarea :value="points" @input="$emit('update:points', ($event.target as HTMLTextAreaElement).value)" class="kb-input" rows="5" placeholder="SM-2 算法四步&#10;遗忘曲线&#10;主动回忆"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="kb-label">生成数量</label>
              <input type="number" :value="count" min="1" max="12" @input="$emit('update:count', Number(($event.target as HTMLInputElement).value))" class="kb-input" />
            </div>
          </div>

          <div v-if="hint" class="ai-hint">
            <Icon name="info" :size="14" />
            <span>未配置 AI 服务，无法生成位点。</span>
            <router-link to="/settings/ai">前往 AI 设置</router-link>
          </div>

          <button class="kb-btn ai-btn w-full" :disabled="generating" @click="$emit('generate')">
            <Icon :name="generating ? 'loader' : 'ai-sparkle'" :size="14" :class="{ 'ai-spin': generating }" />
            {{ generating ? '生成中…' : '生成位点' }}
          </button>

          <div v-if="preview.length" class="space-y-2">
            <p class="kb-label">预览（共 {{ preview.length }} 个）</p>
            <div
              v-for="(l, i) in preview"
              :key="'al' + i"
              class="border p-3"
              style="background: var(--kb-card); border-color: var(--kb-border); border-radius: var(--kb-radius-md);"
            >
              <p class="kb-body-sm" style="color: var(--kb-foreground);">
                <span class="font-bold" style="color: var(--kb-primary);">{{ i + 1 }}.</span> {{ l.name }}
              </p>
              <p class="kb-body-sm mt-1" style="color: var(--kb-muted-foreground);">{{ l.knowledgePoint }}</p>
              <p v-if="l.imageHint" class="kb-caption mt-1" style="color: var(--kb-highlight);">
                联想图像：{{ l.imageHint }}
              </p>
            </div>
            <button class="kb-btn kb-btn-primary w-full" :disabled="adding" @click="$emit('add-all')">
              <Icon :name="adding ? 'loader' : 'check'" :size="14" :class="{ 'ai-spin': adding }" />
              {{ adding ? '添加中…' : '全部添加到宫殿' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import type { PalaceLociItem } from '@/api/ai'

defineProps<{
  show: boolean
  theme: string
  points: string
  count: number
  generating: boolean
  adding: boolean
  hint: boolean
  preview: PalaceLociItem[]
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'update:theme', v: string): void
  (e: 'update:points', v: string): void
  (e: 'update:count', v: number): void
  (e: 'generate'): void
  (e: 'add-all'): void
}>()
</script>

<style scoped>
.ai-spin { animation: ai-spin 1s linear infinite; }
@keyframes ai-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
</style>