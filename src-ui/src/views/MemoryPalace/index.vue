<template>
  <div class="mp-root">
    <!-- ===== 总览模式：宫殿列表 ===== -->
    <div v-if="!palaceId">
      <PalaceHome
        :palaces="palaces"
        :loading="loading"
        :show-create="showCreate"
        :form="createForm"
        :color-presets="colorPresets"
        @open-create="showCreate = true"
        @close-create="showCreate = false"
        @open-palace="goPalace"
        @delete-palace="onDeletePalace"
        @submit-create="onCreatePalace"
        @form-field="onFormField"
        @form-color="(c: string) => (createForm.coverColor = c)"
      />
      <div class="mt-4 text-center">
        <button class="kb-btn kb-btn-sm" @click="goMock">
          <Icon name="flask-conical" :size="14" /> 没有数据？打开演示宫殿「并发编程公寓」
        </button>
      </div>
    </div>

    <!-- ===== 编辑模式：单宫殿空间 / 漫游 / 复习 ===== -->
    <div v-else class="space-y-4 animate-fade-in">
      <!-- 顶栏 -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 class="kb-h1 mb-1 flex items-center gap-2" style="color: var(--kb-foreground);">
            <Icon name="map-pin" :size="24" style="color: var(--kb-primary);" />
            {{ palace?.name || (isMock ? '并发编程公寓' : '记忆宫殿') }}
          </h1>
          <p class="kb-body" style="color: var(--kb-muted-foreground);">
            {{
              isMock
                ? '演示数据（纯本地，可拖拽布置 / 漫游 / 复习，不落库）'
                : '拖拽位点布置空间布局，点击位点编辑绑定的知识点。沿路线漫游回忆。'
            }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button class="kb-btn" @click="goHome"><Icon name="chevron-left" :size="16" /> 返回</button>
          <button v-if="!isMock" class="kb-btn kb-btn-primary" @click="openCreateLoci">
            <Icon name="plus" :size="16" /> 添加位点
          </button>
          <button class="kb-btn" @click="openAiLoci">
            <Icon name="ai-sparkle" :size="16" style="color: var(--kb-highlight);" /> AI 生成位点
          </button>
          <button class="kb-btn" :disabled="store.lociList.length === 0" @click="startTour">
            <Icon name="route" :size="16" /> 开始漫游
          </button>
          <button class="kb-btn" :disabled="store.lociList.length === 0" @click="startReview">
            <Icon name="brain" :size="16" /> 复习测试
            <span
              v-if="store.reviewDueLoci.length"
              class="ml-1 rounded-full px-1.5 text-xs"
              style="background: var(--kb-highlight); color: #fff;"
            >{{ store.reviewDueLoci.length }}</span>
          </button>
        </div>
      </div>

      <!-- 演示数据被清空兜底 -->
      <div
        v-if="isMock && store.lociList.length === 0"
        class="border p-4 rounded-md flex items-center justify-between"
        style="background: var(--kb-card); border-color: var(--kb-border);"
      >
        <span class="kb-body-sm" style="color: var(--kb-muted-foreground);">演示位点已清空。</span>
        <button class="kb-btn kb-btn-primary" @click="loadMock">
          <Icon name="rotate-ccw" :size="14" /> 重新加载演示数据
        </button>
      </div>

      <!-- 编辑网格 -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2">
          <SpaceCanvas
            :loci="store.lociList"
            :selected-id="selectedId"
            :theme-label="themeLabel(palace?.theme)"
            @select="onSelect"
            @deselect="onDeselect"
            @position-change="onPositionChange"
          />
        </div>
        <div>
          <LociList
            :loci="store.lociList"
            :selected-id="selectedId"
            :selected="selected"
            :category-name="categoryName"
            @select="onSelect"
            @remove="onRemoveLoci"
          />
          <div v-if="selected" class="mt-3">
            <button class="kb-btn w-full" @click="openEditLoci(selected)">
              <Icon name="pencil" :size="14" /> 编辑选中位点
            </button>
          </div>
        </div>
      </div>

      <!-- 编辑抽屉 -->
      <EditLociDrawer
        :show="showLociDrawer"
        :editing-id="editingLociId"
        :form="lociForm"
        :flat-categories="flatCategories"
        :ai-busy="aiImageBusy"
        @update:show="(v: boolean) => (showLociDrawer = v)"
        @save="onSaveLoci"
        @ai-regen-image="onRegenImage"
      />

      <!-- AI 生成抽屉 -->
      <AIGenerator
        :show="showAiDrawer"
        :theme="aiTheme"
        :points="aiPoints"
        :count="aiCount"
        :generating="aiGenerating"
        :adding="aiAdding"
        :hint="aiHint"
        :preview="aiPreview"
        @update:show="(v: boolean) => (showAiDrawer = v)"
        @update:theme="(v: string) => (aiTheme = v)"
        @update:points="(v: string) => (aiPoints = v)"
        @update:count="(v: number) => (aiCount = v)"
        @generate="runGenerateLoci"
        @add-all="addAllLoci"
      />

      <!-- 全屏漫游 -->
      <TourView
        v-if="mode === 'tour'"
        :loci="store.lociList"
        :initial-index="currentTourIndex"
        @exit="exitTour"
      />

      <!-- 全屏复习 -->
      <ReviewSession
        v-if="mode === 'review'"
        :loci="store.lociList"
        :master-levels="masterLevels"
        @exit="exitReview"
        @grade="onGrade"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import Icon from '@/components/ui/Icon.vue'
import { notify, confirmDialog, getApiError } from '@/utils/toast'
import {
  listPalaces,
  createPalace,
  deletePalace,
  getPalace,
  createLoci,
  updateLoci,
  deleteLoci,
  getCategoryTree,
} from '@/api/workbench'
import { generatePalaceLoci, regeneratePalaceLociImageHint, type PalaceLociItem } from '@/api/ai'
import type {
  WbPalace,
  WbPalacePayload,
  WbPalaceLoci,
  WbPalaceLociPayload,
  CategoryVO,
} from '@/api/types'
import { useMemoryPalaceStore, MOCK_PALACE_ID } from '@/store/memoryPalace'

import PalaceHome from './components/PalaceHome.vue'
import SpaceCanvas from './components/SpaceCanvas.vue'
import LociList from './components/LociList.vue'
import EditLociDrawer from './components/EditLociDrawer.vue'
import AIGenerator from './components/AIGenerator.vue'
import TourView from './components/TourView.vue'
import ReviewSession from './components/ReviewSession.vue'

const route = useRoute()
const router = useRouter()
const store = useMemoryPalaceStore()
const { currentTourIndex, masterLevels } = storeToRefs(store)

const palaceId = computed(() => (route.params.id ? Number(route.params.id) : null))
const isMock = computed(() => palaceId.value === MOCK_PALACE_ID)

const palace = ref<WbPalace | null>(null)
const mode = ref<'space' | 'tour' | 'review'>('space')

// ===================== 总览模式 =====================
const palaces = ref<WbPalace[]>([])
const loading = ref(true)
const showCreate = ref(false)
const createForm = reactive<WbPalacePayload>({ name: '', description: '', theme: 'ROOM', coverColor: '#3B6FE0' })
const colorPresets = ['#3B6FE0', '#8B5CF6', '#F59E0B', '#10B981', '#FF6B35', '#EF4444']

async function loadPalaces() {
  loading.value = true
  try {
    palaces.value = await listPalaces()
  } catch (e) {
    notify(getApiError(e, '加载失败'), 'error')
  } finally {
    loading.value = false
  }
}
function goPalace(p: WbPalace) {
  router.push(`/workbench/palace/${p.id}`)
}
function goMock() {
  router.push(`/workbench/palace/${MOCK_PALACE_ID}`)
}
async function onDeletePalace(p: WbPalace) {
  const ok = await confirmDialog('确认删除该宫殿及其所有位点？')
  if (!ok) return
  try {
    await deletePalace(p.id)
    notify('已删除', 'success')
    loadPalaces()
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
}
async function onCreatePalace() {
  if (!createForm.name.trim()) {
    notify('名称不能为空', 'warning')
    return
  }
  try {
    await createPalace({ ...createForm })
    notify('已创建', 'success')
    showCreate.value = false
    Object.assign(createForm, { name: '', description: '', theme: 'ROOM', coverColor: '#3B6FE0' })
    loadPalaces()
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  }
}
function onFormField(key: 'name' | 'description' | 'theme', ev: Event) {
  ;(createForm as Record<string, unknown>)[key] = (ev.target as HTMLInputElement | HTMLSelectElement).value
}

// ===================== 编辑模式：位点选择 / 拖拽 =====================
const selectedId = ref<number | null>(null)
const selected = computed(() => store.lociList.find((l) => l.id === selectedId.value) || null)

function onSelect(l: WbPalaceLoci) {
  selectedId.value = l.id
}
function onDeselect() {
  selectedId.value = null
}
function onPositionChange(id: number, x: number, y: number) {
  if (isMock.value) {
    const t = store.lociList.find((l) => l.id === id)
    if (t) {
      t.posX = x
      t.posY = y
    }
    return
  }
  store
    .updateLociPosition(id, x, y)
    .catch((e) => notify(getApiError(e, '位置保存失败'), 'error'))
}

async function onRemoveLoci(l: WbPalaceLoci) {
  if (selectedId.value === l.id) onDeselect()
  if (isMock.value) {
    store.lociList = store.lociList.filter((x) => x.id !== l.id)
    return
  }
  if (!window.confirm('确认删除该位点？')) return
  try {
    await deleteLoci(l.id)
    notify('已删除', 'success')
    await store.fetchLoci(palaceId.value!)
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
}

// ===================== 编辑抽屉 =====================
const showLociDrawer = ref(false)
const editingLociId = ref<number | null>(null)
const lociForm = reactive<WbPalaceLociPayload>({
  palaceId: 0,
  name: '',
  knowledgePoint: '',
  imageHint: '',
  icon: 'map-pin',
  categoryId: undefined,
  posX: 50,
  posY: 50,
  sortOrder: 1,
})

function openCreateLoci() {
  editingLociId.value = null
  Object.assign(lociForm, {
    palaceId: store.activePalaceId ?? palaceId.value ?? 0,
    name: '',
    knowledgePoint: '',
    imageHint: '',
    icon: 'map-pin',
    categoryId: undefined,
    posX: 50,
    posY: 50,
    sortOrder: store.lociList.length + 1,
  })
  showLociDrawer.value = true
}
function openEditLoci(l: WbPalaceLoci) {
  editingLociId.value = l.id
  Object.assign(lociForm, {
    palaceId: l.palaceId,
    name: l.name,
    knowledgePoint: l.knowledgePoint || '',
    imageHint: l.imageHint || '',
    icon: l.icon || 'map-pin',
    categoryId: l.categoryId,
    posX: l.posX ?? 50,
    posY: l.posY ?? 50,
    sortOrder: l.sortOrder ?? store.lociList.length + 1,
  })
  showLociDrawer.value = true
}
async function onSaveLoci(form: WbPalaceLociPayload) {
  if (!form.name?.trim()) {
    notify('位点名称不能为空', 'warning')
    return
  }
  if (isMock.value) {
    if (editingLociId.value) {
      const t = store.lociList.find((x) => x.id === editingLociId.value)
      if (t) Object.assign(t, form)
    } else {
      store.lociList.push({
        ...form,
        id: -Date.now(),
        userId: 0,
        palaceId: store.activePalaceId ?? MOCK_PALACE_ID,
        sortOrder: store.lociList.length + 1,
      })
    }
    showLociDrawer.value = false
    return
  }
  try {
    if (editingLociId.value) await updateLoci(editingLociId.value, { ...form })
    else await createLoci({ ...form })
    notify('已保存', 'success')
    showLociDrawer.value = false
    await store.fetchLoci(palaceId.value!)
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  }
}

const aiImageBusy = ref(false)
async function onRegenImage(form: WbPalaceLociPayload) {
  if (aiImageBusy.value) return
  aiImageBusy.value = true
  try {
    const res = await regeneratePalaceLociImageHint({ name: form.name, knowledgePoint: form.knowledgePoint })
    form.imageHint = res.imageHint
    notify('已重新生成联想图', 'success')
  } catch (e) {
    notify(getApiError(e, '生成失败'), 'error')
  } finally {
    aiImageBusy.value = false
  }
}

// ===================== AI 生成位点 =====================
const showAiDrawer = ref(false)
const aiTheme = ref('')
const aiPoints = ref('')
const aiCount = ref(6)
const aiGenerating = ref(false)
const aiAdding = ref(false)
const aiHint = ref(false)
const aiPreview = ref<PalaceLociItem[]>([])

function openAiLoci() {
  aiTheme.value = themeLabel(palace.value?.theme) || ''
  aiPreview.value = []
  aiHint.value = false
  showAiDrawer.value = true
}
async function runGenerateLoci() {
  if (aiGenerating.value) return
  aiGenerating.value = true
  aiHint.value = false
  try {
    const res = await generatePalaceLoci({
      theme: aiTheme.value.trim() || undefined,
      count: aiCount.value,
      points: aiPoints.value.split('\n').map((s) => s.trim()).filter(Boolean),
    })
    aiPreview.value = res.loci
    notify(`已生成 ${res.loci.length} 个位点`, 'success')
  } catch (e) {
    const msg = getApiError(e, 'AI 生成失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiHint.value = true
    notify(msg, 'error')
  } finally {
    aiGenerating.value = false
  }
}
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
  if (!aiPreview.value.length || aiAdding.value) return
  aiAdding.value = true
  try {
    const n = aiPreview.value.length
    if (isMock.value) {
      for (let i = 0; i < n; i++) {
        const l = aiPreview.value[i]
        const p = positionFor(i, n)
        store.lociList.push({
          name: l.name,
          knowledgePoint: l.knowledgePoint,
          imageHint: l.imageHint,
          icon: 'map-pin',
          palaceId: store.activePalaceId ?? MOCK_PALACE_ID,
          userId: 0,
          id: -Date.now() - i,
          posX: p.x,
          posY: p.y,
          sortOrder: store.lociList.length + i + 1,
        })
      }
    } else {
      for (let i = 0; i < n; i++) {
        const l = aiPreview.value[i]
        const p = positionFor(i, n)
        await createLoci({
          palaceId: palaceId.value!,
          name: l.name,
          knowledgePoint: l.knowledgePoint,
          imageHint: l.imageHint,
          icon: 'map-pin',
          categoryId: undefined,
          posX: p.x,
          posY: p.y,
          sortOrder: store.lociList.length + i + 1,
        })
      }
    }
    notify(`已添加 ${n} 个位点`, 'success')
    showAiDrawer.value = false
    aiPreview.value = []
    if (!isMock.value) await store.fetchLoci(palaceId.value!)
  } catch (e) {
    notify(getApiError(e, '添加失败'), 'error')
  } finally {
    aiAdding.value = false
  }
}

// ===================== 漫游 / 复习 =====================
function startTour() {
  mode.value = 'tour'
}
function exitTour(idx: number) {
  mode.value = 'space'
  if (typeof idx === 'number') store.currentTourIndex = idx
}
function startReview() {
  mode.value = 'review'
}
function exitReview() {
  mode.value = 'space'
}
function onGrade(lociId: number, level: number) {
  store.gradeLoci(lociId, level)
}

// ===================== 分类树 =====================
const categories = ref<CategoryVO[]>([])
const flatCategories = ref<CategoryVO[]>([])
const categoryMap = ref<Map<number, string>>(new Map())

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

// ===================== 导航辅助 =====================
function goHome() {
  router.push('/workbench/palace')
}
function loadMock() {
  store.initMockData(MOCK_PALACE_ID)
}
function themeLabel(t?: string) {
  return (
    ({ ROOM: '房间', STREET: '街道', CAMPUS: '校园', CUSTOM: '自定义' } as Record<string, string>)[t || ''] ||
    t ||
    ''
  )
}

// ===================== 生命周期 =====================
onMounted(async () => {
  if (!palaceId.value) {
    await loadPalaces()
    return
  }
  if (isMock.value) {
    store.initMockData(MOCK_PALACE_ID)
    palace.value = {
      id: MOCK_PALACE_ID,
      userId: 0,
      name: '并发编程公寓（演示）',
      description: '并发编程核心概念的场景化记忆',
      theme: 'ROOM',
      coverColor: '#3B6FE0',
    }
    return
  }
  try {
    palace.value = await getPalace(palaceId.value)
    await store.fetchLoci(palaceId.value)
  } catch (e) {
    notify(getApiError(e, '加载失败'), 'error')
  }
  loadCategories()
})
</script>
