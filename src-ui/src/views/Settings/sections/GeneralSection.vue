<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">通用设置</h2>
    </header>

    <!-- 知识库数据目录 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="folder-open" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">知识库数据目录</h3>
          <p class="kb-set-card-desc">笔记、复习卡片、记忆宫殿等数据的存放位置。</p>
        </div>
      </div>

      <div class="kb-setting-row" style="flex-direction: column; align-items: stretch; gap: .6rem;">
        <div class="kb-dir-row">
          <input
            v-model="s.form.dataDir"
            class="kb-input"
            placeholder="~/Library/Application Support/com.lectoforge.desktop"
            spellcheck="false"
          />
          <button class="kb-btn" :disabled="s.picking.value" @click="s.pickDirectory()">
            <Icon :name="s.picking.value ? 'loader' : 'folder-search'" :size="15" :class="s.picking.value ? 'lf-spin' : ''" />
            选择文件夹
          </button>
        </div>
        <div class="kb-row" style="gap:.5rem;">
          <button class="kb-btn kb-btn-sm" @click="openDataDir">
            <Icon name="folder-open" :size="14" /> 打开目录
          </button>
          <button class="kb-btn kb-btn-sm" @click="info('清除缓存功能即将在后续版本开放')">
            <Icon name="trash-2" :size="14" /> 清除缓存
          </button>
        </div>
        <p class="kb-setting-desc">修改后建议重启应用生效；迁移既有数据请手动拷贝。</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import Icon from '@/components/ui/Icon.vue'
import { useSettings } from '../useSettings'
import { notify } from '@/utils/toast'

const s = useSettings()

function info(msg: string) {
  notify(msg, 'info')
}

async function openDataDir() {
  if (!s.form.dataDir) {
    notify('请先设置数据目录', 'info')
    return
  }
  try {
    await invoke('open_backup_folder', { path: s.form.dataDir })
  } catch (e) {
    notify('当前为浏览器预览模式，打开目录仅桌面端可用', 'info')
  }
}
</script>

<style scoped>
.kb-dir-row { display: flex; gap: .5rem; align-items: center; }
.kb-dir-row .kb-input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; }
.lf-spin { animation: lf-rotate .9s linear infinite; }
@keyframes lf-rotate { to { transform: rotate(360deg); } }
</style>
