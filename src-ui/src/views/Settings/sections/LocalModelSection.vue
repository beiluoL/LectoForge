<template>
  <div id="local-model">
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">本地模型</h2>
      <span class="kb-status-badge" :class="s.form.provider === 'local' ? 'is-ok' : 'is-off'">
        <span class="dot"></span>{{ s.form.provider === 'local' ? '本地模型' : '云端模型' }}
      </span>
    </header>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="cpu" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">本地 LLM</h3>
          <p class="kb-set-card-desc">配置本地大模型网关，实现完全离线的模拟面试。</p>
        </div>
      </div>
      <div class="lf-field lf-span-2">
        <label class="kb-label">网关地址</label>
        <input
          v-model="s.form.localLlmUrl"
          class="kb-input"
          placeholder="http://localhost:11434/v1"
          spellcheck="false"
          @input="s.onLocalLlmUrlInput()"
        />
        <p class="lf-field-hint">填入后会自动把服务商切到「本地（local）」，面试改用本机 Ollama / LM Studio 推理。</p>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="audio-lines" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">语音识别（Whisper）</h3>
          <p class="kb-set-card-desc">本地语音转写，离线模拟面试与速记的核心。</p>
        </div>
      </div>

      <div class="lf-field lf-span-2">
        <label class="kb-label">本地 Whisper 识别地址</label>
        <input v-model="s.form.whisperUrl" class="kb-input" placeholder="http://127.0.0.1:8080" spellcheck="false" />
        <p class="lf-field-hint">whisper.cpp / whisper-server 的 OpenAI 兼容地址，用于离线语音转写。</p>
      </div>
      <div class="lf-field lf-span-2">
        <label class="kb-label">Whisper 模型名</label>
        <input v-model="s.form.whisperModel" class="kb-input" placeholder="ggml-base" spellcheck="false" />
      </div>

      <div class="lf-divider"></div>

      <div class="lf-subhead">
        <Icon name="audio-lines" :size="16" />
        <span>语音识别模型（按需下载，不随安装包内置）</span>
      </div>
      <p class="lf-field-hint lf-mb-2">
        首次使用某模型需联网下载（约 30–180MB），下载后完全离线运行。运行方式可选「原生 whisper-server」或「前端 WASM」。
      </p>

      <div class="lf-field lf-span-2">
        <label class="kb-label">运行方式</label>
        <div class="lf-radio-row">
          <label class="lf-radio" :class="{ 'is-active': s.speechCfg.runtime === 'native' }">
            <input type="radio" value="native" v-model="s.speechCfg.runtime" />
            <span>原生 whisper-server（推荐，更快更准）</span>
          </label>
          <label class="lf-radio" :class="{ 'is-active': s.speechCfg.runtime === 'wasm' }">
            <input type="radio" value="wasm" v-model="s.speechCfg.runtime" />
            <span>前端 WASM（兜底，需 whisper.wasm）</span>
          </label>
        </div>
      </div>

      <div class="lf-field lf-span-2">
        <label class="kb-label">模型列表</label>
        <ul class="lf-model-list">
          <li v-for="m in s.speechModels.value" :key="m.id" class="lf-model-item">
            <div class="lf-model-main">
              <div class="lf-model-name">
                {{ m.label }}
                <span v-if="m.default" class="lf-tag">默认推荐</span>
              </div>
              <div class="lf-model-meta">{{ m.sizeMB }} MB · {{ m.note }}</div>
            </div>
            <div class="lf-model-ctrl">
              <span v-if="m.status === 'downloaded'" class="lf-badge is-ok">已下载</span>
              <span v-else-if="m.status === 'downloading'" class="lf-badge is-busy">下载中 {{ s.downloadProgress[m.id] || 0 }}%</span>
              <span v-else class="lf-badge is-off">未下载</span>

              <button v-if="m.status === 'available'" class="kb-btn kb-btn-sm kb-btn-primary" :disabled="s.speechBusy.value" @click="s.startDownload(m.id)">下载</button>
              <button v-else-if="m.status === 'downloading'" class="kb-btn kb-btn-sm" @click="s.removeModel(m.id)">取消</button>
              <button v-else class="kb-btn kb-btn-sm kb-btn-ghost" @click="s.removeModel(m.id)">删除</button>
            </div>
            <div v-if="m.status === 'downloading'" class="lf-progress">
              <div class="lf-progress-bar" :style="{ width: (s.downloadProgress[m.id] || 0) + '%' }"></div>
            </div>
          </li>
        </ul>
      </div>

      <div class="lf-field lf-span-2">
        <label class="kb-label">默认模型档位</label>
        <select v-model="s.speechCfg.selectedModelId" class="kb-input">
          <option v-for="m in s.speechModels.value" :key="m.id" :value="m.id">{{ m.label }}（{{ m.sizeMB }}MB）</option>
        </select>
      </div>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-primary" :disabled="s.speechSaving.value" @click="s.saveSpeechSettings()">
          <Icon :name="s.speechSaving.value ? 'loader' : 'save'" :size="16" :class="s.speechSaving.value ? 'lf-spin' : ''" />
          保存语音识别设置
        </button>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="audio-lines" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">语音合成引擎</h3>
          <p class="kb-set-card-desc">选择朗读所用引擎。本地神经网络 Piper 更自然且完全离线。</p>
        </div>
      </div>

      <div class="lf-field lf-span-2">
        <label class="kb-label">朗读引擎</label>
        <div class="lf-radio-row">
          <label class="lf-radio" :class="{ 'is-active': s.ttsEngine.value === 'browser' }">
            <input type="radio" value="browser" v-model="s.ttsEngine.value" />
            <span>系统语音（Web Speech，零依赖）</span>
          </label>
          <label class="lf-radio" :class="{ 'is-active': s.ttsEngine.value === 'piper' }">
            <input type="radio" value="piper" v-model="s.ttsEngine.value" />
            <span>本地神经网络 Piper（更自然·离线）</span>
          </label>
        </div>
      </div>

      <template v-if="s.ttsEngine.value === 'piper'">
        <div class="lf-field lf-span-2">
          <label class="kb-label">默认音色</label>
          <select v-model="s.ttsSelectedVoiceId.value" class="kb-input">
            <option v-for="v in s.ttsVoiceList.value" :key="v.id" :value="v.id" :disabled="v.status !== 'downloaded'">
              {{ v.label }}（{{ v.gender }}·{{ v.sizeMB }}MB）{{ v.status === 'downloaded' ? '' : '· 未下载' }}
            </option>
          </select>
        </div>
        <div class="lf-field lf-span-2">
          <label class="kb-label">音色库（离线，需先下载）</label>
          <ul class="lf-model-list">
            <li v-for="v in s.ttsVoiceList.value" :key="v.id" class="lf-model-item">
              <div class="lf-model-main">
                <div class="lf-model-name">{{ v.label }}
                  <span v-if="v.default" class="lf-tag">推荐</span>
                  <span v-if="v.id === s.ttsSelectedVoiceId.value" class="lf-tag lf-tag-active">当前</span>
                </div>
                <div class="lf-model-meta">{{ v.gender }} · {{ v.sizeMB }} MB · {{ v.note }}</div>
              </div>
              <div class="lf-model-ctrl">
                <span v-if="v.status === 'downloaded'" class="lf-badge is-ok">已下载</span>
                <span v-else-if="v.status === 'downloading'" class="lf-badge is-busy">下载中 {{ s.ttsDownloadProgress[v.id] || 0 }}%</span>
                <span v-else class="lf-badge is-off">未下载</span>
                <button v-if="v.status === 'available'" :disabled="s.ttsBusy.value" class="kb-btn kb-btn-sm kb-btn-primary" @click="s.startTtsDownload(v.id)">下载</button>
                <button v-else-if="v.status === 'downloading'" class="kb-btn kb-btn-sm" @click="s.removeTtsVoice(v.id)">取消</button>
                <button v-else class="kb-btn kb-btn-sm kb-btn-ghost" @click="s.removeTtsVoice(v.id)">删除</button>
              </div>
              <div v-if="v.status === 'downloading'" class="lf-progress">
                <div class="lf-progress-bar" :style="{ width: (s.ttsDownloadProgress[v.id] || 0) + '%' }"></div>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-primary" :disabled="s.ttsSaving.value" @click="s.saveTtsEngine()">
          <Icon :name="s.ttsSaving.value ? 'loader' : 'save'" :size="16" :class="s.ttsSaving.value ? 'lf-spin' : ''" />
          保存引擎设置
        </button>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="audio-lines" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">朗读嗓音（语音合成）</h3>
          <p class="kb-set-card-desc">模拟面试官 / 点评的播报嗓音；更高质量的嗓音可显著减少「人机感」。</p>
        </div>
      </div>
      <div class="lf-field lf-span-2">
        <label class="kb-label">朗读嗓音</label>
        <select v-model="s.ttsSelected.value" class="kb-input" @change="s.onTtsVoiceChange()">
          <option value="">自动（系统最优中文嗓音）</option>
          <option v-for="v in s.ttsVoices.value" :key="v.name" :value="v.name">
            {{ v.name }}（{{ v.lang }}）· {{ v.quality === 'neural' ? '神经网络' : v.quality === 'enhanced' ? '增强版' : '标准' }}
          </option>
        </select>
        <p class="lf-field-hint">
          列表来自本机已安装的语音。若没有高质量嗓音，可在 macOS 系统设置 → 辅助功能 → 语音内容 → 嗓音 中下载中文嗓音，重启应用后即出现在此处。
        </p>
      </div>
      <div class="lf-actions">
        <button class="kb-btn" :disabled="s.ttsPreviewing.value" @click="s.previewTtsVoice()">
          <Icon :name="s.ttsPreviewing.value ? 'loader' : 'play'" :size="16" :class="s.ttsPreviewing.value ? 'lf-spin' : ''" />
          {{ s.ttsPreviewing.value ? '试听中…' : '试听示例' }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { useSettings } from '../useSettings'

const s = useSettings()
</script>

<style scoped>
.lf-field { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
.lf-field .kb-input { width: 100%; }
.lf-field-hint { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin: 0; line-height: 1.4; }
.lf-divider { height: 1px; background: var(--kb-border); margin: .35rem 0 .25rem; }
.lf-subhead { display: flex; align-items: center; gap: .4rem; font-size: var(--kb-fs-h4); font-weight: 600; color: var(--kb-foreground); }
.lf-subhead :deep(svg) { color: var(--kb-primary); }
.lf-mb-2 { margin-bottom: .75rem; }
.lf-radio-row { display: flex; flex-wrap: wrap; gap: .5rem; }
.lf-radio { display: inline-flex; align-items: center; gap: .45rem; padding: .4rem .7rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); cursor: pointer; font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); transition: border-color .15s, background .15s; }
.lf-radio.is-active { border-color: var(--kb-primary); background: var(--kb-primary-soft); }
.lf-radio input { accent-color: var(--kb-primary); }
.lf-model-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
.lf-model-item { display: grid; grid-template-columns: 1fr auto; gap: .35rem .75rem; align-items: center; padding: .6rem .75rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-muted); }
.lf-model-name { font-size: var(--kb-fs-body); font-weight: 600; color: var(--kb-foreground); display: flex; align-items: center; gap: .4rem; }
.lf-tag { font-size: var(--kb-fs-caption); font-weight: 500; padding: .05rem .4rem; border-radius: 999px; background: var(--kb-primary-soft); color: var(--kb-primary); }
.lf-model-meta { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin-top: .1rem; }
.lf-model-ctrl { display: flex; align-items: center; gap: .5rem; }
.lf-model-ctrl .lf-badge { white-space: nowrap; }
.lf-badge { display: inline-flex; align-items: center; gap: .35rem; padding: .15rem .55rem; border-radius: 999px; background: var(--kb-muted); color: var(--kb-muted-foreground); font-size: var(--kb-fs-caption); }
.lf-badge.is-ok { color: var(--kb-primary); background: var(--kb-primary-soft); }
.lf-badge.is-busy { color: var(--kb-warning); background: var(--kb-warning-soft); }
.lf-badge.is-off { color: var(--kb-muted-foreground); }
.lf-progress { grid-column: 1 / -1; height: 6px; border-radius: 999px; background: var(--kb-border); overflow: hidden; }
.lf-progress-bar { height: 100%; background: var(--kb-primary); border-radius: 999px; transition: width .2s ease; }
.lf-actions { display: flex; align-items: center; gap: .625rem; margin-top: 1rem; flex-wrap: wrap; }
.lf-spin { animation: lf-rotate .9s linear infinite; }
@keyframes lf-rotate { to { transform: rotate(360deg); } }
</style>
