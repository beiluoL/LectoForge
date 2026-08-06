<template>
  <div class="dl-modal-mask" role="presentation" @click.self="emit('close')">
    <div class="dl-modal" role="dialog" aria-modal="true" aria-label="选择文档库文件夹">
      <div class="dl-modal-head">
        <Icon name="folder-open" size="md" style="color: var(--kb-primary);" />
        <span class="dl-modal-title">选择文档库文件夹</span>
        <span class="flex-1"></span>
        <button type="button" class="dl-icon-btn" title="关闭" @click="emit('close')">
          <Icon name="x" size="sm" />
        </button>
      </div>

      <div class="dl-modal-body">
        <!-- 快捷位置 -->
        <div v-if="shortcuts.length" class="dl-shortcuts">
          <button
            v-for="s in shortcuts"
            :key="s.path"
            type="button"
            class="dl-chip"
            :title="s.path"
            @click="go(s.path)"
          >
            <Icon name="hard-drive" size="xs" />
            {{ s.name }}
          </button>
        </div>

        <!-- 当前路径 + 手动输入 -->
        <div class="dl-path-bar">
          <button
            type="button"
            class="dl-icon-btn"
            title="返回上一级"
            :disabled="!parent || loading"
            @click="go(parent as string)"
          >
            <Icon name="arrow-up" size="sm" />
          </button>
          <input
            v-model="pathInput"
            type="text"
            class="kb-input dl-path-input"
            spellcheck="false"
            aria-label="文件夹绝对路径"
            placeholder="/Users/you/Documents/MyVault"
            @keydown.enter.prevent="go(pathInput)"
          />
          <button type="button" class="kb-btn kb-btn-sm" :disabled="loading" @click="go(pathInput)">前往</button>
        </div>

        <!-- 子目录列表 -->
        <div class="dl-dir-list dl-scroll">
          <div v-if="loading" class="pt-1">
            <div v-for="i in 5" :key="i" class="dl-skel" :style="{ width: `${45 + ((i * 17) % 40)}%` }"></div>
          </div>
          <template v-else-if="dirs.length">
            <button v-for="d in dirs" :key="d.path" type="button" class="dl-dir-row" :title="d.path" @click="go(d.path)">
              <Icon name="folder" size="sm" style="color: var(--kb-warning);" />
              <span class="dl-dir-name">{{ d.name }}</span>
              <span class="flex-1"></span>
              <Icon name="chevron-right" size="xs" style="color: var(--kb-muted-foreground);" />
            </button>
          </template>
          <p v-else class="dl-empty-sm">该文件夹下没有子文件夹</p>
        </div>

        <p class="dl-hint">
          <Icon name="info" size="xs" />
          选定的文件夹会作为文档库根目录，其中的 <code>.md</code> 文件将被读取和编辑；文件始终留在本机磁盘。
        </p>
      </div>

      <div class="dl-modal-foot">
        <button type="button" class="kb-btn kb-btn-sm" :disabled="loading" @click="createHere">
          <Icon name="folder-plus" size="xs" />
          在此新建文件夹
        </button>
        <span class="flex-1"></span>
        <button type="button" class="kb-btn kb-btn-sm" @click="emit('close')">取消</button>
        <button type="button" class="kb-btn kb-btn-sm kb-btn-primary" :disabled="loading || !current" @click="confirm">
          <Icon name="check" size="xs" />
          使用此文件夹
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 目录选择器：浏览本机文件夹，选定文档库根目录。
//
// 为什么不用 Tauri 的原生文件对话框：本页在浏览器（vite dev / 浏览器直接访问后端）
// 下同样要能用，因此走后端 /library/fs/browse 自绘一个跨环境一致的选择器。
// 后端只回目录名与路径、不越权读文件内容，且过滤了隐藏目录。
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { browseDirs, type LibDirEntry } from '@/api/library'
import Icon from '@/components/ui/Icon.vue'
import { getApiError, notify, promptDialog } from '@/utils/toast'

const props = defineProps<{
  /** 打开时定位到的目录，通常是当前工作区或后端给的默认库路径 */
  initialDir?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** create=true 表示目录尚不存在、需要后端顺手创建 */
  (e: 'confirm', payload: { path: string; create: boolean }): void
}>()

const loading = ref(false)
const current = ref('')
const parent = ref<string | null>(null)
const dirs = ref<LibDirEntry[]>([])
const shortcuts = ref<LibDirEntry[]>([])
const pathInput = ref('')

async function go(dir?: string) {
  const target = (dir ?? '').trim()
  loading.value = true
  try {
    const res = await browseDirs(target || undefined)
    current.value = res.current
    parent.value = res.parent
    dirs.value = res.dirs
    // 快捷位置只在首次拿到时固定下来，避免每次进目录都重排
    if (!shortcuts.value.length) shortcuts.value = res.shortcuts
    pathInput.value = res.current
  } catch (e) {
    notify(getApiError(e, '无法读取该文件夹'), 'error')
    // 输入了错路径时把输入框回滚到仍然有效的当前目录，避免用户对着报错发懵
    pathInput.value = current.value
  } finally {
    loading.value = false
  }
}

/** 在当前目录下新建一个子文件夹并直接用作文档库 */
async function createHere() {
  const name = await promptDialog(`在「${current.value}」中新建文件夹`, {
    placeholder: '文件夹名称',
    defaultValue: 'KnowFlow 文档库',
  })
  if (name === null) return
  const trimmed = name.trim()
  if (!trimmed) return
  emit('confirm', { path: `${current.value.replace(/\/+$/, '')}/${trimmed}`, create: true })
}

function confirm() {
  const typed = pathInput.value.trim()
  // 用户可能手输了一个还没进去过的路径，此时允许后端按需创建
  const isBrowsed = typed === current.value
  emit('confirm', { path: typed || current.value, create: !isBrowsed })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void go(props.initialDir)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.dl-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--kb-fs-xs);
  line-height: 1.6;
  color: var(--kb-muted-foreground);
}
.dl-hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--kb-muted);
  font-family: var(--font-mono);
}
</style>
