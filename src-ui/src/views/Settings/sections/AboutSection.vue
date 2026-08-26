<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">关于</h2>
    </header>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="info" :size="18" class="kb-set-card-icon" style="color: var(--kb-muted-foreground);" />
        <div>
          <h3 class="kb-set-card-title">应用信息</h3>
        </div>
      </div>
      <dl class="lf-about">
        <div><dt>应用</dt><dd>LectoForge 学习工作台</dd></div>
        <div><dt>版本</dt><dd>v1.0.0</dd></div>
        <div><dt>运行模式</dt><dd><span class="lf-badge"><Icon name="hard-drive" :size="12" /> 本地离线</span></dd></div>
      </dl>
      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" @click="info('当前已是最新版本')">
          <Icon name="refresh-cw" :size="14" /> 检查更新
        </button>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="brain-circuit" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">已接入的 AI 能力</h3>
          <p class="kb-set-card-desc">每项能力都是「按需触发 + 结果可编辑」：AI 只把结果填进输入框，是否采纳由你决定。</p>
        </div>
      </div>
      <div class="lf-cap-grid">
        <article v-for="c in s.capabilities" :key="c.name" class="lf-cap">
          <span class="lf-cap-icon"><Icon :name="c.icon" :size="16" /></span>
          <div class="lf-cap-body">
            <p class="lf-cap-name">{{ c.name }}</p>
            <p class="lf-cap-desc">{{ c.desc }}</p>
          </div>
          <router-link :to="c.to" class="kb-btn kb-btn-sm lf-cap-go">
            前往 <Icon name="chevron-right" :size="12" />
          </router-link>
        </article>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="ellipsis" :size="18" class="kb-set-card-icon" style="color: var(--kb-muted-foreground);" />
        <div>
          <h3 class="kb-set-card-title">其它</h3>
        </div>
      </div>
      <div class="kb-row" style="gap:.5rem; flex-wrap: wrap;">
        <button class="kb-btn kb-btn-sm" @click="rerunOnboarding">
          <Icon name="rotate-ccw" :size="14" /> 重新运行新手引导
        </button>
        <button class="kb-btn kb-btn-sm" @click="info('开源许可信息即将在文档中心开放')">
          <Icon name="scale" :size="14" /> 开源许可
        </button>
        <button class="kb-btn kb-btn-sm" @click="info('版本说明即将在文档中心开放')">
          <Icon name="file-text" :size="14" /> 版本说明
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { useSettings } from '../useSettings'
import { notify } from '@/utils/toast'

const s = useSettings()
const router = useRouter()

function info(msg: string) {
  notify(msg, 'info')
}
function rerunOnboarding() {
  router.push({ path: '/onboarding', query: { rerun: '1' } })
}
</script>

<style scoped>
.lf-about { display: flex; flex-direction: column; gap: .5rem; margin: 0; }
.lf-about > div { display: flex; align-items: center; gap: 1rem; }
.lf-about dt { width: 84px; flex-shrink: 0; font-size: var(--kb-fs-body-sm); color: var(--kb-muted-foreground); margin: 0; }
.lf-about dd { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); margin: 0; }
.lf-badge { display: inline-flex; align-items: center; gap: .35rem; padding: .15rem .55rem; border-radius: 999px; background: var(--kb-muted); color: var(--kb-muted-foreground); font-size: var(--kb-fs-caption); }
.lf-actions { display: flex; align-items: center; gap: .625rem; margin-top: 1rem; }
.lf-cap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .625rem; margin-top: .5rem; }
.lf-cap { display: flex; align-items: center; gap: .75rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); padding: .625rem .75rem; background: var(--kb-card); }
.lf-cap-icon { flex-shrink: 0; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--kb-primary-soft); color: var(--kb-primary); }
.lf-cap-body { flex: 1; min-width: 0; }
.lf-cap-name { font-size: var(--kb-fs-body-sm); font-weight: 600; color: var(--kb-foreground); margin: 0; }
.lf-cap-desc { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin: .125rem 0 0; line-height: 1.4; }
.lf-cap-go { flex-shrink: 0; }
@media (max-width: 640px) { .lf-cap-grid { grid-template-columns: 1fr; } }
</style>
