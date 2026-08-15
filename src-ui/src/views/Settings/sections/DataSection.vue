<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">数据管理</h2>
    </header>

    <!-- 数据目录 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="database" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">数据目录</h3>
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
          <button class="kb-btn kb-btn-sm kb-btn-danger" @click="info('重置数据将清空全部本地内容，请谨慎操作')">
            <Icon name="rotate-ccw" :size="14" /> 重置数据
          </button>
        </div>
        <p class="kb-setting-desc">修改后建议重启应用生效；迁移既有数据请手动拷贝。</p>
      </div>
    </section>

    <!-- 数据备份 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="archive" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">数据备份</h3>
          <p class="kb-set-card-desc">定期把数据库、上传文件与配置打包成 zip，换机或重装后可一键恢复。</p>
        </div>
      </div>

      <div class="kb-setting-row" style="flex-direction: column; align-items: stretch; gap: .6rem;">
        <div class="kb-dir-row">
          <input
            v-model="s.appStore.backup.dir"
            class="kb-input"
            placeholder="选择备份保存目录"
            spellcheck="false"
          />
          <button class="kb-btn" :disabled="s.pickingBackup.value" @click="s.pickBackupDir()">
            <Icon :name="s.pickingBackup.value ? 'loader' : 'folder-search'" :size="15" :class="s.pickingBackup.value ? 'lf-spin' : ''" />
            选择文件夹
          </button>
        </div>
        <div class="kb-row" style="gap:.5rem; flex-wrap: wrap;">
          <button class="kb-btn kb-btn-primary kb-btn-sm" :disabled="s.backupBusy.value" @click="s.onBackupNow()">
            <Icon :name="s.backupBusy.value ? 'loader' : 'download'" :size="14" :class="s.backupBusy.value ? 'lf-spin' : ''" />
            立即备份
          </button>
          <button class="kb-btn kb-btn-sm" @click="s.openBackupFolder()">
            <Icon name="folder-open" :size="14" /> 打开目录
          </button>
          <span v-if="s.backupMsg.value" class="kb-status-badge" :class="s.backupMsg.value.ok ? 'is-ok' : 'is-danger'">
            <span class="dot"></span>{{ s.backupMsg.value.text }}
          </span>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>每日自动备份</span>
          <span class="kb-setting-desc">定时把数据打包到上述目录</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': s.appStore.backup.auto }">
            <input type="checkbox" v-model="s.appStore.backup.auto" @change="s.onToggleAuto()" />
          </label>
        </div>
      </div>

      <div v-if="s.appStore.backup.auto" class="kb-setting-row">
        <div class="kb-setting-label"><span>每日触发时刻</span></div>
        <div class="kb-setting-control">
          <input type="time" v-model="s.appStore.backup.time" class="kb-input" style="max-width: 160px;" @change="s.onTimeChange()" />
        </div>
      </div>

      <div v-if="s.backupList.value.length" class="kb-backup-list">
        <p class="kb-setting-desc">最近备份（共 {{ s.backupList.value.length }} 个）</p>
        <ul>
          <li v-for="b in s.backupList.value" :key="b.name">
            <Icon name="file" :size="14" />
            <span class="lf-bname">{{ b.name }}</span>
            <span class="lf-bmeta">{{ s.formatSize(b.size) }} · {{ s.formatTime(b.modifiedAt) }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 导入导出 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="import" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">导入导出</h3>
          <p class="kb-set-card-desc">把全部学习数据导出为文件，或导入外部备份。</p>
        </div>
      </div>
      <div class="kb-row" style="gap:.5rem;">
        <button class="kb-btn kb-btn-sm" @click="info('导出功能即将在后续版本开放')">
          <Icon name="upload" :size="14" /> 导出为文件
        </button>
        <button class="kb-btn kb-btn-sm" @click="info('导入功能即将在后续版本开放')">
          <Icon name="download" :size="14" /> 导入外部数据
        </button>
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
.kb-backup-list { margin-top: .9rem; }
.kb-backup-list ul { list-style: none; margin: .4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; max-height: 12rem; overflow-y: auto; }
.kb-backup-list li { display: flex; align-items: center; gap: .5rem; padding: .35rem .55rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-muted); }
.kb-backup-list li > :first-child { color: var(--kb-muted-foreground); flex-shrink: 0; }
.lf-bname { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); font-family: var(--font-mono); word-break: break-all; }
.lf-bmeta { margin-left: auto; font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); white-space: nowrap; flex-shrink: 0; }
.lf-spin { animation: lf-rotate .9s linear infinite; }
@keyframes lf-rotate { to { transform: rotate(360deg); } }
</style>
