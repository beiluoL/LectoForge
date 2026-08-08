<template>
  <!-- 全局设置中心：数据目录 + AI 服务 + 关于。视觉沿用工作台令牌与 .kb-* 组件类。 -->
  <div class="space-y-4 animate-fade-in">
    <!-- 页头 -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="kb-h1 mb-1 flex items-center gap-2" style="color: var(--kb-foreground);">
          <Icon name="settings" :size="24" style="color: var(--kb-primary);" /> 设置
        </h1>
        <p class="kb-body" style="color: var(--kb-muted-foreground);">
          管理数据目录与 AI 服务。所有配置只保存在本机，随时可改。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button class="kb-btn" @click="router.back()">
          <Icon name="chevron-left" :size="16" /> 返回
        </button>
      </div>
    </div>

    <div class="set-wrap">
      <!-- ===== 数据目录 ===== -->
      <section class="set-card">
        <h2 class="set-card-title">
          <Icon name="folder-open" :size="18" style="color: var(--kb-primary);" /> 知识库数据目录
        </h2>
        <p class="set-card-desc">
          笔记、复习卡片、记忆宫殿等数据的存放位置。修改后建议重启应用生效；迁移既有数据请手动拷贝。
        </p>
        <div class="set-dir-row">
          <input
            v-model="form.dataDir"
            class="kb-input set-dir-input"
            placeholder="~/Library/Application Support/com.lectoforge.desktop"
            spellcheck="false"
          />
          <button class="kb-btn" :disabled="picking" @click="pickDirectory">
            <Icon :name="picking ? 'loader' : 'folder-search'" :size="15" :class="picking ? 'set-spin' : ''" />
            选择文件夹
          </button>
        </div>
      </section>

      <!-- ===== AI 服务 ===== -->
      <section class="set-card">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="set-card-title">
            <Icon name="sparkles" :size="18" style="color: var(--kb-highlight);" /> AI 服务
          </h2>
          <span class="set-status" :class="aiConfigured ? 'is-on' : 'is-off'">
            <i class="set-status-dot"></i>{{ aiConfigured ? '已配置' : '未配置' }}
          </span>
        </div>
        <p class="set-card-desc">
          任何 OpenAI 兼容接口皆可。API Key 只保存在本机数据目录（权限 600），不会上传、不进版本库。
        </p>

        <div class="set-form-grid">
          <div class="set-span-2">
            <label class="kb-label">API 网关地址</label>
            <input v-model="form.apiUrl" class="kb-input" placeholder="https://api.deepseek.com" spellcheck="false" />
          </div>
          <div class="set-span-2">
            <label class="kb-label">API Key</label>
            <input
              v-model="form.apiKey"
              class="kb-input"
              type="password"
              autocomplete="off"
              :placeholder="aiConfigured ? `已保存 ${apiKeyMask}（留空表示不修改）` : 'sk-...'"
            />
          </div>
          <div class="set-span-2">
            <label class="kb-label">模型名称</label>
            <input v-model="form.model" class="kb-input" placeholder="deepseek-chat" spellcheck="false" />
          </div>
        </div>

        <div class="set-test-row">
          <button class="kb-btn kb-btn-sm" :disabled="testing" @click="onTest">
            <Icon :name="testing ? 'loader' : 'plug-zap'" :size="14" :class="testing ? 'set-spin' : ''" />
            测试连通性
          </button>
          <router-link to="/settings/ai" class="kb-btn kb-btn-sm">
            <Icon name="sliders-horizontal" :size="14" /> 高级 AI 设置
          </router-link>
          <span v-if="testResult" class="set-test-result" :class="testResult.ok ? 'is-ok' : 'is-fail'">
            <Icon :name="testResult.ok ? 'check-circle-2' : 'x-circle'" :size="14" />
            {{ testResult.text }}
          </span>
        </div>
      </section>

      <!-- ===== 关于 ===== -->
      <section class="set-card">
        <h2 class="set-card-title">
          <Icon name="info" :size="18" style="color: var(--kb-muted-foreground);" /> 关于
        </h2>
        <dl class="set-about">
          <div><dt>应用</dt><dd>LectoForge 学习工作台</dd></div>
          <div><dt>版本</dt><dd>v1.0.0</dd></div>
          <div><dt>运行模式</dt><dd><span class="set-badge"><Icon name="hard-drive" :size="12" /> 本地离线</span></dd></div>
        </dl>
        <div class="set-about-actions">
          <button class="kb-btn kb-btn-sm" @click="rerunOnboarding">
            <Icon name="rotate-ccw" :size="14" /> 重新运行新手引导
          </button>
        </div>
      </section>

      <!-- 底部保存条 -->
      <div class="set-save-bar">
        <button class="kb-btn kb-btn-primary" :disabled="saving" @click="save">
          <Icon :name="saving ? 'loader' : 'save'" :size="16" :class="saving ? 'set-spin' : ''" />
          保存设置
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 全局设置中心：复用 appStore 的 settings 与 saveSettings（保存时保持 hasOnboarded 不变）。
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
// 顶层静态导入：build 模式下动态 import('@tauri-apps/api/core') 的 chunk 可能加载失败，
// 错误会被 catch 静默吞掉，表现为"dev 能选目录、打包后点了没反应"
import { invoke } from '@tauri-apps/api/core'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError } from '@/utils/toast'
import { useAppStore } from '@/store/app-store'
import { testAiConnection } from '@/api/ai'
import { getAppConfig } from '@/api/config'

const router = useRouter()
const appStore = useAppStore()

const picking = ref(false)
const testing = ref(false)
const saving = ref(false)
const aiConfigured = ref(false)
const apiKeyMask = ref('')
const testResult = ref<{ ok: boolean; text: string } | null>(null)

const form = reactive({
  dataDir: '',
  apiUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
})

onMounted(async () => {
  await appStore.initFromBackend()
  // 直接读一次后端拿到掩码与 configured（store 不缓存明文/掩码）
  try {
    const cfg = await getAppConfig()
    form.dataDir = cfg.dataDir || appStore.settings.dataDir
    form.apiUrl = cfg.ai?.baseUrl || appStore.settings.ai.apiUrl
    form.model = cfg.ai?.model || appStore.settings.ai.model
    aiConfigured.value = !!cfg.ai?.configured
    apiKeyMask.value = cfg.ai?.apiKeyMask || ''
  } catch {
    form.dataDir = appStore.settings.dataDir
    form.apiUrl = appStore.settings.ai.apiUrl
    form.model = appStore.settings.ai.model
  }
})

async function pickDirectory() {
  if (picking.value) return
  picking.value = true
  try {
    const dir = await invoke<string>('select_directory')
    if (dir) form.dataDir = dir
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (!msg.includes('取消')) {
      notify('当前为浏览器预览模式，选择文件夹仅在桌面应用内可用；可直接粘贴路径', 'info')
    }
  } finally {
    picking.value = false
  }
}

const onTest = useDebounceFn(async () => {
  if (testing.value) return
  if (!form.apiUrl.trim() || (!form.apiKey.trim() && !aiConfigured.value)) {
    notify('请先填写 API 地址与 Key 再测试', 'info')
    return
  }
  testing.value = true
  testResult.value = null
  try {
    const r = await testAiConnection({
      baseUrl: form.apiUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      model: form.model.trim(),
      provider: form.apiUrl.includes('deepseek') ? 'deepseek' : form.apiUrl.includes('openai') ? 'openai' : 'custom',
    } as any)
    testResult.value = { ok: true, text: `连通正常 · ${r.model} · ${r.latencyMs}ms` }
  } catch (e) {
    testResult.value = { ok: false, text: getApiError(e, '连接失败') }
  } finally {
    testing.value = false
  }
}, 300)

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    appStore.updateSettings({
      dataDir: form.dataDir.trim(),
      ai: { apiUrl: form.apiUrl.trim(), apiKey: form.apiKey, model: form.model.trim() },
    })
    await appStore.saveSettings()
    form.apiKey = ''
    aiConfigured.value = true
    notify('设置已保存', 'success')
  } catch (e) {
    notify(getApiError(e, '保存失败，请重试'), 'error')
  } finally {
    saving.value = false
  }
}

/** 重新运行引导：跳回 /onboarding（守卫会在 hasOnboarded=true 时拦截，故用 query 放行） */
function rerunOnboarding() {
  router.push({ path: '/onboarding', query: { rerun: '1' } })
}
</script>

<style scoped>
.set-wrap { max-width: 720px; display: flex; flex-direction: column; gap: 16px; }

.set-card {
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-lg);
  padding: 20px 22px;
}
.set-card-title {
  display: flex; align-items: center; gap: 8px;
  font-size: var(--kb-fs-h4); font-weight: var(--kb-fw-h4); color: var(--kb-foreground); margin: 0;
}
.set-card-desc { font-size: var(--kb-fs-body-sm); line-height: 1.6; color: var(--kb-muted-foreground); margin: 8px 0 16px; }

.set-dir-row { display: flex; gap: 8px; }
.set-dir-input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; }

.set-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.set-span-2 { grid-column: span 2; }

.set-test-row { display: flex; align-items: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.set-test-result { display: inline-flex; align-items: center; gap: 5px; font-size: var(--kb-fs-caption); }
.set-test-result.is-ok { color: var(--kb-primary); }
.set-test-result.is-fail { color: var(--kb-destructive); }

.set-status { display: inline-flex; align-items: center; gap: 6px; font-size: var(--kb-fs-caption); }
.set-status-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--kb-muted-foreground); }
.set-status.is-on { color: var(--kb-primary); }
.set-status.is-on .set-status-dot { background: var(--kb-primary); }
.set-status.is-off { color: var(--kb-muted-foreground); }

.set-about { display: flex; flex-direction: column; gap: 10px; margin: 4px 0 0; }
.set-about > div { display: flex; align-items: center; gap: 16px; }
.set-about dt { width: 88px; flex-shrink: 0; font-size: var(--kb-fs-body-sm); color: var(--kb-muted-foreground); margin: 0; }
.set-about dd { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); margin: 0; }
.set-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 9px; border-radius: 999px;
  background: var(--kb-muted); color: var(--kb-muted-foreground); font-size: 11.5px;
}
.set-about-actions { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--kb-border); }

.set-save-bar {
  position: sticky; bottom: 0;
  display: flex; justify-content: flex-end;
  padding: 12px 0 4px;
}

.set-spin { animation: set-rotate 0.9s linear infinite; }
@keyframes set-rotate { to { transform: rotate(360deg); } }

@media (max-width: 560px) {
  .set-form-grid { grid-template-columns: 1fr; }
  .set-span-2 { grid-column: span 1; }
}
</style>
