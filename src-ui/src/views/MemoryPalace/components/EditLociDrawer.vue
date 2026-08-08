<template>
  <div v-if="show" class="wb-drawer-mask" @click.self="$emit('update:show', false)">
    <div class="wb-drawer">
      <header class="wb-drawer-head">
        <div>
          <span class="wb-eyebrow wb-eyebrow-sm">Edit Loci</span>
          <h2 class="wb-drawer-title">{{ editingId ? '编辑位点' : '添加位点' }}</h2>
        </div>
        <button class="wb-icon-btn" @click="$emit('update:show', false)"><Icon name="x" :size="18" /></button>
      </header>
      <div class="wb-drawer-body">
        <div class="space-y-3">
          <div>
            <label class="kb-label">位点名称 *</label>
            <input v-model="form.name" class="kb-input" placeholder="如：书桌左上角" />
          </div>
          <div>
            <label class="kb-label">绑定的知识点</label>
            <textarea v-model="form.knowledgePoint" class="kb-input" rows="3" placeholder="这个位置要记住的内容…"></textarea>
          </div>
          <div>
            <label class="kb-label flex items-center justify-between">
              <span>联想图像描述</span>
              <!-- ✅ 优化三：单点 AI 重新生成联想图 -->
              <button
                type="button"
                class="kb-btn kb-btn-sm"
                :disabled="aiBusy || !form.name?.trim()"
                @click="$emit('ai-regen-image', form)"
                style="padding: 2px 8px; font-size: 11px;"
                :title="aiBusy ? '生成中…' : '让 AI 重新润色联想图描述'"
              >
                <Icon :name="aiBusy ? 'loader' : 'ai-sparkle'" :size="12" :class="{ 'ai-spin': aiBusy }" />
                {{ aiBusy ? '生成中' : 'AI 重新生成' }}
              </button>
            </label>
            <textarea
              v-model="form.imageHint"
              class="kb-input"
              rows="2"
              placeholder="越夸张越好记，如「一只大象在背单词」"
            ></textarea>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="kb-label">图标</label>
              <select v-model="form.icon" class="kb-input">
                <option value="map-pin">map-pin</option>
                <option value="book">book</option>
                <option value="lightbulb">lightbulb</option>
                <option value="star">star</option>
                <option value="tag">tag</option>
                <option value="key-round">key-round</option>
              </select>
            </div>
            <div>
              <label class="kb-label">漫游顺序</label>
              <input type="number" v-model.number="form.sortOrder" class="kb-input" />
            </div>
          </div>
          <div>
            <label class="kb-label">归类知识库分类</label>
            <select v-model="form.categoryId" class="kb-input">
              <option :value="undefined">未归类</option>
              <option v-for="c in flatCategories" :key="c.id" :value="c.id">
                {{ '　'.repeat(c.depth ?? 0) }}{{ c.name }}
              </option>
            </select>
          </div>
        </div>
      </div>
      <footer class="wb-drawer-foot">
        <button class="kb-btn" @click="$emit('update:show', false)">取消</button>
        <button class="kb-btn kb-btn-primary" @click="$emit('save', form)">保存</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import type { WbPalaceLociPayload, CategoryVO } from '@/api/types'

withDefaults(
  defineProps<{
    show: boolean
    editingId: number | null
    form: WbPalaceLociPayload
    flatCategories: CategoryVO[]
    aiBusy?: boolean
  }>(),
  { aiBusy: false },
)

defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'save', form: WbPalaceLociPayload): void
  /** 触发 AI 重新生成当前位点的 imageHint（在父组件中调 generateLociImageHint） */
  (e: 'ai-regen-image', form: WbPalaceLociPayload): void
}>()
</script>

<style scoped>
.ai-spin { animation: ai-spin 1s linear infinite; }
@keyframes ai-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
</style>