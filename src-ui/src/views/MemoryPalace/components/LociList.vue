<template>
  <div class="space-y-3">
    <!-- ============ 位点清单 ============ -->
    <div
      class="border p-4"
      style="background: var(--kb-card); border-color: var(--kb-border); border-radius: var(--kb-radius-lg);"
    >
      <h3 class="kb-h4 mb-3" style="color: var(--kb-foreground);">位点清单（漫游顺序）</h3>
      <div v-if="loci.length === 0" class="kb-body-sm" style="color: var(--kb-muted-foreground);">暂无位点</div>
      <div v-else class="space-y-2">
        <div
          v-for="(l, i) in loci"
          :key="l.id"
          class="flex items-center gap-2 p-2 rounded-md cursor-pointer"
          :style="{ background: selectedId === l.id ? 'var(--kb-muted)' : 'var(--kb-background)' }"
          @click="$emit('select', l)"
        >
          <span
            class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
            style="background: var(--kb-primary); color:#fff;"
          >{{ i + 1 }}</span>
          <div class="flex-1 min-w-0">
            <p class="kb-body-sm truncate" style="color: var(--kb-foreground);">{{ l.name }}</p>
            <p class="text-[11px] truncate" style="color: var(--kb-muted-foreground);">
              {{ l.knowledgePoint || '未绑定知识点' }}
            </p>
          </div>
          <button class="wb-icon-btn" title="删除" @click.stop="$emit('remove', l)">
            <Icon name="trash-2" :size="'sm'" />
          </button>
        </div>
      </div>
    </div>

    <!-- ============ 选中位点详情 ============ -->
    <div
      v-if="selected"
      class="border p-4"
      style="background: var(--kb-card); border-color: var(--kb-border); border-radius: var(--kb-radius-md);"
    >
      <h3 class="kb-h4 mb-2" style="color: var(--kb-foreground);">位点详情</h3>
      <p class="text-[12px] mb-2" style="color: var(--kb-muted-foreground);">名称：{{ selected.name }}</p>
      <p class="kb-body-sm mb-1" style="color: var(--kb-foreground);">归类分类</p>
      <p class="text-[12px] mb-2" style="color: var(--kb-muted-foreground);">
        <span
          v-if="categoryName(selected.categoryId)"
          class="px-1.5 py-0.5 rounded"
          style="background: rgba(59,111,224,0.10); color: var(--kb-primary);"
        >{{ categoryName(selected.categoryId) }}</span>
        <span v-else>（未归类）</span>
      </p>
      <p class="kb-body-sm mb-1" style="color: var(--kb-foreground);">知识点</p>
      <p class="text-[12px] mb-2" style="color: var(--kb-muted-foreground);">{{ selected.knowledgePoint || '（空）' }}</p>
      <p class="kb-body-sm mb-1" style="color: var(--kb-foreground);">联想图像</p>
      <p class="text-[12px]" style="color: var(--kb-muted-foreground);">{{ selected.imageHint || '（空）' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import type { WbPalaceLoci } from '@/api/types'

defineProps<{
  loci: WbPalaceLoci[]
  selectedId: number | null
  selected: WbPalaceLoci | null
  categoryName: (id?: number) => string
}>()

defineEmits<{
  (e: 'select', loci: WbPalaceLoci): void
  (e: 'remove', loci: WbPalaceLoci): void
}>()
</script>