<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">数据同步</h2>
      <span class="kb-status-badge" :class="prefs.sync.enabled ? 'is-off' : 'is-danger'">
        <span class="dot"></span>{{ prefs.sync.enabled ? '未连接' : '未连接' }}
      </span>
    </header>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="cloud" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">WebDAV 配置</h3>
          <p class="kb-set-card-desc">对接坚果云等 WebDAV 服务，实现多端同步。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label"><span>服务器地址</span></div>
        <div class="kb-setting-control" style="flex: 1; max-width: 420px;">
          <input v-model="prefs.sync.webdav.url" class="kb-input" placeholder="https://dav.jianguoyun.com/dav/" spellcheck="false" />
        </div>
      </div>
      <div class="kb-setting-row">
        <div class="kb-setting-label"><span>用户名</span></div>
        <div class="kb-setting-control" style="flex: 1; max-width: 420px;">
          <input v-model="prefs.sync.webdav.username" class="kb-input" placeholder="WebDAV 用户名" spellcheck="false" />
        </div>
      </div>
      <div class="kb-setting-row">
        <div class="kb-setting-label"><span>密码</span></div>
        <div class="kb-setting-control" style="flex: 1; max-width: 420px;">
          <input v-model="prefs.sync.webdav.password" type="password" class="kb-input" placeholder="应用密码 / 令牌" autocomplete="off" />
        </div>
      </div>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" @click="testConnection">测试连接</button>
        <button class="kb-btn kb-btn-primary kb-btn-sm" @click="saveSync">保存</button>
        <span v-if="syncMsg" class="kb-status-badge" :class="syncMsg.ok ? 'is-ok' : 'is-danger'">
          <span class="dot"></span>{{ syncMsg.text }}
        </span>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="list-checks" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">同步范围</h3>
        </div>
      </div>
      <div class="kb-scope-grid">
        <label v-for="opt in SCOPE_OPTIONS" :key="opt.value" class="kb-scope-item">
          <input type="checkbox" :value="opt.value" v-model="prefs.sync.scope" />
          <span>{{ opt.label }}</span>
        </label>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="refresh-cw" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">同步状态</h3>
        </div>
      </div>
      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>自动同步</span>
          <span class="kb-setting-desc">连接后按变更增量同步</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.sync.autoSync }">
            <input type="checkbox" v-model="prefs.sync.autoSync" />
          </label>
        </div>
      </div>
      <div class="lf-actions">
        <button class="kb-btn kb-btn-primary kb-btn-sm" :disabled="!prefs.sync.enabled" @click="syncNow">立即同步</button>
        <span class="kb-status-badge is-off"><span class="dot"></span>上次同步：尚未同步</span>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="git-merge" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">冲突记录（2）</h3>
          <p class="kb-set-card-desc">多端同时修改产生的冲突，需手动选择保留方。</p>
        </div>
      </div>
      <div class="kb-conflict-list">
        <div v-for="c in CONFLICTS" :key="c.title" class="kb-conflict-item">
          <div class="kb-conflict-main">
            <span class="kb-status-badge is-warning"><span class="dot"></span>冲突</span>
            <span class="kb-conflict-title">{{ c.title }}</span>
            <span class="kb-setting-desc">{{ c.time }}</span>
          </div>
          <div class="kb-conflict-actions">
            <button class="kb-btn kb-btn-sm" @click="info('保留本地')">保留本地</button>
            <button class="kb-btn kb-btn-sm" @click="info('保留远程')">保留远程</button>
            <button class="kb-btn kb-btn-sm" @click="info('保留两者')">保留两者</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { usePrefsStore } from '@/store/prefs-store'
import { notify } from '@/utils/toast'

const prefs = usePrefsStore()
const syncMsg = ref<{ ok: boolean; text: string } | null>(null)

const SCOPE_OPTIONS = [
  { value: 'notes', label: '笔记' },
  { value: 'review', label: '复习卡' },
  { value: 'tasks', label: '任务' },
  { value: 'habits', label: '习惯' },
  { value: 'calendar', label: '日程' },
  { value: 'mindmap', label: '思维导图' },
  { value: 'attachments', label: '附件' },
]

const CONFLICTS = [
  { title: 'Java并发笔记', time: '2026-08-14 09:15' },
  { title: 'Redis闪卡#12', time: '2026-08-14 09:20' },
]

function info(msg: string) {
  notify(msg, 'info')
}
function testConnection() {
  syncMsg.value = { ok: true, text: '配置已保存（连接测试将在接入后端后启用）' }
}
function saveSync() {
  prefs.sync.enabled = !!prefs.sync.webdav.url
  syncMsg.value = { ok: true, text: '已保存 WebDAV 配置' }
}
function syncNow() {
  info('立即同步将在接入后端后启用')
}
</script>

<style scoped>
.kb-scope-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; }
.kb-scope-item { display: flex; align-items: center; gap: .45rem; padding: .45rem .6rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); cursor: pointer; }
.kb-scope-item input { accent-color: var(--kb-primary); }
.kb-conflict-list { display: flex; flex-direction: column; gap: .6rem; }
.kb-conflict-item { display: flex; flex-direction: column; gap: .5rem; padding: .6rem .75rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-muted); }
.kb-conflict-main { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.kb-conflict-title { font-size: var(--kb-fs-body-md); font-weight: 600; color: var(--kb-foreground); }
.kb-conflict-actions { display: flex; gap: .4rem; flex-wrap: wrap; }
.lf-actions { display: flex; align-items: center; gap: .625rem; margin-top: 1rem; flex-wrap: wrap; }
</style>
