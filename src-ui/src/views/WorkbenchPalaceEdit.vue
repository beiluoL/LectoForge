<template>
  <div class="space-y-4 animate-fade-in">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="kb-h1 mb-1 flex items-center gap-2" style="color: var(--kb-foreground);">
          <Icon name="map-pin" :size="24" style="color: var(--kb-primary);" /> {{ palace?.name || '记忆宫殿' }}
        </h1>
        <p class="kb-body" style="color: var(--kb-muted-foreground);">拖拽位点布置空间布局，点击位点编辑绑定的知识点。沿路线漫游回忆。</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="kb-btn" @click="router.push('/workbench/palace')"><Icon name="chevron-left" :size="16" /> 返回</button>
        <button class="kb-btn kb-btn-primary" @click="showLociForm = true"><Icon name="plus" :size="16" /> 添加位点</button>
        <button class="kb-btn" @click="openAiLoci"><Icon name="ai-sparkle" :size="16" style="color: var(--kb-highlight);" /> AI 生成位点</button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- 画布 -->
      <div class="lg:col-span-2">
        <div
          ref="canvasRef"
          class="relative w-full border overflow-hidden select-none"
          style="background: var(--kb-card); border-color: var(--kb-border); aspect-ratio: 4 / 3; border-radius: var(--kb-radius-lg);"
          @click.self="deselect"
        >
          <!-- 主题背景提示 -->
          <div class="absolute top-3 left-3 flex items-center gap-1.5 text-[12px]" style="color: var(--kb-muted-foreground);">
            <Icon name="layout-grid" :size="14" /> {{ themeLabel(palace?.theme) }} 场景
          </div>

          <div
            v-for="(l, i) in loci"
            :key="l.id"
            class="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
            :style="{ left: (l.posX || 50) + '%', top: (l.posY || 50) + '%', zIndex: selectedId === l.id ? 20 : 10 }"
            @mousedown="startDrag(l, $event)"
            @click.stop="selectLoci(l)"
          >
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center shadow-sm border-2 transition-transform"
              :style="{
                background: selectedId === l.id ? 'var(--kb-primary)' : 'var(--kb-background)',
                borderColor: 'var(--kb-primary)',
                color: selectedId === l.id ? '#fff' : 'var(--kb-primary)',
                transform: selectedId === l.id ? 'scale(1.15)' : 'scale(1)',
              }"
            >
              <Icon :name="l.icon || 'map-pin'" :size="18" />
            </div>
            <div
              class="absolute left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 rounded text-[11px] whitespace-nowrap"
              style="background: var(--kb-foreground); color: var(--kb-background);"
            >{{ i + 1 }}. {{ l.name }}</div>
          </div>

          <div v-if="loci.length === 0" class="absolute inset-0 flex items-center justify-center">
            <p class="kb-body-sm" style="color: var(--kb-muted-foreground);">点击「添加位点」开始布置空间</p>
          </div>
        </div>
        <p class="text-[12px] mt-2" style="color: var(--kb-muted-foreground);">提示：拖动点位调整位置，点击点位编辑。编号即记忆漫游顺序。</p>
      </div>

      <!-- 位点列表 / 详情 -->
      <div class="space-y-3">
        <div class="border p-4" style="background: var(--kb-card); border-color: var(--kb-border); border-radius: var(--kb-radius-lg);">
          <h3 class="kb-h4 mb-3" style="color: var(--kb-foreground);">位点清单（漫游顺序）</h3>
          <div v-if="loci.length === 0" class="kb-body-sm" style="color: var(--kb-muted-foreground);">暂无位点</div>
          <div v-else class="space-y-2">
            <div
              v-for="(l, i) in loci"
              :key="l.id"
              class="flex items-center gap-2 p-2 rounded-md cursor-pointer"
              :style="{ background: selectedId === l.id ? 'var(--kb-muted)' : 'var(--kb-background)' }"
              @click="selectLoci(l)"
            >
              <span class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold" style="background: var(--kb-primary); color:#fff;">{{ i + 1 }}</span>
              <div class="flex-1 min-w-0">
                <p class="kb-body-sm truncate" style="color: var(--kb-foreground);">{{ l.name }}</p>
                <p class="text-[11px] truncate" style="color: var(--kb-muted-foreground);">{{ l.knowledgePoint || '未绑定知识点' }}</p>
              </div>
              <button class="wb-icon-btn" title="删除" @click.stop="removeLoci(l)"><Icon name="trash-2" :size="14" /></button>
            </div>
          </div>
        </div>

        <!-- 选中位点详情 -->
        <div v-if="selected" class="border p-4" style="background: var(--kb-card); border-color: var(--kb-border); border-radius: var(--kb-radius-md);">
          <h3 class="kb-h4 mb-2" style="color: var(--kb-foreground);">位点详情</h3>
          <p class="text-[12px] mb-2" style="color: var(--kb-muted-foreground);">名称：{{ selected.name }}</p>
          <p class="kb-body-sm mb-1" style="color: var(--kb-foreground);">归类分类</p>
          <p class="text-[12px] mb-2" style="color: var(--kb-muted-foreground);">
            <span v-if="categoryName(selected.categoryId)" class="px-1.5 py-0.5 rounded" style="background: rgba(59,111,224,0.10); color: var(--kb-primary);">{{ categoryName(selected.categoryId) }}</span>
            <span v-else>（未归类）</span>
          </p>
          <p class="kb-body-sm mb-1" style="color: var(--kb-foreground);">知识点</p>
          <p class="text-[12px] mb-2" style="color: var(--kb-muted-foreground);">{{ selected.knowledgePoint || '（空）' }}</p>
          <p class="kb-body-sm mb-1" style="color: var(--kb-foreground);">联想图像</p>
          <p class="text-[12px]" style="color: var(--kb-muted-foreground);">{{ selected.imageHint || '（空）' }}</p>
        </div>
      </div>
    </div>

    <!-- 位点编辑抽屉 -->
    <div v-if="showLociForm" class="wb-drawer-mask" @click.self="showLociForm = false">
      <div class="wb-drawer">
        <header class="wb-drawer-head">
          <div>
            <span class="wb-eyebrow wb-eyebrow-sm">Edit Loci</span>
            <h2 class="wb-drawer-title">{{ editingLociId ? '编辑位点' : '添加位点' }}</h2>
          </div>
          <button class="wb-icon-btn" @click="showLociForm = false"><Icon name="x" :size="18" /></button>
        </header>
        <div class="wb-drawer-body">
          <div class="space-y-3">
            <div>
              <label class="kb-label">位点名称 *</label>
              <input v-model="lociForm.name" class="kb-input" placeholder="如：书桌左上角" />
            </div>
            <div>
              <label class="kb-label">绑定的知识点</label>
              <textarea v-model="lociForm.knowledgePoint" class="kb-input" rows="3" placeholder="这个位置要记住的内容…"></textarea>
            </div>
            <div>
              <label class="kb-label">联想图像描述</label>
              <input v-model="lociForm.imageHint" class="kb-input" placeholder="越夸张越好记，如「一只大象在背单词」" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="kb-label">图标</label>
                <select v-model="lociForm.icon" class="kb-input">
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
                <input type="number" v-model.number="lociForm.sortOrder" class="kb-input" />
              </div>
            </div>
            <div>
              <label class="kb-label">归类知识库分类</label>
              <select v-model="lociForm.categoryId" class="kb-input">
                <option :value="undefined">未归类</option>
                <option v-for="c in flatCategories" :key="c.id" :value="c.id">{{ '　'.repeat(c.depth ?? 0) }}{{ c.name }}</option>
              </select>
            </div>
          </div>
        </div>
        <footer class="wb-drawer-foot">
          <button class="kb-btn" @click="showLociForm = false">取消</button>
          <button class="kb-btn kb-btn-primary" @click="saveLoci">保存</button>
        </footer>
      </div>
    </div>

    <!-- AI 生成记忆位点抽屉（F1/F2） -->
    <div v-if="showAiLoci" class="wb-drawer-mask" @click.self="showAiLoci = false">
      <div class="wb-drawer">
        <header class="wb-drawer-head">
          <div>
            <span class="wb-eyebrow wb-eyebrow-sm">AI Loci</span>
            <h2 class="wb-drawer-title">AI 生成记忆位点</h2>
          </div>
          <button class="wb-icon-btn" @click="showAiLoci = false"><Icon name="x" :size="18" /></button>
        </header>
        <div class="wb-drawer-body">
          <p class="kb-body-sm mb-3" style="color: var(--kb-muted-foreground);">给一个主题和要点，AI 会生成有序位点（含名称、知识点与联想图像），确认后一键批量落库。</p>

          <div class="space-y-3">
            <div>
              <label class="kb-label">场景主题</label>
              <input v-model="aiTheme" class="kb-input" placeholder="如：我的卧室 / 公司走廊" />
            </div>
            <div>
              <label class="kb-label">要点（每行一个，可留空由 AI 自由发挥）</label>
              <textarea v-model="aiPoints" class="kb-input" rows="5" placeholder="SM-2 算法四步&#10;遗忘曲线&#10;主动回忆"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="kb-label">生成数量</label>
                <input type="number" v-model.number="aiCount" min="1" max="12" class="kb-input" />
              </div>
            </div>

            <div v-if="aiLociHint" class="ai-hint">
              <Icon name="info" :size="14" />
              <span>未配置 AI 服务，无法生成位点。</span>
              <router-link to="/settings/ai">前往 AI 设置</router-link>
            </div>

            <button class="kb-btn ai-btn w-full" :disabled="aiGenerating" @click="runGenerateLoci">
              <Icon :name="aiGenerating ? 'loader' : 'ai-sparkle'" :size="14" :class="{ 'ai-spin': aiGenerating }" />
              {{ aiGenerating ? '生成中…' : '生成位点' }}
            </button>

            <div v-if="aiLoci.length" class="space-y-2">
              <p class="kb-label">预览（共 {{ aiLoci.length }} 个）</p>
              <div
                v-for="(l, i) in aiLoci"
                :key="'al' + i"
                class="border p-3"
                style="background: var(--kb-card); border-color: var(--kb-border); border-radius: var(--kb-radius-md);"
              >
                <p class="kb-body-sm" style="color: var(--kb-foreground);">
                  <span class="font-bold" style="color: var(--kb-primary);">{{ i + 1 }}.</span> {{ l.name }}
                </p>
                <p class="kb-body-sm mt-1" style="color: var(--kb-muted-foreground);">{{ l.knowledgePoint }}</p>
                <p v-if="l.imageHint" class="kb-caption mt-1" style="color: var(--kb-highlight);">联想图像：{{ l.imageHint }}</p>
              </div>
              <button class="kb-btn kb-btn-primary w-full" :disabled="aiAdding" @click="addAllLoci">
                <Icon :name="aiAdding ? 'loader' : 'check'" :size="14" :class="{ 'ai-spin': aiAdding }" />
                {{ aiAdding ? '添加中…' : '全部添加到宫殿' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError } from '@/utils/toast'
import { getPalace, listLoci, createLoci, updateLoci, deleteLoci, getCategoryTree } from '@/api/workbench'
import { generatePalaceLoci, type PalaceLociItem } from '@/api/ai'
import type { WbPalace, WbPalaceLoci, WbPalaceLociPayload, CategoryVO } from '@/api/types'
import './ai-shared.css'

const route = useRoute()
const router = useRouter()
const palaceId = Number(route.params.id)
const palace = ref<WbPalace | null>(null)
const loci = ref<WbPalaceLoci[]>([])
const selectedId = ref<number | null>(null)
const selected = ref<WbPalaceLoci | null>(null)
const canvasRef = ref<HTMLElement | null>(null)
const categories = ref<CategoryVO[]>([])
const flatCategories = ref<CategoryVO[]>([])
const categoryMap = ref<Map<number, string>>(new Map())

// 递归展平分类树，保留层级缩进所需的 depth
function flatten(nodes: CategoryVO[], depth = 0): CategoryVO[] {
  const out: CategoryVO[] = []
  for (const n of nodes) {
    out.push({ ...n, depth })
    if (n.children && n.children.length) out.push(...flatten(n.children, depth + 1))
  }
  return out
}
function categoryName(id?: number) {
  return id ? categoryMap.value.get(id) || '' : ''
}

const showLociForm = ref(false)
const editingLociId = ref<number | null>(null)
const lociForm = reactive<WbPalaceLociPayload>({
  palaceId: palaceId,
  name: '',
  knowledgePoint: '',
  imageHint: '',
  icon: 'map-pin',
  categoryId: undefined,
  posX: 50,
  posY: 50,
  sortOrder: 0,
})

let dragState: { id: number; startX: number; startY: number; baseX: number; baseY: number } | null = null

async function load() {
  try {
    palace.value = await getPalace(palaceId)
    loci.value = await listLoci(palaceId)
  } catch (e) {
    notify(getApiError(e, '加载失败'), 'error')
  }
}
async function loadCategories() {
  try {
    categories.value = await getCategoryTree()
    flatCategories.value = flatten(categories.value)
    const map = new Map<number, string>()
    flatCategories.value.forEach((c) => map.set(c.id, c.name))
    categoryMap.value = map
  } catch {
    /* 分类下拉为增强项，失败不影响主流程 */
  }
}

function selectLoci(l: WbPalaceLoci) {
  selectedId.value = l.id
  selected.value = l
}
function deselect() {
  selectedId.value = null
  selected.value = null
}

function startDrag(l: WbPalaceLoci, ev: MouseEvent) {
  ev.preventDefault()
  const baseX = l.posX ?? 50
  const baseY = l.posY ?? 50
  dragState = { id: l.id, startX: ev.clientX, startY: ev.clientY, baseX, baseY }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
}
function onDrag(ev: MouseEvent) {
  if (!dragState || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const dx = ((ev.clientX - dragState.startX) / rect.width) * 100
  const dy = ((ev.clientY - dragState.startY) / rect.height) * 100
  const nx = Math.min(98, Math.max(2, Math.round(dragState.baseX + dx)))
  const ny = Math.min(98, Math.max(2, Math.round(dragState.baseY + dy)))
  const target = loci.value.find((x) => x.id === dragState!.id)
  if (target) {
    target.posX = nx
    target.posY = ny
  }
}
async function endDrag() {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
  if (dragState) {
    const target = loci.value.find((x) => x.id === dragState!.id)
    if (target) {
      try {
        await updateLoci(target.id, {
          palaceId: target.palaceId,
          name: target.name,
          knowledgePoint: target.knowledgePoint,
          imageHint: target.imageHint,
          icon: target.icon,
          categoryId: target.categoryId,
          posX: target.posX,
          posY: target.posY,
          sortOrder: target.sortOrder,
        })
      } catch (e) {
        notify(getApiError(e, '位置保存失败'), 'error')
      }
    }
  }
  dragState = null
}

function openCreateLoci() {
  editingLociId.value = null
  const next = loci.value.length + 1
  Object.assign(lociForm, {
    palaceId: palaceId,
    name: '',
    knowledgePoint: '',
    imageHint: '',
    icon: 'map-pin',
    categoryId: undefined,
    posX: 50,
    posY: 50,
    sortOrder: next,
  })
  showLociForm.value = true
}
function editLoci(l: WbPalaceLoci) {
  editingLociId.value = l.id
  Object.assign(lociForm, {
    palaceId: l.palaceId,
    name: l.name,
    knowledgePoint: l.knowledgePoint || '',
    imageHint: l.imageHint || '',
    icon: l.icon || 'map-pin',
    categoryId: l.categoryId,
    posX: l.posX,
    posY: l.posY,
    sortOrder: l.sortOrder,
  })
  showLociForm.value = true
}
async function saveLoci() {
  if (!lociForm.name.trim()) {
    notify('位点名称不能为空', 'warning')
    return
  }
  try {
    if (editingLociId.value) {
      await updateLoci(editingLociId.value, { ...lociForm })
    } else {
      await createLoci({ ...lociForm })
    }
    notify('已保存', 'success')
    showLociForm.value = false
    await load()
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  }
}
async function removeLoci(l: WbPalaceLoci) {
  if (!confirm('确认删除该位点？')) return
  try {
    await deleteLoci(l.id)
    notify('已删除', 'success')
    deselect()
    load()
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
}
function themeLabel(t?: string) {
  return { ROOM: '房间', STREET: '街道', CAMPUS: '校园', CUSTOM: '自定义' }[t || ''] || t || ''
}

// ===== AI 生成记忆位点（F1/F2）：仅生成草稿，逐张走 createLoci 落库，不自动改库 =====
const showAiLoci = ref(false)
const aiTheme = ref('')
const aiPoints = ref('')
const aiCount = ref(6)
const aiGenerating = ref(false)
const aiAdding = ref(false)
const aiLoci = ref<PalaceLociItem[]>([])
const aiLociHint = ref(false)

function openAiLoci() {
  aiTheme.value = themeLabel(palace.value?.theme) || ''
  aiLoci.value = []
  aiLociHint.value = false
  showAiLoci.value = true
}

async function runGenerateLoci() {
  if (aiGenerating.value) return
  aiGenerating.value = true
  aiLociHint.value = false
  try {
    const res = await generatePalaceLoci({
      theme: aiTheme.value.trim() || undefined,
      count: aiCount.value,
      points: aiPoints.value.split('\n').map((s) => s.trim()).filter(Boolean),
    })
    aiLoci.value = res.loci
    notify(`已生成 ${res.loci.length} 个位点`, 'success')
  } catch (e) {
    const msg = getApiError(e, 'AI 生成失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiLociHint.value = true
    notify(msg, 'error')
  } finally {
    aiGenerating.value = false
  }
}

/** 把 n 个位点在画布上均匀铺成网格，避免重叠 */
function positionFor(i: number, n: number) {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const col = i % cols
  const row = Math.floor(i / cols)
  const x = ((col + 0.5) / cols) * 100
  const y = ((row + 0.5) / rows) * 100
  return {
    x: Math.min(92, Math.max(8, Math.round(x))),
    y: Math.min(92, Math.max(8, Math.round(y))),
  }
}

async function addAllLoci() {
  if (!aiLoci.value.length || aiAdding.value) return
  aiAdding.value = true
  try {
    const n = aiLoci.value.length
    for (let i = 0; i < n; i++) {
      const l = aiLoci.value[i]
      const p = positionFor(i, n)
      await createLoci({
        palaceId,
        name: l.name,
        knowledgePoint: l.knowledgePoint,
        imageHint: l.imageHint,
        icon: 'map-pin',
        categoryId: undefined,
        posX: p.x,
        posY: p.y,
        sortOrder: loci.value.length + i + 1,
      })
    }
    notify(`已添加 ${n} 个位点`, 'success')
    showAiLoci.value = false
    aiLoci.value = []
    await load()
  } catch (e) {
    notify(getApiError(e, '添加失败'), 'error')
  } finally {
    aiAdding.value = false
  }
}

onMounted(() => {
  load()
  loadCategories()
  // 从列表/笔记跳转预填（如有 query）可在此扩展
  if (route.query.new === '1') openCreateLoci()
})
</script>
