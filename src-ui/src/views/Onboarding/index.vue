<template>
  <!-- 全屏首次引导：三步走（数据目录 → AI 配置 → 快速启动）。
       视觉沿用 --kb-* 令牌与 .kb-* 组件类，风格清爽、单卡片居中，类 Raycast / Notion。 -->
  <div class="ob-root">
    <div class="ob-card">
      <!-- 顶部品牌 + 步骤指示 -->
      <header class="ob-head">
        <div class="ob-brand">
          <span class="ob-brand-logo"><Icon name="brain" :size="'22px'" /></span>
          <span class="ob-brand-name">LectoForge 学习工作台</span>
        </div>
        <ol class="ob-steps">
          <li
            v-for="(s, i) in stepMeta"
            :key="s.key"
            class="ob-step"
            :class="{ 'is-active': step === i + 1, 'is-done': step > i + 1 }"
          >
            <span class="ob-step-dot">
              <Icon v-if="step > i + 1" name="check" :size="'13px'" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="ob-step-label">{{ s.label }}</span>
          </li>
        </ol>
      </header>

      <!-- ===== Step 1：数据目录 ===== -->
      <section v-if="step === 1" class="ob-body">
        <div class="ob-icon-badge"><Icon name="folder-open" :size="'26px'" /></div>
        <h1 class="ob-title">你的知识库存放在哪里？</h1>
        <p class="ob-desc">
          笔记、复习卡片、记忆宫殿等所有数据都会保存在这个目录。建议选一个你会长期保留、并已纳入云同步或备份的位置。
        </p>

        <label class="kb-label">数据目录</label>
        <div class="ob-dir-row">
          <input
            v-model="form.dataDir"
            class="kb-input ob-dir-input"
            placeholder="点击右侧按钮选择文件夹，或直接粘贴绝对路径"
            spellcheck="false"
          />
          <button class="kb-btn ob-dir-btn" :disabled="picking" @click="pickDirectory">
            <Icon :name="picking ? 'loader' : 'folder-search'" :size="'15px'" :class="picking ? 'ob-spin' : ''" />
            选择文件夹
          </button>
        </div>
        <p class="ob-hint">
          <Icon name="info" :size="'13px'" />
          留空则使用系统默认目录：<code>~/Library/Application Support/com.lectoforge.desktop</code>
        </p>
      </section>

      <!-- ===== Step 2：AI 配置 ===== -->
      <section v-else-if="step === 2" class="ob-body">
        <div class="ob-icon-badge ob-icon-badge--ai"><Icon name="sparkles" :size="'26px'" /></div>
        <h1 class="ob-title">配置你的 AI 网关</h1>
        <p class="ob-desc">
          用于智能提取要点、语义联想与费曼评分等增强能力。支持任何 OpenAI 兼容接口；API Key 只保存在本机（权限 600），不会上传、不进版本库。
        </p>

        <div class="ob-form-grid">
          <div class="ob-span-2">
            <label class="kb-label">API 网关地址</label>
            <input v-model="form.apiUrl" class="kb-input" placeholder="https://api.deepseek.com" spellcheck="false" />
          </div>
          <div class="ob-span-2">
            <label class="kb-label">API Key</label>
            <input
              v-model="form.apiKey"
              class="kb-input"
              type="password"
              autocomplete="off"
              :placeholder="aiConfigured ? '已保存（留空表示不修改）' : 'sk-...'"
            />
          </div>
          <div class="ob-span-2">
            <label class="kb-label">模型名称</label>
            <input v-model="form.model" class="kb-input" placeholder="deepseek-chat" spellcheck="false" />
          </div>
        </div>

        <div class="ob-test-row">
          <button class="kb-btn kb-btn-sm" :disabled="testing" @click="onTest">
            <Icon :name="testing ? 'loader' : 'plug-zap'" :size="'sm'" :class="testing ? 'ob-spin' : ''" />
            测试连通性
          </button>
          <span v-if="testResult" class="ob-test-result" :class="testResult.ok ? 'is-ok' : 'is-fail'">
            <Icon :name="testResult.ok ? 'check-circle-2' : 'x-circle'" :size="'sm'" />
            {{ testResult.text }}
          </span>
        </div>
        <p class="ob-hint">
          <Icon name="info" :size="'13px'" />
          这一步可跳过，之后随时能在「设置」里补配；不配置也不影响任何基础功能。
        </p>
      </section>

      <!-- ===== Step 3：快速启动 ===== -->
      <section v-else class="ob-body">
        <div class="ob-icon-badge ob-icon-badge--done"><Icon name="party-popper" :size="'26px'" /></div>
        <h1 class="ob-title">恭喜，配置完成！</h1>
        <p class="ob-desc">三个常用入口先记一下，进去就能上手：</p>

        <div class="ob-feature-list">
          <article v-for="f in features" :key="f.title" class="ob-feature">
            <span class="ob-feature-icon" :style="{ background: f.tint, color: f.color }">
              <Icon :name="f.icon" :size="'lg'" />
            </span>
            <div class="ob-feature-body">
              <p class="ob-feature-title">{{ f.title }}</p>
              <p class="ob-feature-desc">{{ f.desc }}</p>
            </div>
          </article>
        </div>
      </section>

      <!-- 底部操作区 -->
      <footer class="ob-foot">
        <button v-if="step > 1" class="kb-btn ob-back" @click="prev">
          <Icon name="chevron-left" :size="'15px'" /> 上一步
        </button>
        <div v-else class="ob-foot-spacer"></div>

        <div class="ob-foot-right">
          <button v-if="step < 3" class="kb-btn ob-skip" @click="next">
            {{ step === 2 ? '暂不配置' : '跳过' }}
          </button>
          <button v-if="step < 3" class="kb-btn kb-btn-primary" @click="next">
            下一步 <Icon name="chevron-right" :size="'15px'" />
          </button>
          <button v-else class="kb-btn kb-btn-primary ob-launch" :disabled="finishing" @click="finish">
            <Icon :name="finishing ? 'loader' : 'rocket'" :size="'17px'" :class="finishing ? 'ob-spin' : ''" />
            进入学习工作台
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
// 新手引导：三步向导。数据目录经 Tauri select_directory 选择；AI 参数与目录在最后一步
// 一并提交后端（completeOnboarding），成功后跳转工作台并由路由守卫放行。
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useDebounceFn } from '@vueuse/core'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError } from '@/utils/toast'
import { useAppStore } from '@/store/app-store'
import { testAiConnection } from '@/api/ai'
import { getAppConfig } from '@/api/config';
// 顶层静态导入：与 App.vue / pomodoroStore 一致，避免 build 模式动态 import chunk 静默失败
import { invoke } from '@tauri-apps/api/core';

const router = useRouter()
const appStore = useAppStore()
const { settings } = storeToRefs(appStore)

const step = ref(1)
const picking = ref(false)
const testing = ref(false)
const finishing = ref(false)
const aiConfigured = ref(false)
const testResult = ref<{ ok: boolean; text: string } | null>(null)

const stepMeta = [
  { key: 'dir', label: '数据目录' },
  { key: 'ai', label: 'AI 配置' },
  { key: 'go', label: '快速启动' },
]

// 表单本地态，进入时用 store 里的值（含后端已保存的目录 / 模型）回填
const form = reactive({
  dataDir: '',
  apiUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
})

const features = [
  {
    icon: 'inbox',
    title: '收集箱抓灵感',
    desc: '碎片想法、网页摘录随手丢进收集箱，AI 一键提炼要点与标签。',
    color: 'var(--kb-primary)',
    tint: 'color-mix(in srgb, var(--kb-primary) 12%, transparent)',
  },
  {
    icon: 'notebook-pen',
    title: '康奈尔笔记整理',
    desc: '线索 / 笔记 / 总结三栏结构，把收集箱的灵感沉淀成可复习的知识。',
    color: 'var(--kb-highlight)',
    tint: 'color-mix(in srgb, var(--kb-highlight) 14%, transparent)',
  },
  {
    icon: 'map-pin',
    title: '记忆宫殿漫游',
    desc: '把知识点挂到熟悉的空间位点上，用夸张联想图像牢牢记住。',
    color: 'var(--kb-warning)',
    tint: 'color-mix(in srgb, var(--kb-warning) 16%, transparent)',
  },
]

onMounted(async () => {
  // 与后端对齐一次，拿到默认数据目录与是否已配置 AI，回填表单
  await appStore.initFromBackend()
  form.dataDir = settings.value.dataDir
  form.apiUrl = settings.value.ai.apiUrl || form.apiUrl
  form.model = settings.value.ai.model || form.model
  // AI 是否已配置决定 Step2 是否提示「已保存（留空表示不修改）」
  try {
    const cfg = await getAppConfig()
    aiConfigured.value = !!cfg.ai?.configured
  } catch {
    aiConfigured.value = false
  }
})

/** 调用 Rust select_directory 打开系统「选择文件夹」弹窗 */
async function pickDirectory() {
  if (picking.value) return
  picking.value = true
  try {
    const dir = await invoke<string>('select_directory')
    if (dir) form.dataDir = dir
  } catch (e) {
    // 用户取消（Err）或浏览器预览态（无 Tauri）——都不视为错误
    const msg = String((e as Error)?.message || e)
    if (!msg.includes('取消')) {
      notify('当前为浏览器预览模式，选择文件夹仅在桌面应用内可用；可直接粘贴路径', 'info')
    }
  } finally {
    picking.value = false
  }
}

/** AI 连通性测试（防抖，避免连点刷接口） */
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
    })
    testResult.value = { ok: true, text: `连通正常 · ${r.model} · ${r.latencyMs}ms` }
  } catch (e) {
    testResult.value = { ok: false, text: getApiError(e, '连接失败') }
  } finally {
    testing.value = false
  }
}, 300)

function next() {
  // 每步把本地表单写回 store，保证最后一步提交时数据完整
  syncFormToStore()
  if (step.value < 3) step.value += 1
}

function prev() {
  if (step.value > 1) step.value -= 1
}

function syncFormToStore() {
  appStore.updateSettings({
    dataDir: form.dataDir.trim(),
    ai: { apiUrl: form.apiUrl.trim(), apiKey: form.apiKey, model: form.model.trim() },
  })
}

/** 完成：落盘 + 跳转工作台 */
async function finish() {
  if (finishing.value) return
  finishing.value = true
  try {
    syncFormToStore()
    await appStore.completeOnboarding()
    notify('欢迎使用 LectoForge，开始你的学习闭环吧！', 'success')
    router.push('/workbench')
  } catch (e) {
    notify(getApiError(e, '配置保存失败，请重试'), 'error')
  } finally {
    finishing.value = false
  }
}
</script>

<style scoped>
.ob-root {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  background:
    radial-gradient(1200px 600px at 50% -10%, color-mix(in srgb, var(--kb-primary) 10%, transparent), transparent 60%),
    var(--kb-background);
}

.ob-card {
  width: 100%;
  max-width: 560px;
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 28px 32px 24px;
  animation: ob-in 0.28s ease;
}

@keyframes ob-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 顶部品牌 + 步骤 */
.ob-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--kb-border);
  flex-wrap: wrap;
}
.ob-brand { display: flex; align-items: center; gap: 8px; }
.ob-brand-logo {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
  color: var(--kb-primary);
}
.ob-brand-name { font-weight: 700; font-size: var(--kb-fs-body-md); color: var(--kb-foreground); }

.ob-steps { display: flex; align-items: center; gap: 8px; list-style: none; margin: 0; padding: 0; }
.ob-step { display: flex; align-items: center; gap: 8px; }
.ob-step-dot {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 999px;
  font-size: 12px; font-weight: 700;
  background: var(--kb-muted); color: var(--kb-muted-foreground);
  transition: all 0.18s ease;
}
.ob-step-label { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); }
.ob-step.is-active .ob-step-dot { background: var(--kb-primary); color: var(--kb-primary-foreground); }
.ob-step.is-active .ob-step-label { color: var(--kb-foreground); font-weight: 600; }
.ob-step.is-done .ob-step-dot { background: color-mix(in srgb, var(--kb-primary) 20%, transparent); color: var(--kb-primary); }
.ob-step:not(:last-child)::after {
  content: ''; width: 14px; height: 1px; background: var(--kb-border); margin-left: 2px;
}

/* 主体 */
.ob-body { padding: 24px 0 8px; min-height: 264px; animation: ob-in 0.22s ease; }
.ob-icon-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 52px; height: 52px; border-radius: 14px; margin-bottom: 16px;
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
  color: var(--kb-primary);
}
.ob-icon-badge--ai { background: color-mix(in srgb, var(--kb-highlight) 14%, transparent); color: var(--kb-highlight); }
.ob-icon-badge--done { background: color-mix(in srgb, var(--kb-warning) 16%, transparent); color: var(--kb-warning); }

.ob-title {
  font-size: var(--kb-fs-h2); font-weight: var(--kb-fw-h2); line-height: var(--kb-lh-h2);
  color: var(--kb-foreground); margin: 0 0 8px;
}
.ob-desc {
  font-size: var(--kb-fs-body-sm); line-height: 1.6; color: var(--kb-muted-foreground); margin: 0 0 20px;
}

.ob-dir-row { display: flex; gap: 8px; align-items: stretch; }
.ob-dir-input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--kb-fs-body-sm); }
.ob-dir-btn { flex-shrink: 0; white-space: nowrap; }

.ob-hint {
  display: flex; align-items: center; gap: 8px;
  margin-top: 12px; font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground);
}
.ob-hint code {
  font-family: var(--font-mono); font-size: var(--kb-fs-caption);
  background: var(--kb-muted); padding: 1px 8px; border-radius: 5px;
}

.ob-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.ob-span-2 { grid-column: span 2; }

.ob-test-row { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
.ob-test-result { display: inline-flex; align-items: center; gap: 4px; font-size: var(--kb-fs-caption); }
.ob-test-result.is-ok { color: var(--kb-primary); }
.ob-test-result.is-fail { color: var(--kb-destructive); }

/* 功能卡片 */
.ob-feature-list { display: flex; flex-direction: column; gap: 12px; }
.ob-feature {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md);
  background: var(--kb-background); transition: border-color 0.16s ease, transform 0.16s ease;
}
.ob-feature:hover { border-color: color-mix(in srgb, var(--kb-primary) 40%, var(--kb-border)); transform: translateY(-1px); }
.ob-feature-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
}
.ob-feature-title { font-size: var(--kb-fs-body-sm); font-weight: 600; color: var(--kb-foreground); margin: 0 0 3px; }
.ob-feature-desc { font-size: var(--kb-fs-caption); line-height: 1.55; color: var(--kb-muted-foreground); margin: 0; }

/* 底部 */
.ob-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding-top: 20px; margin-top: 4px; border-top: 1px solid var(--kb-border);
}
.ob-foot-spacer { flex: 1; }
.ob-foot-right { display: flex; align-items: center; gap: 8px; }
.ob-launch { padding-left: 20px; padding-right: 20px; font-weight: 600; }

.ob-spin { animation: ob-rotate 0.9s linear infinite; }
@keyframes ob-rotate { to { transform: rotate(360deg); } }

@media (max-width: 520px) {
  .ob-card { padding: 24px 16px 16px; }
  .ob-step-label { display: none; }
  .ob-form-grid { grid-template-columns: 1fr; }
  .ob-span-2 { grid-column: span 1; }
}
</style>
