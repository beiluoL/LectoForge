<template>
  <!-- 统一设置中心：通用配置 + AI 模型服务 + AI 能力清单 + 关于。
       通过唯一「⚙️ 设置」入口进入（旧 /settings/ai 已重定向至此）。
       视觉沿用工作台 --kb-* 设计令牌，卡片化、上下左右对称，贴近 macOS 系统偏好设置。 -->
  <div class="lf-page animate-fade-in">
    <!-- 返回条（sticky 常驻）：设置页是 standalone 无顶栏页，这里是回到主界面的唯一出口。
         左侧「返回」优先回上一页，无历史时兜底回工作台；右侧提示未保存改动。 -->
    <div class="lf-backbar">
      <button type="button" class="kb-btn lf-back-btn" :title="backTitle" @click="goBack">
        <Icon name="arrow-left" :size="'15px'" />
        {{ backLabel }}
        <kbd class="lf-kbd">Esc</kbd>
      </button>
      <span v-if="dirty" class="lf-dirty" title="修改尚未写入本机配置文件">
        <i class="lf-dirty-dot"></i> 有未保存的修改
      </span>
    </div>

    <!-- 页头 -->
    <header class="lf-head">
      <h1 class="lf-title">
        <Icon name="settings" :size="'22px'" class="lf-title-icon" /> 设置
      </h1>
      <p class="lf-sub">管理数据目录与 AI 服务。所有配置只保存在本机，随时可改。</p>
    </header>

    <!-- ============ 卡片 1：通用配置 ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="folder-open" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">知识库数据目录</h2>
          <p class="lf-card-desc">笔记、复习卡片、记忆宫殿等数据的存放位置。</p>
        </div>
      </div>

      <div class="lf-dir-row">
        <input
          v-model="form.dataDir"
          class="kb-input"
          placeholder="~/Library/Application Support/com.lectoforge.desktop"
          spellcheck="false"
        />
        <button class="kb-btn" :disabled="picking" @click="pickDirectory">
          <Icon :name="picking ? 'loader' : 'folder-search'" :size="'15px'" :class="picking ? 'lf-spin' : ''" />
          选择文件夹
        </button>
      </div>
      <p class="lf-hint">修改后建议重启应用生效；迁移既有数据请手动拷贝。</p>
    </section>

    <!-- ============ 卡片 2：外观（主题 / 强调色 / 紧凑模式） ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="palette" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">外观</h2>
          <p class="lf-card-desc">主题、强调色与界面密度即时生效，并保存在本机。</p>
        </div>
      </div>

      <div class="lf-field">
        <label class="kb-label">主题</label>
        <div class="lf-radio-row">
          <label
            v-for="t in themeOptions"
            :key="t.value"
            class="lf-radio"
            :class="{ 'is-active': appStore.settings.ui.theme === t.value }"
          >
            <input type="radio" v-model="appStore.settings.ui.theme" :value="t.value" @change="onThemeChange" />
            <span>{{ t.label }}</span>
          </label>
        </div>
      </div>

      <div class="lf-field">
        <label class="kb-label">强调色</label>
        <div class="lf-accent-row">
          <button
            v-for="a in accentOptions"
            :key="a.value"
            type="button"
            class="lf-accent-swatch"
            :class="{ 'is-on': appStore.settings.ui.accent === a.value }"
            :style="{ background: a.color }"
            :title="a.label"
            :aria-label="a.label"
            @click="onAccentChange(a.value)"
          >
            <Icon v-if="appStore.settings.ui.accent === a.value" name="check" :size="'sm'" />
          </button>
        </div>
        <p class="lf-hint">强调色影响按钮、链接与选中态；深色主题下自动切换提亮档。</p>
      </div>

      <label class="lf-switch">
        <input type="checkbox" v-model="appStore.settings.ui.compact" @change="onCompactChange" />
        <span class="lf-switch-track"></span>
        <span class="lf-switch-label">紧凑模式</span>
      </label>
      <p class="lf-hint">减小任务、笔记、文件树等列表行高与间距，单屏显示更多内容。</p>
    </section>

    <!-- ============ 卡片 3：数据导出 ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="download" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">数据导出</h2>
          <p class="lf-card-desc">把学习数据导出为 CSV，随时可迁移或留档。</p>
        </div>
      </div>
      <div class="lf-export-row">
        <button class="kb-btn kb-btn-sm" @click="downloadCsv('reviews')">
          <Icon name="file-text" :size="'sm'" /> 复习记录
        </button>
        <button class="kb-btn kb-btn-sm" @click="downloadCsv('habits')">
          <Icon name="calendar-check" :size="'sm'" /> 习惯打卡
        </button>
        <button class="kb-btn kb-btn-sm" @click="downloadCsv('tasks')">
          <Icon name="list-checks" :size="'sm'" /> 任务清单
        </button>
      </div>
    </section>

    <!-- ============ 卡片 2：AI 模型配置（多服务商接入 + 开箱即用） ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="bot" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">AI 模型服务</h2>
          <p class="lf-card-desc">选择服务商、粘贴 API Key 即可使用。所有 AI 能力均为可选增强，不配置也不影响原有功能。</p>
        </div>
        <span class="lf-status" :class="statusClass">
          <i class="lf-status-dot"></i>{{ statusText }}
        </span>
      </div>

      <label class="lf-switch">
        <input type="checkbox" v-model="form.enabled" />
        <span class="lf-switch-track"></span>
        <span class="lf-switch-label">启用 AI 增强功能</span>
      </label>

      <!-- 服务商选择：一键切换，自动填充 baseUrl / 推荐模型 -->
      <div class="lf-provider-list" role="radiogroup" aria-label="选择模型服务商">
        <button
          v-for="p in presets"
          :key="p.value"
          type="button"
          class="lf-provider-chip"
          :class="{ active: form.provider === p.value }"
          :aria-checked="form.provider === p.value"
          @click="selectProvider(p.value)"
        >
          <span class="lf-provider-name">{{ p.label }}</span>
          <span v-if="p.value === 'deepseek'" class="lf-provider-tag">推荐</span>
        </button>
      </div>

      <!-- 当前选中服务商的帮助引导 -->
      <div v-if="currentPreset" class="lf-help-panel">
        <Icon name="circle-help" :size="'md'" />
        <div class="lf-help-body">
          <p class="lf-help-text">{{ currentPreset.helpText }}</p>
          <a
            v-if="currentPreset.signupUrl"
            :href="currentPreset.signupUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="lf-help-link"
          >
            <Icon name="external-link" :size="'xs'" /> 直达注册 / 获取 API Key
          </a>
        </div>
      </div>

      <!-- 核心配置：API Key + 模型 + 高级折叠 -->
      <div class="lf-grid2">
        <div class="lf-field lf-span-2">
          <label class="kb-label">API Key</label>
          <div class="lf-key-row">
            <input
              v-model="form.apiKey"
              class="kb-input"
              type="password"
              autocomplete="off"
              :placeholder="saved.apiKeyMask ? `已保存：${saved.apiKeyMask}（留空表示不修改）` : '粘贴你的 API Key'"
            />
            <button
              v-if="saved.apiKeyMask"
              class="kb-btn kb-btn-danger"
              title="清空已保存的 Key"
              @click="clearKey"
            >
              <Icon name="trash-2" :size="'sm'" /> 清空
            </button>
          </div>
          <p class="lf-field-hint">只保存在本机数据目录（权限 600），不会上传、不进版本库。</p>
        </div>

        <div class="lf-field">
          <label class="kb-label">模型</label>
          <div class="lf-model-row">
            <select v-if="currentPreset?.models?.length" v-model="form.model" class="kb-input">
              <option v-for="m in currentPreset.models" :key="m" :value="m">{{ m }}</option>
              <option value="__custom__">自定义模型名…</option>
            </select>
            <input v-else v-model="form.model" class="kb-input" placeholder="输入模型名" spellcheck="false" />
            <input
              v-if="form.model === '__custom__' || !currentPreset?.models?.length"
              v-model="customModel"
              class="kb-input"
              placeholder="输入模型名"
              spellcheck="false"
            />
          </div>
        </div>

        <div class="lf-field">
          <label class="kb-label">超时（秒）</label>
          <input type="number" min="5" max="180" class="kb-input" v-model.number="form.timeoutSec" />
          <p class="lf-field-hint">长文生成建议 45 秒以上。</p>
        </div>

        <div class="lf-field lf-span-2">
          <label class="kb-label">采样温度 {{ form.temperature.toFixed(1) }}</label>
          <input
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            v-model.number="form.temperature"
            class="lf-range"
          />
          <p class="lf-field-hint">越低越稳定。评分类任务建议 0.1~0.3。</p>
        </div>

        <!-- 高级：自定义 baseUrl -->
        <div class="lf-field lf-span-2">
          <button type="button" class="lf-advanced-toggle" @click="showAdvanced = !showAdvanced">
            <Icon :name="showAdvanced ? 'chevron-up' : 'chevron-down'" :size="'sm'" />
            {{ showAdvanced ? '收起高级设置' : '展开高级设置（API 网关地址）' }}
          </button>
          <div v-if="showAdvanced" class="lf-advanced-body">
            <label class="kb-label">API 网关地址</label>
            <input v-model="form.baseUrl" class="kb-input" placeholder="https://api.deepseek.com/v1" spellcheck="false" />
            <p class="lf-field-hint">默认已按服务商自动填充，通常无需修改。填到 /v1 为止，不要带 /chat/completions。</p>
          </div>
        </div>
      </div>

      <!-- 操作栏：测试连通性 + 保存设置 -->
      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" :disabled="testing" @click="onTest">
          <Icon :name="testing ? 'loader' : 'plug-zap'" :size="'sm'" :class="testing ? 'lf-spin' : ''" />
          测试连通性
        </button>
        <button class="kb-btn kb-btn-primary" :disabled="saving" @click="saveAll">
          <Icon :name="saving ? 'loader' : 'save'" :size="'md'" :class="saving ? 'lf-spin' : ''" />
          保存设置
        </button>
        <span v-if="testState" class="lf-test-result" :class="testState.ok ? 'is-ok' : 'is-fail'">
          <Icon :name="testState.ok ? 'check-circle' : 'x-circle'" :size="'sm'" />
          {{ testState.text }}
        </span>
      </div>

      <!-- 向量化服务（内容关联，可选，与原 /settings/ai 一致） -->
      <div class="lf-embed">
        <div class="lf-card-head" style="margin-bottom: .5rem;">
          <Icon name="boxes" :size="'md'" class="lf-card-icon" style="color: var(--kb-muted-foreground);" />
          <div>
            <h3 class="lf-card-title" style="font-size: var(--kb-fs-body-md);">向量化服务（内容关联）</h3>
            <p class="lf-card-desc">用于「内容关联 / 学习路径」，与聊天服务可独立配置，可选。</p>
          </div>
          <span class="lf-status" :class="saved.embeddingsConfigured ? 'is-ok' : 'is-off'">
            <i class="lf-status-dot"></i>{{ saved.embeddingsConfigured ? '已配置' : '未配置（可选）' }}
          </span>
        </div>

        <div class="lf-grid2">
          <div class="lf-field">
            <label class="kb-label">向量化服务商</label>
            <select v-model="form.embeddingsProvider" class="kb-input" @change="applyEmbeddingPreset">
              <option v-for="p in embedPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div class="lf-field">
            <label class="kb-label">向量模型</label>
            <input v-model="form.embeddingsModel" class="kb-input" placeholder="BAAI/bge-m3" spellcheck="false" />
          </div>
          <div class="lf-field lf-span-2">
            <label class="kb-label">向量化 API 地址</label>
            <input v-model="form.embeddingsBaseUrl" class="kb-input" placeholder="https://api.siliconflow.cn/v1" spellcheck="false" />
          </div>
          <div class="lf-field lf-span-2">
            <label class="kb-label">向量化 API Key</label>
            <div class="lf-key-row">
              <input
                v-model="form.embeddingsApiKey"
                class="kb-input"
                type="password"
                autocomplete="off"
                :placeholder="saved.embeddingsConfigured ? '已保存（留空表示不修改）' : '粘贴向量化服务的 API Key'"
              />
              <button
                v-if="saved.embeddingsConfigured"
                class="kb-btn kb-btn-danger"
                title="清空已保存的向量化 Key"
                @click="clearEmbeddingKey"
              >
                <Icon name="trash-2" :size="'sm'" /> 清空
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 卡片 2b：本地模型（离线模拟面试） ============ -->
    <section class="lf-card" id="local-model">
      <div class="lf-card-head">
        <Icon name="cpu" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">本地模型（离线模拟面试）</h2>
          <p class="lf-card-desc">配置本地 LLM 与 Whisper 语音识别，实现完全离线的模拟面试 / 语音通话。</p>
        </div>
        <span class="lf-status" :class="form.provider === 'local' ? 'is-ok' : 'is-off'">
          <i class="lf-status-dot"></i>{{ form.provider === 'local' ? '本地模型' : '云端模型' }}
        </span>
      </div>

      <div class="lf-grid2">
        <div class="lf-field lf-span-2">
          <label class="kb-label">本地 LLM 网关地址</label>
          <input
            v-model="form.localLlmUrl"
            class="kb-input"
            placeholder="http://localhost:11434/v1"
            spellcheck="false"
            @input="onLocalLlmUrlInput"
          />
          <p class="lf-field-hint">填入后会自动把服务商切到「本地（local）」，面试改用本机 Ollama / LM Studio 推理。</p>
        </div>

        <div class="lf-field lf-span-2">
          <label class="kb-label">本地 Whisper 识别地址</label>
          <input v-model="form.whisperUrl" class="kb-input" placeholder="http://127.0.0.1:8080" spellcheck="false" />
          <p class="lf-field-hint">whisper.cpp / whisper-server 的 OpenAI 兼容地址，用于离线语音转写。</p>
        </div>

        <div class="lf-field lf-span-2">
          <label class="kb-label">Whisper 模型名</label>
          <input v-model="form.whisperModel" class="kb-input" placeholder="ggml-base" spellcheck="false" />
        </div>
      </div>

      <div class="lf-divider"></div>

      <div class="lf-subhead">
        <Icon name="audio-lines" :size="'md'" />
        <span>语音识别模型（按需下载，不随安装包内置）</span>
      </div>
      <p class="lf-field-hint lf-mb-2">
        首次使用某模型需联网下载（约 30–180MB），下载后完全离线运行。运行方式可选「原生 whisper-server」（二进制已随包内置）或「前端 WASM」。
      </p>

      <div class="lf-field lf-span-2">
        <label class="kb-label">运行方式</label>
        <div class="lf-radio-row">
          <label class="lf-radio" :class="{ 'is-active': speechCfg.runtime === 'native' }">
            <input type="radio" value="native" v-model="speechCfg.runtime" />
            <span>原生 whisper-server（推荐，更快更准）</span>
          </label>
          <label class="lf-radio" :class="{ 'is-active': speechCfg.runtime === 'wasm' }">
            <input type="radio" value="wasm" v-model="speechCfg.runtime" />
            <span>前端 WASM（兜底，需 whisper.wasm）</span>
          </label>
        </div>
      </div>

      <div class="lf-field lf-span-2">
        <label class="kb-label">模型列表</label>
        <ul class="lf-model-list">
          <li v-for="m in speechModels" :key="m.id" class="lf-model-item">
            <div class="lf-model-main">
              <div class="lf-model-name">
                {{ m.label }}
                <span v-if="m.default" class="lf-tag">默认推荐</span>
              </div>
              <div class="lf-model-meta">{{ m.sizeMB }} MB · {{ m.note }}</div>
            </div>
            <div class="lf-model-ctrl">
              <span v-if="m.status === 'downloaded'" class="lf-badge is-ok">已下载</span>
              <span v-else-if="m.status === 'downloading'" class="lf-badge is-busy">下载中 {{ downloadProgress[m.id] || 0 }}%</span>
              <span v-else class="lf-badge is-off">未下载</span>

              <button
                v-if="m.status === 'available'"
                class="kb-btn kb-btn-sm kb-btn-primary"
                :disabled="speechBusy"
                @click="startDownload(m.id)"
              >下载</button>
              <button
                v-else-if="m.status === 'downloading'"
                class="kb-btn kb-btn-sm"
                @click="removeModel(m.id)"
              >取消</button>
              <button
                v-else
                class="kb-btn kb-btn-sm kb-btn-ghost"
                @click="removeModel(m.id)"
              >删除</button>
            </div>
            <div v-if="m.status === 'downloading'" class="lf-progress">
              <div class="lf-progress-bar" :style="{ width: (downloadProgress[m.id] || 0) + '%' }"></div>
            </div>
          </li>
        </ul>
      </div>

      <div class="lf-field lf-span-2">
        <label class="kb-label">默认模型档位</label>
        <select v-model="speechCfg.selectedModelId" class="kb-input">
          <option v-for="m in speechModels" :key="m.id" :value="m.id">{{ m.label }}（{{ m.sizeMB }}MB）</option>
        </select>
        <p class="lf-field-hint">语音转写 / 模拟面试默认使用的模型；可在各入口临时切换。</p>
      </div>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-primary" :disabled="speechSaving" @click="saveSpeechSettings">
          <Icon :name="speechSaving ? 'loader' : 'save'" :size="'md'" :class="speechSaving ? 'lf-spin' : ''" />
          保存语音识别设置
        </button>
      </div>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-primary" :disabled="saving" @click="saveAll">
          <Icon :name="saving ? 'loader' : 'save'" :size="'md'" :class="saving ? 'lf-spin' : ''" />
          保存本地模型设置
        </button>
      </div>
    </section>

    <!-- ============ 卡片 2c：语音合成引擎（TTS 引擎 + 本地神经网络音色） ============ -->
    <section class="lf-card" id="tts-engine">
      <div class="lf-card-head">
        <Icon name="audio-lines" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">语音合成引擎</h2>
          <p class="lf-card-desc">
            选择朗读所用引擎。<b>本地神经网络 Piper</b> 为 VITS 神经嗓音、自然度远超系统语音且完全离线；
            <b>系统语音</b>为零依赖、立即可用。
          </p>
        </div>
      </div>

      <div class="lf-field lf-span-2">
        <label class="kb-label">朗读引擎</label>
        <div class="lf-radio-row">
          <label class="lf-radio">
            <input type="radio" value="browser" v-model="ttsEngine" />
            <span>系统语音（Web Speech，零依赖）</span>
          </label>
          <label class="lf-radio">
            <input type="radio" value="piper" v-model="ttsEngine" />
            <span>本地神经网络 Piper（更自然·离线）</span>
          </label>
        </div>
      </div>

      <template v-if="ttsEngine === 'piper'">
        <div class="lf-field lf-span-2">
          <label class="kb-label">默认音色</label>
          <select v-model="ttsSelectedVoiceId" class="kb-input">
            <option v-for="v in ttsVoiceList" :key="v.id" :value="v.id" :disabled="v.status !== 'downloaded'">
              {{ v.label }}（{{ v.gender }}·{{ v.sizeMB }}MB）{{ v.status === 'downloaded' ? '' : '· 未下载' }}
            </option>
          </select>
        </div>

        <div class="lf-field lf-span-2">
          <label class="kb-label">音色库（离线，需先下载）</label>
          <ul class="lf-model-list">
            <li v-for="v in ttsVoiceList" :key="v.id" class="lf-model-item">
              <div class="lf-model-main">
                <div class="lf-model-name">{{ v.label }}
                  <span v-if="v.default" class="lf-tag">推荐</span>
                  <span v-if="v.id === ttsSelectedVoiceId" class="lf-tag lf-tag-active">当前</span>
                </div>
                <div class="lf-model-meta">{{ v.gender }} · {{ v.sizeMB }} MB · {{ v.note }}</div>
              </div>
              <div class="lf-model-ctrl">
                <span v-if="v.status === 'downloaded'" class="lf-badge is-ok">已下载</span>
                <span v-else-if="v.status === 'downloading'" class="lf-badge is-busy">下载中 {{ ttsDownloadProgress[v.id] || 0 }}%</span>
                <span v-else class="lf-badge is-off">未下载</span>
                <button v-if="v.status === 'available'" :disabled="ttsBusy" @click="startTtsDownload(v.id)">下载</button>
                <button v-else-if="v.status === 'downloading'" @click="removeTtsVoice(v.id)">取消</button>
                <button v-else @click="removeTtsVoice(v.id)">删除</button>
              </div>
              <div v-if="v.status === 'downloading'" class="lf-progress">
                <div class="lf-progress-bar" :style="{ width: (ttsDownloadProgress[v.id] || 0) + '%' }"></div>
              </div>
            </li>
          </ul>
          <p class="lf-field-hint">
            音色来自 HuggingFace <code>rhasspy/piper-voices</code>，首次下载需联网（走国内镜像）。下载后朗读完全离线、不联网、不上传。
          </p>
        </div>
      </template>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-primary" :disabled="ttsSaving" @click="saveTtsEngine">
          <Icon :name="ttsSaving ? 'loader' : 'save'" :size="'md'" :class="ttsSaving ? 'lf-spin' : ''" />
          保存引擎设置
        </button>
      </div>
    </section>

    <!-- ============ 卡片 2d：朗读嗓音（系统语音 Web Speech 微调） ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="audio-lines" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">朗读嗓音（语音合成）</h2>
          <p class="lf-card-desc">模拟面试官/点评的播报嗓音；选更高质量的嗓音可显著减少「人机感」。</p>
        </div>
      </div>

      <div class="lf-field lf-span-2">
        <label class="kb-label">朗读嗓音</label>
        <select v-model="ttsSelected" class="kb-input" @change="onTtsVoiceChange">
          <option value="">自动（系统最优中文嗓音）</option>
          <option v-for="v in ttsVoices" :key="v.name" :value="v.name">
            {{ v.name }}（{{ v.lang }}）· {{ v.quality === 'neural' ? '神经网络' : v.quality === 'enhanced' ? '增强版' : '标准' }}
          </option>
        </select>
        <p class="lf-field-hint">
          列表来自本机已安装的语音。若没有高质量嗓音，可在 macOS
          <b>系统设置 → 辅助功能 → 语音内容 → 嗓音</b> 中下载「增强版 / Premium / Siri」中文嗓音，
          重启应用后即出现在此处。
        </p>
      </div>

      <div class="lf-actions">
        <button class="kb-btn" :disabled="ttsPreviewing" @click="previewTtsVoice">
          <Icon :name="ttsPreviewing ? 'loader' : 'play'" :size="'md'" :class="ttsPreviewing ? 'lf-spin' : ''" />
          {{ ttsPreviewing ? '试听中…' : '试听示例' }}
        </button>
      </div>
    </section>

    <!-- ============ 卡片 3：AI 能力清单 ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="brain-circuit" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">已接入的 AI 能力</h2>
          <p class="lf-card-desc">每项能力都是「按需触发 + 结果可编辑」：AI 只把结果填进输入框，是否采纳由你决定。</p>
        </div>
      </div>

      <div class="lf-cap-grid">
        <article v-for="c in capabilities" :key="c.name" class="lf-cap">
          <span class="lf-cap-icon"><Icon :name="c.icon" :size="'md'" /></span>
          <div class="lf-cap-body">
            <p class="lf-cap-name">{{ c.name }}</p>
            <p class="lf-cap-desc">{{ c.desc }}</p>
          </div>
          <router-link :to="c.to" class="kb-btn kb-btn-sm lf-cap-go">
            前往 <Icon name="chevron-right" :size="'xs'" />
          </router-link>
        </article>
      </div>
    </section>

    <!-- ============ 卡片 4：关于 ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="info" :size="'lg'" class="lf-card-icon" style="color: var(--kb-muted-foreground);" />
        <div>
          <h2 class="lf-card-title">关于</h2>
          <p class="lf-card-desc">本机离线运行的个人学习工作台。</p>
        </div>
      </div>
      <dl class="lf-about">
        <div><dt>应用</dt><dd>LectoForge 学习工作台</dd></div>
        <div><dt>版本</dt><dd>v1.0.0</dd></div>
        <div><dt>运行模式</dt><dd><span class="lf-badge"><Icon name="hard-drive" :size="'xs'" /> 本地离线</span></dd></div>
      </dl>

      <!-- 数据备份：立即备份 + 每日自动备份开关与时刻 + 最近备份列表 -->
      <div class="lf-backup">
        <div class="lf-card-head" style="margin: 1.1rem 0 .75rem;">
          <Icon name="archive" :size="'lg'" class="lf-card-icon" style="color: var(--kb-muted-foreground);" />
          <div>
            <h3 class="lf-card-title" style="font-size: var(--kb-fs-body-md);">数据备份</h3>
            <p class="lf-card-desc">定期把数据库、上传文件与配置打包成 zip，换机或重装后可一键恢复。</p>
          </div>
        </div>

        <div class="lf-dir-row">
          <input
            v-model="appStore.backup.dir"
            class="kb-input"
            placeholder="选择备份保存目录"
            spellcheck="false"
          />
          <button class="kb-btn" :disabled="pickingBackup" @click="pickBackupDir">
            <Icon :name="pickingBackup ? 'loader' : 'folder-search'" :size="'15px'" :class="pickingBackup ? 'lf-spin' : ''" />
            选择文件夹
          </button>
        </div>

        <div class="lf-actions">
          <button class="kb-btn kb-btn-primary" :disabled="backupBusy" @click="onBackupNow">
            <Icon :name="backupBusy ? 'loader' : 'download'" :size="'15px'" :class="backupBusy ? 'lf-spin' : ''" />
            立即备份
          </button>
          <button class="kb-btn kb-btn-sm" @click="openBackupFolder">
            <Icon name="folder-open" :size="'sm'" /> 打开目录
          </button>
          <span v-if="backupMsg" class="lf-test-result" :class="backupMsg.ok ? 'is-ok' : 'is-fail'">
            <Icon :name="backupMsg.ok ? 'check-circle' : 'x-circle'" :size="'sm'" />
            {{ backupMsg.text }}
          </span>
        </div>

        <label class="lf-switch">
          <input type="checkbox" v-model="appStore.backup.auto" @change="onToggleAuto" />
          <span class="lf-switch-track"></span>
          <span class="lf-switch-label">每日自动备份</span>
        </label>

        <div v-if="appStore.backup.auto" class="lf-field lf-span-2" style="margin-top: .6rem;">
          <label class="kb-label">每日触发时刻</label>
          <input type="time" v-model="appStore.backup.time" class="kb-input" style="max-width: 160px;" @change="onTimeChange" />
        </div>

        <div v-if="backupList.length" class="lf-backup-list">
          <p class="lf-field-hint">最近备份（共 {{ backupList.length }} 个）</p>
          <ul>
            <li v-for="b in backupList" :key="b.name">
              <Icon name="file" :size="'sm'" />
              <span class="lf-bname">{{ b.name }}</span>
              <span class="lf-bmeta">{{ formatSize(b.size) }} · {{ formatTime(b.modifiedAt) }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" @click="rerunOnboarding">
          <Icon name="rotate-ccw" :size="'sm'" /> 重新运行新手引导
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
// 统一设置中心（2026-08-08 重构）：将原 /settings（通用配置）与 /settings/ai（AI 详细配置 + 能力清单）
// 三页面融合为单一设置界面，仅靠顶栏唯一「⚙️ 设置」入口进入。
//
// ⚠️ 架构红线（不改动后端契约）：
// - 数据目录经 useAppStore.saveSettings() → POST /api/config/init 落盘；
// - AI 全量配置经 saveAiConfig() → PUT /api/ai/config 落盘（完整保留 enabled / temperature / timeoutMs / embeddings）。
// - 由于 /config/init 后端会把 enabled 写死 true 且仅收 apiUrl/apiKey/model，
//   统一保存时**先存数据目录、再存 AI 全量配置（最后写）**，确保最终实现以表单为准、不丢温度/超时/向量化。
// - 明文 apiKey 绝不进 localStorage：store 的 persist.pick 已排除；表单提交时留空表示保持已保存值。
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
// 顶层静态导入：build 模式下动态 import('@tauri-apps/api/core') 的 chunk 可能加载失败
import { invoke } from '@tauri-apps/api/core'
// 数据备份：用 fs 插件确保备份目录存在（Tauri 2 fs 插件）
import { mkdir } from '@tauri-apps/plugin-fs'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError, confirmDialog, toastState } from '@/utils/toast'
import { useAppStore } from '@/store/app-store'
import {
  applyTheme,
  applyAccent,
  applyDensity,
  type ThemePref,
  type AccentPref,
} from '@/utils/ui-prefs'
import { useSearchStore } from '@/store/search-store'
import { useInboxStore } from '@/store/inbox-store'
import { useNoteStore } from '@/store/note-store'
import { getAppConfig } from '@/api/config'
import {
  getAiConfig,
  saveAiConfig,
  testAiConnection,
  type AiConfigVO,
  type AiProviderPreset,
  type AiPingResult,
} from '@/api/ai'
import {
  getSpeechModels,
  getSpeechConfig,
  saveSpeechConfig,
  deleteSpeechModel,
  downloadSpeechModel,
  type SpeechModelEntry,
  type SpeechConfig,
} from '@/api/speechModels'
import {
  listChineseVoices,
  getSelectedVoiceName,
  setSelectedVoiceName,
  speakText,
  cancelSpeech,
  type TtsVoiceOption,
} from '@/lib/tts/tts'
import {
  getTtsVoices,
  getTtsConfig,
  saveTtsConfig,
  deleteTtsVoice,
  downloadTtsVoice,
  type VoiceEntry,
  type TtsConfig,
} from '@/api/ttsVoices'

const router = useRouter()
const appStore = useAppStore()

/** 外观：主题三选一（浅色 / 深色 / 跟随系统） */
const themeOptions: { value: ThemePref; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

/** 外观：强调色 6 档（色值与 style.css data-accent 预设保持一致，双主题联动） */
const accentOptions: { value: AccentPref; label: string; color: string }[] = [
  { value: 'blue', label: '默认蓝', color: '#3B6FE0' },
  { value: 'indigo', label: '靛蓝', color: '#4F46E5' },
  { value: 'purple', label: '紫罗兰', color: '#7C3AED' },
  { value: 'green', label: '翡翠绿', color: '#10B981' },
  { value: 'orange', label: '琥珀橙', color: '#F59E0B' },
  { value: 'pink', label: '玫红', color: '#EC4899' },
]

function onThemeChange(): void {
  applyTheme(appStore.settings.ui.theme)
}
function onAccentChange(accent: AccentPref): void {
  appStore.settings.ui.accent = accent
  applyAccent(accent)
}
function onCompactChange(): void {
  applyDensity(appStore.settings.ui.compact)
}

/** 数据导出：CSV 附件下载（同源 /api/export/*） */
function downloadCsv(kind: 'reviews' | 'habits' | 'tasks') {
  window.open(`/api/export/${kind}`, '_blank')
}
// 仅用于 Esc 互斥判断：这三个全局弹层由 App.vue 的 window keydown 统一消费 Esc，
// 弹层开着时本页不能抢走这次 Esc，否则会「关弹层的同时把页面也退掉」。
const searchStore = useSearchStore()
const inboxStore = useInboxStore()
const noteStore = useNoteStore()

const picking = ref(false)
const testing = ref(false)
const saving = ref(false)
const testState = ref<{ ok: boolean; text: string } | null>(null)

// 数据备份相关本地状态
const pickingBackup = ref(false)
const backupBusy = ref(false)
const backupMsg = ref<{ ok: boolean; text: string } | null>(null)
const backupList = ref<Array<{ name: string; size: number; modifiedAt: number }>>([])

// ============ 离线语音模型（运行时 + 模型下载）============
// 与上方 AI 配置（whisperUrl/whisperModel）解耦：本段管理「下载哪些模型权重、
// 用原生还是 WASM 运行、默认档位」，经独立端点 /api/models/* 落盘 speech-config.json。
const speechModels = ref<SpeechModelEntry[]>([])
const speechCfg = reactive<SpeechConfig>({ runtime: 'native', selectedModelId: 'base-q5_1', updatedAt: '' })
const speechBusy = ref(false) // 是否正在下载（禁用其它下载按钮）
const speechSaving = ref(false)
const downloadProgress = reactive<Record<string, number>>({})

// ============ 朗读嗓音（语音合成 TTS 选择，B 阶段快赢）============
// 仅前端 Web Speech API 范畴，按 name 持久化到 localStorage；换机/换嗓音回落最优中文嗓音。
const ttsVoices = ref<TtsVoiceOption[]>([])
const ttsSelected = ref('') // 选中的嗓音 name；'' = 自动（最优）
const ttsPreviewing = ref(false)

// ============ 语音合成引擎（TTS：系统语音 / 本地神经网络 Piper）============
const ttsEngine = ref<'browser' | 'piper'>('browser')
const ttsSelectedVoiceId = ref('zh_CN-huayan-medium')
const ttsVoiceList = ref<VoiceEntry[]>([])
const ttsBusy = ref(false)
const ttsSaving = ref(false)
const ttsDownloadProgress = reactive<Record<string, number>>({})

async function loadTtsVoices() {
  const list = await listChineseVoices()
  ttsVoices.value = list
  ttsSelected.value = getSelectedVoiceName()
}

function onTtsVoiceChange() {
  setSelectedVoiceName(ttsSelected.value)
}

async function previewTtsVoice() {
  if (ttsPreviewing.value) {
    cancelSpeech()
    ttsPreviewing.value = false
    return
  }
  ttsPreviewing.value = true
  const sample =
    '你好，我是你的面试助手。下面请你用一分钟，介绍一下最近做过的项目，以及你在其中承担的角色。'
  await speakText(sample, { rate: 0.98, pitch: 1, sentenceGapMs: 120 })
  ttsPreviewing.value = false
}

async function loadSpeech() {
  try {
    const [models, cfg] = await Promise.all([getSpeechModels(), getSpeechConfig()])
    speechModels.value = models
    speechCfg.runtime = cfg.runtime
    speechCfg.selectedModelId = cfg.selectedModelId
    speechCfg.updatedAt = cfg.updatedAt
  } catch (e) {
    notify(getApiError(e, '读取语音模型列表失败'), 'error')
  }
}

async function startDownload(id: string) {
  if (speechBusy.value) return
  speechBusy.value = true
  downloadProgress[id] = 0
  try {
    await downloadSpeechModel(id, (evt) => {
      if (evt.type === 'progress') downloadProgress[id] = evt.pct || 0
    })
    notify('模型下载完成，可离线使用', 'success')
  } catch (e) {
    notify(getApiError(e, '模型下载失败'), 'error')
  } finally {
    speechBusy.value = false
    downloadProgress[id] = 0
    await loadSpeech() // 刷新列表状态
  }
}

async function removeModel(id: string) {
  try {
    await deleteSpeechModel(id)
    notify('已删除模型文件', 'success')
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
  await loadSpeech()
}

async function saveSpeechSettings() {
  if (speechSaving.value) return
  speechSaving.value = true
  try {
    const cfg = await saveSpeechConfig({
      runtime: speechCfg.runtime,
      selectedModelId: speechCfg.selectedModelId,
    })
    speechCfg.updatedAt = cfg.updatedAt
    notify('语音识别设置已保存', 'success')
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  } finally {
    speechSaving.value = false
  }
}

// ============ 语音合成引擎（TTS：系统语音 / 本地神经网络 Piper）============
async function loadTts() {
  try {
    const [voices, cfg] = await Promise.all([getTtsVoices(), getTtsConfig()])
    ttsVoiceList.value = voices
    ttsEngine.value = cfg.engine
    ttsSelectedVoiceId.value = cfg.selectedVoiceId
  } catch (e) {
    notify(getApiError(e, '读取 TTS 配置失败'), 'error')
  }
}

async function saveTtsEngine() {
  if (ttsSaving.value) return
  ttsSaving.value = true
  try {
    const cfg = await saveTtsConfig({
      engine: ttsEngine.value,
      selectedVoiceId: ttsSelectedVoiceId.value,
    })
    ttsEngine.value = cfg.engine
    ttsSelectedVoiceId.value = cfg.selectedVoiceId
    notify('TTS 引擎设置已保存', 'success')
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  } finally {
    ttsSaving.value = false
  }
}

async function startTtsDownload(id: string) {
  if (ttsBusy.value) return
  ttsBusy.value = true
  ttsDownloadProgress[id] = 0
  try {
    await downloadTtsVoice(id, (evt) => {
      if (evt.type === 'progress') ttsDownloadProgress[id] = evt.pct || 0
    })
    notify('音色下载完成，可离线使用', 'success')
  } catch (e) {
    notify(getApiError(e, '音色下载失败'), 'error')
  } finally {
    ttsBusy.value = false
    ttsDownloadProgress[id] = 0
    await loadTts() // 刷新列表状态
  }
}

async function removeTtsVoice(id: string) {
  try {
    await deleteTtsVoice(id)
    notify('已删除音色文件', 'success')
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
  await loadTts()
}

const presets = ref<AiProviderPreset[]>([])
const embedPresets = ref<AiProviderPreset[]>([])
const showAdvanced = ref(false)
const customModel = ref('')

/** 当前选中服务商的预设 */
const currentPreset = computed<AiProviderPreset | undefined>(() =>
  presets.value.find((p) => p.value === form.provider),
)

/** 已保存配置的安全视图（掩码 + 状态），不持有明文 */
const saved = reactive({
  apiKeyMask: '',
  configured: false,
  embeddingsConfigured: false,
})

const form = reactive({
  // 通用配置
  dataDir: '',
  // AI 模型服务
  enabled: true,
  provider: 'deepseek',
  baseUrl: '',
  model: '',
  apiKey: '',
  temperature: 0.3,
  timeoutSec: 45,
  // 向量化（内容关联，可选，与聊天服务解耦）
  embeddingsProvider: 'siliconflow',
  embeddingsBaseUrl: '',
  embeddingsApiKey: '',
  embeddingsModel: '',
  // 本地模型（离线模拟面试）：localLlmUrl 与上方 baseUrl 二选一，填了即切 local provider
  localLlmUrl: '',
  whisperUrl: '',
  whisperModel: '',
})

/** AI 能力清单（原 AiSettings.vue 迁移，图标均为 lucide 合法名，经 <Icon> 渲染） */
const capabilities = [
  { icon: 'wand-2', name: '费曼故事清晰度评分', desc: '按通俗度/完整度/准确度/类比质量四维打分，并指出你还没真正理解的地方。', to: '/workbench/story' },
  { icon: 'edit-2', name: '主动回忆语义评分', desc: '换个说法也算对——按意思还原度评分，比字面比对准得多。', to: '/workbench/recall' },
  { icon: 'notebook-pen', name: '康奈尔笔记线索列生成', desc: '从笔记正文自动生成问题式线索列与总结区。', to: '/workbench/notes' },
  { icon: 'bar-chart-3', name: '学习周报 / 洞察', desc: '把复习量、遗忘率等硬数据讲成自然语言周报。', to: '/insights/ai' },
  { icon: 'target', name: '薄弱点诊断', desc: '基于近期答错/遗忘记录，归纳常在哪类知识上翻车。', to: '/insights/ai' },
  { icon: 'map-pin', name: '记忆宫殿位点生成', desc: '给知识点自动铺成有序空间位点，并配联想图像。', to: '/workbench/palace' },
  { icon: 'list-ordered', name: '智能复习推荐', desc: '结合排程与遗忘记录，告诉你现在最该复习什么。', to: '/insights/ai' },
  { icon: 'git-merge', name: '内容关联 / 学习路径', desc: '把收集箱、笔记、故事向量化后串成学习路径。', to: '/insights/ai' },
]

const statusClass = computed(() => {
  if (!form.enabled) return 'is-off'
  return saved.configured ? 'is-ok' : 'is-err'
})
const statusText = computed(() => {
  if (!form.enabled) return '已关闭'
  return saved.configured ? '已就绪' : '待配置'
})

/* ============ 返回主界面 ============
 * 设置页 meta.standalone = true（App.vue 不渲染顶栏），必须自带出口。
 * 返回目标优先取进入设置前的来源页（vue-router 把它维护在 history.state.back），
 * 冷启动 / 深链直达设置时无来源，兜底回工作台，避免 router.back() 退出应用。 */
const backPath = ref<string | null>(null)

const backLabel = computed(() => (backPath.value ? '返回' : '返回工作台'))
const backTitle = computed(() =>
  backPath.value ? `返回上一页（${backPath.value}）· Esc` : '返回工作台 · Esc',
)

/** 统一出口：有历史来源走 back（保留滚动位置与前进历史），否则 push 工作台 */
function goBack() {
  if (backPath.value) router.back()
  else router.push('/workbench')
}

/** 全局弹层是否占用着 Esc（命令面板 / 速记 / 极速新建 / 确认框） */
function overlayHoldsEsc(): boolean {
  return (
    searchStore.isOpen ||
    inboxStore.quickOpen ||
    noteStore.quickCreateOpen ||
    toastState.confirms.length > 0
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (overlayHoldsEsc()) return
  goBack()
}

/* ============ 未保存改动保护 ============
 * 表单快照 vs 基线：任何出口（返回按钮、Esc、能力清单「前往」、重新运行引导）
 * 都经 onBeforeRouteLeave 统一确认，保护逻辑只有一处，不散落在各按钮里。 */
const baseline = ref('')

function snapshot(): string {
  return JSON.stringify({
    dataDir: form.dataDir.trim(),
    enabled: form.enabled,
    provider: form.provider,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    temperature: form.temperature,
    timeoutSec: form.timeoutSec,
    embeddingsProvider: form.embeddingsProvider,
    embeddingsBaseUrl: form.embeddingsBaseUrl.trim(),
    embeddingsModel: form.embeddingsModel.trim(),
    // 本地模型
    localLlmUrl: form.localLlmUrl.trim(),
    whisperUrl: form.whisperUrl.trim(),
    whisperModel: form.whisperModel.trim(),
    // Key 只看「是否填了新值」，明文不进快照
    keyTouched: !!form.apiKey.trim(),
    embedKeyTouched: !!form.embeddingsApiKey.trim(),
  })
}

/** 基线为空 = 首屏配置尚未载入，此时一律视为干净，避免加载期误报 */
const dirty = computed(() => !!baseline.value && snapshot() !== baseline.value)

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  return await confirmDialog('设置有未保存的修改，确定离开吗？未保存的改动将丢失。')
})

/** 解析表单中实际生效的模型名（处理「自定义模型名」选项） */
function resolveModel(): string {
  if (form.model === '__custom__') return customModel.value.trim()
  return form.model.trim()
}

function applyPreset() {
  const p = currentPreset.value
  if (!p) return
  if (p.baseUrl) form.baseUrl = p.baseUrl
  if (p.models?.length && p.models.includes(p.model)) {
    form.model = p.model
    customModel.value = ''
  } else if (p.model) {
    form.model = '__custom__'
    customModel.value = p.model
  } else {
    form.model = '__custom__'
    customModel.value = ''
  }
}

function selectProvider(value: string) {
  form.provider = value
  applyPreset()
}

function applyEmbeddingPreset() {
  const p = embedPresets.value.find((x) => x.value === form.embeddingsProvider)
  if (!p || !p.baseUrl) return
  form.embeddingsBaseUrl = p.baseUrl
  form.embeddingsModel = p.model
}

/**
 * 本地 LLM 网关地址输入：一旦用户填写（且非空），即把服务商切到 local，
 * 并把该地址同步到 form.baseUrl，使后续「保存」走本地推理（Ollama / LM Studio）。
 */
function onLocalLlmUrlInput() {
  const url = form.localLlmUrl.trim()
  if (url) {
    form.provider = 'local'
    form.baseUrl = url
  }
}

/** 用后端返回的完整配置视图回填表单（apiKey 字段留空，避免明文残留） */
function syncAiForm(cfg: AiConfigVO) {
  saved.apiKeyMask = cfg.apiKeyMask || ''
  saved.configured = !!cfg.configured
  saved.embeddingsConfigured = !!cfg.embeddingsConfigured
  form.enabled = cfg.enabled
  form.provider = cfg.provider
  form.baseUrl = cfg.baseUrl
  // 模型：若在服务商预设列表中则直接选；否则落入「自定义」
  const p = presets.value.find((x) => x.value === cfg.provider)
  if (p?.models?.length && p.models.includes(cfg.model)) {
    form.model = cfg.model
    customModel.value = ''
  } else {
    form.model = '__custom__'
    customModel.value = cfg.model || ''
  }
  form.temperature = cfg.temperature
  form.apiKey = ''
  form.embeddingsApiKey = ''
  form.embeddingsModel = cfg.embeddingsModel || ''
  form.timeoutSec = Math.round(cfg.timeoutMs / 1000)
  // 本地模型：provider 为 local 时把网关地址回填到专用字段；whisper 直接回填
  form.localLlmUrl = cfg.provider === 'local' ? cfg.baseUrl : ''
  form.whisperUrl = cfg.whisperUrl || ''
  form.whisperModel = cfg.whisperModel || ''
  showAdvanced.value = false
}

onMounted(async () => {
  // 解析来源页：排除 /settings 自身（旧 /settings/ai 重定向而来）与 /onboarding（引导页不该被回退到）
  const prev = (window.history.state as { back?: unknown } | null)?.back
  backPath.value =
    typeof prev === 'string' && prev && !prev.startsWith('/settings') && !prev.startsWith('/onboarding')
      ? prev
      : null
  window.addEventListener('keydown', onKeydown)

  await appStore.initFromBackend()
  try {
    const cfg = await getAiConfig()
    presets.value = cfg.presets || []
    embedPresets.value = cfg.embeddingPresets || []
    syncAiForm(cfg)
  } catch (e) {
    notify(getApiError(e, '读取 AI 配置失败'), 'error')
  }
  try {
    const app = await getAppConfig()
    if (app.dataDir) form.dataDir = app.dataDir
  } catch {
    form.dataDir = appStore.settings.dataDir
  }
  // 数据备份计划（不计入「未保存改动」基线）
  await loadBackupSettings()
  // 离线语音模型列表 / 配置（独立端点，不计入上方 AI 配置基线）
  await loadSpeech()
  // 语音合成引擎（系统语音 / 本地神经网络 Piper 音色）
  await loadTts()
  // 朗读嗓音列表（Web Speech API，前端范畴）
  await loadTtsVoices()
  // 全部载入完成后才立基线，否则回填过程会被误判成「用户改动」
  baseline.value = snapshot()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
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

async function onTest() {
  if (testing.value) return
  const model = resolveModel()
  if (!form.baseUrl.trim() || (!model && form.enabled)) {
    notify('请先选择或填写模型名再测试', 'info')
    return
  }
  testing.value = true
  testState.value = null
  try {
    const r = await testAiConnection({
      enabled: form.enabled,
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model,
      apiKey: form.apiKey.trim() || undefined,
      temperature: form.temperature,
      timeoutMs: Math.round(form.timeoutSec * 1000),
    })
    testState.value = { ok: true, text: `✅ 连接正常 · ${r.model} · ${r.latencyMs}ms` }
  } catch (e) {
    testState.value = { ok: false, text: `❌ 连接失败，请检查 Key 或网关地址（${getApiError(e, '')}）` }
  } finally {
    testing.value = false
  }
}

/**
 * 统一保存：先存数据目录（POST /config/init），再存 AI 全量配置（PUT /ai/config，最后写）。
 * 顺序保证 AI 的 enabled / temperature / timeoutMs / embeddings 不被 /config/init 的写死逻辑覆盖。
 */
async function saveAll() {
  if (saving.value) return
  const model = resolveModel()
  if (form.enabled && (!form.baseUrl.trim() || !model)) {
    notify('请填写 API 网关地址与模型名后再保存', 'warning')
    return
  }
  saving.value = true
  try {
    // 1) 数据目录：同步到 store 后走 POST /config/init
    appStore.updateSettings({
      dataDir: form.dataDir.trim(),
      ai: { apiUrl: form.baseUrl.trim(), apiKey: form.apiKey, model },
    })
    await appStore.saveSettings()

    // 2) AI 全量配置：最后写，权威覆盖（保留 enabled / 温度 / 超时 / 向量化）
    const cfg = await saveAiConfig({
      enabled: form.enabled,
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model,
      apiKey: form.apiKey.trim() || undefined,
      temperature: form.temperature,
      timeoutMs: Math.round(form.timeoutSec * 1000),
      embeddingsBaseUrl: form.embeddingsBaseUrl.trim(),
      embeddingsApiKey: form.embeddingsApiKey.trim() || undefined,
      embeddingsModel: form.embeddingsModel.trim(),
      whisperUrl: form.whisperUrl.trim() || undefined,
      whisperModel: form.whisperModel.trim() || undefined,
    })
    presets.value = cfg.presets || presets.value
    embedPresets.value = cfg.embeddingPresets || embedPresets.value
    syncAiForm(cfg)
    baseline.value = snapshot() // 已落盘，重置基线以撤下「未保存」提示
    notify('设置已保存', 'success')
  } catch (e) {
    notify(getApiError(e, '保存失败，请重试'), 'error')
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  if (!(await confirmDialog('确定清空已保存的 API Key？清空后所有 AI 功能将自动降级为不可用。'))) return
  try {
    const cfg = await saveAiConfig({ apiKey: null })
    syncAiForm(cfg)
    baseline.value = snapshot()
    notify('已清空 API Key', 'success')
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}

async function clearEmbeddingKey() {
  if (!(await confirmDialog('确定清空已保存的向量化 API Key？「内容关联」功能将降级为不可用。'))) return
  try {
    const cfg = await saveAiConfig({ embeddingsApiKey: null })
    syncAiForm(cfg)
    baseline.value = snapshot()
    notify('已清空向量化 Key', 'success')
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}

/** 重新运行引导：跳回 /onboarding（守卫会在 hasOnboarded=true 时拦截，故用 query 放行） */
function rerunOnboarding() {
  router.push({ path: '/onboarding', query: { rerun: '1' } })
}

/* ============ 数据备份 ============
 * 目录 / 开关 / 时刻经 store 持久化到 localStorage，并实时经 Rust 命令落盘到后端 backup-config.json；
 * 立即备份与每日调度都由 Rust 侧调用后端 POST /api/backup（Node 侧车用 child_process 跑 backup.js）。 */

/** 把当前备份设置写回后端（Rust → 后端 PUT /api/backup/schedule） */
async function persistSchedule(): Promise<void> {
  try {
    await invoke('set_backup_schedule', {
      enabled: appStore.backup.auto,
      time: appStore.backup.time,
      outDir: appStore.backup.dir,
    })
  } catch (e) {
    notify(getApiError(e, '保存备份计划失败'), 'error')
  }
}

/** 选择备份保存目录 */
async function pickBackupDir() {
  if (pickingBackup.value) return
  pickingBackup.value = true
  try {
    const dir = await invoke<string>('select_directory')
    if (dir) {
      appStore.updateBackup({ dir })
      await persistSchedule()
      await refreshBackupList()
    }
  } catch {
    /* 用户取消：静默 */
  } finally {
    pickingBackup.value = false
  }
}

/** 立即备份一次 */
async function onBackupNow() {
  if (backupBusy.value) return
  if (!appStore.backup.dir) {
    notify('请先选择备份保存目录', 'info')
    return
  }
  backupBusy.value = true
  backupMsg.value = null
  try {
    // 用 fs 插件确保目录存在（backup.js 也会自建，这里用 fs 插件做一次）
    try {
      await mkdir(appStore.backup.dir, { recursive: true })
    } catch {
      /* 目录可能已存在，忽略 */
    }
    const zipPath = await invoke<string>('create_backup', { outDir: appStore.backup.dir })
    backupMsg.value = { ok: true, text: `已备份：${zipPath.split('/').pop()}` }
    await refreshBackupList()
  } catch (e) {
    backupMsg.value = { ok: false, text: getApiError(e, '备份失败') }
  } finally {
    backupBusy.value = false
  }
}

/** 切换每日自动备份 */
async function onToggleAuto() {
  await persistSchedule()
}

/** 修改每日触发时刻 */
async function onTimeChange() {
  await persistSchedule()
}

/** 打开备份目录（Finder 中定位） */
async function openBackupFolder() {
  if (!appStore.backup.dir) {
    notify('请先选择备份保存目录', 'info')
    return
  }
  try {
    await invoke('open_backup_folder', { path: appStore.backup.dir })
  } catch (e) {
    notify(getApiError(e, '打开目录失败'), 'error')
  }
}

/** 刷新最近备份列表（Rust list_backups 命令，std::fs 读取，无 ACL 范围限制） */
async function refreshBackupList() {
  if (!appStore.backup.dir) {
    backupList.value = []
    return
  }
  try {
    const list = await invoke<Array<{ name: string; size: number; modifiedAt: number }>>('list_backups', {
      dir: appStore.backup.dir,
    })
    backupList.value = list
  } catch {
    backupList.value = []
  }
}

/** 载入后端保存的备份计划，回填 UI；目录为空时默认落到数据目录下的 backups/ */
async function loadBackupSettings() {
  try {
    const s = await invoke<{ enabled: boolean; time: string; outDir: string }>('get_backup_schedule')
    let dir = s.outDir || ''
    if (!dir && appStore.settings.dataDir) dir = `${appStore.settings.dataDir}/backups`
    appStore.updateBackup({ dir, auto: s.enabled, time: s.time || '03:00' })
    // 把默认目录落盘，保证自动备份在用户未手动选择时也能运行
    if (dir) await persistSchedule()
  } catch {
    /* 后端未就绪（如浏览器预览）：保留本地持久化值 */
  }
  await refreshBackupList()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(secs: number): string {
  const d = new Date(secs * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.lf-page { max-width: 56rem; margin: 0 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }

/* 返回条：贴 viewport 顶部常驻（本页无顶栏，滚到卡片深处也要能一键回去）。
   负 margin 抵掉 .lf-page 的 padding，使毛玻璃背景横向铺满、视觉上等同原生 toolbar。 */
.lf-backbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: .75rem;
  margin: -1.5rem -1.5rem 0;
  padding: .625rem 1.5rem;
  border-bottom: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-background) 82%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
}
.lf-back-btn { display: inline-flex; align-items: center; gap: .375rem; font-weight: 600; }
.lf-back-btn:hover { color: var(--kb-primary); border-color: var(--kb-primary); }
.lf-kbd {
  margin-left: .125rem;
  padding: .05rem .3rem;
  border: 1px solid var(--kb-border);
  border-radius: 4px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  line-height: 1.5;
}
.lf-dirty {
  display: inline-flex;
  align-items: center;
  gap: .375rem;
  margin-left: auto;
  font-size: var(--kb-fs-caption);
  color: var(--kb-warning);
}
.lf-dirty-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--kb-warning); }

.lf-head { margin-bottom: -.25rem; }
.lf-title { display: flex; align-items: center; gap: .5rem; font-size: var(--kb-fs-h2); font-weight: 700; color: var(--kb-foreground); margin: 0; }
.lf-title-icon { color: var(--kb-primary); }
.lf-sub { color: var(--kb-muted-foreground); font-size: var(--kb-fs-body-sm); margin: .3rem 0 0; }

.lf-card {
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-lg);
  padding: 1.25rem 1.375rem;
  box-shadow: var(--shadow-card, 0 1px 2px rgba(0,0,0,.04));
}
.lf-card-head { display: flex; align-items: flex-start; gap: .625rem; margin-bottom: .75rem; }
.lf-card-icon { color: var(--kb-primary); margin-top: 2px; flex-shrink: 0; }
.lf-card-title { font-size: var(--kb-fs-h4); font-weight: 600; color: var(--kb-foreground); margin: 0; }
.lf-card-desc { font-size: var(--kb-fs-body-sm); color: var(--kb-muted-foreground); margin: .125rem 0 0; line-height: 1.5; }

.lf-hint { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin-top: .75rem; line-height: 1.5; }

.lf-dir-row { display: flex; gap: .5rem; align-items: center; }
.lf-dir-row .kb-input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--kb-fs-body-sm); }

/* 状态徽标 */
.lf-status { display: inline-flex; align-items: center; gap: .375rem; font-size: var(--kb-fs-caption); padding: .15rem .55rem; border-radius: 999px; margin-left: auto; align-self: center; background: var(--kb-muted); color: var(--kb-muted-foreground); }
.lf-status-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--kb-muted-foreground); }
.lf-status.is-ok { color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 12%, transparent); }
.lf-status.is-ok .lf-status-dot { background: var(--kb-primary); }
.lf-status.is-err { color: var(--kb-warning); background: color-mix(in srgb, var(--kb-warning) 14%, transparent); }
.lf-status.is-err .lf-status-dot { background: var(--kb-warning); }
.lf-status.is-off { color: var(--kb-muted-foreground); }

/* 启用开关 */
.lf-switch { display: inline-flex; align-items: center; gap: .5rem; margin: .25rem 0 .75rem; cursor: pointer; }
.lf-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.lf-switch-track { width: 38px; height: 22px; border-radius: 999px; background: var(--kb-border); position: relative; transition: background .15s ease; flex-shrink: 0; }
.lf-switch-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s ease; }
.lf-switch input:checked + .lf-switch-track { background: var(--kb-primary); }
.lf-switch input:checked + .lf-switch-track::after { transform: translateX(16px); }
.lf-switch-label { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); font-weight: 500; }

/* 2 列表单网格 */
.lf-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.lf-span-2 { grid-column: span 2; }
.lf-field { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
.lf-field .kb-input { width: 100%; }
.lf-field-hint { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin: 0; line-height: 1.4; }
.lf-key-row { display: flex; align-items: center; gap: .5rem; }
.lf-key-row .kb-input { flex: 1; min-width: 0; }
.lf-range { width: 100%; accent-color: var(--kb-primary); }

/* 操作栏 */
.lf-actions { display: flex; align-items: center; gap: .625rem; margin-top: 1rem; flex-wrap: wrap; }
.lf-test-result { display: inline-flex; align-items: center; gap: .35rem; font-size: var(--kb-fs-caption); }
.lf-test-result.is-ok { color: var(--kb-accent); }
.lf-test-result.is-fail { color: var(--kb-destructive); }

/* 服务商选择卡片 */
.lf-provider-list { display: flex; flex-wrap: wrap; gap: .5rem; margin: .25rem 0 .75rem; }
.lf-provider-chip { display: inline-flex; align-items: center; gap: .4rem; padding: .45rem .7rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-card); color: var(--kb-foreground); font-size: var(--kb-fs-body-sm); cursor: pointer; transition: border-color .15s, background .15s, color .15s; }
.lf-provider-chip:hover { border-color: var(--kb-primary); }
.lf-provider-chip.active { border-color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 10%, transparent); color: var(--kb-primary); font-weight: 600; }
.lf-provider-tag { font-size: var(--kb-fs-caption); padding: .05rem .35rem; border-radius: 999px; background: var(--kb-primary); color: var(--kb-primary-foreground); }

/* 帮助引导面板 */
.lf-help-panel { display: flex; align-items: flex-start; gap: .625rem; padding: .75rem .9rem; border-radius: var(--kb-radius-md); background: color-mix(in srgb, var(--kb-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--kb-primary) 22%, transparent); margin-bottom: .75rem; }
.lf-help-panel :deep(svg) { flex-shrink: 0; color: var(--kb-primary); margin-top: .15rem; }
.lf-help-body { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
.lf-help-text { margin: 0; font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); line-height: 1.5; }
.lf-help-link { display: inline-flex; align-items: center; gap: .3rem; font-size: var(--kb-fs-body-sm); font-weight: 600; color: var(--kb-primary); text-decoration: none; }
.lf-help-link:hover { text-decoration: underline; }

/* 模型选择行 */
.lf-model-row { display: flex; align-items: center; gap: .5rem; }
.lf-model-row .kb-input { flex: 1; min-width: 0; }

/* 高级设置折叠 */
.lf-advanced-toggle { display: inline-flex; align-items: center; gap: .35rem; padding: .35rem .5rem; margin: .25rem 0; border: none; background: transparent; color: var(--kb-muted-foreground); font-size: var(--kb-fs-body-sm); cursor: pointer; }
.lf-advanced-toggle:hover { color: var(--kb-primary); }
.lf-advanced-body { display: flex; flex-direction: column; gap: .35rem; }

/* 向量化服务子区 */
.lf-embed { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid var(--kb-border); }

/* 能力清单网格 */
.lf-cap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .625rem; margin-top: .5rem; }
.lf-cap { display: flex; align-items: center; gap: .75rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); padding: .625rem .75rem; background: var(--kb-card); }
.lf-cap-icon { flex-shrink: 0; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: color-mix(in srgb, var(--kb-primary) 10%, transparent); color: var(--kb-primary); }
.lf-cap-body { flex: 1; min-width: 0; }
.lf-cap-name { font-size: var(--kb-fs-body-sm); font-weight: 600; color: var(--kb-foreground); margin: 0; }
.lf-cap-desc { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin: .125rem 0 0; line-height: 1.4; }
.lf-cap-go { flex-shrink: 0; }

/* 关于 */
.lf-about { display: flex; flex-direction: column; gap: .5rem; margin: 0; }
.lf-about > div { display: flex; align-items: center; gap: 1rem; }
.lf-about dt { width: 84px; flex-shrink: 0; font-size: var(--kb-fs-body-sm); color: var(--kb-muted-foreground); margin: 0; }
.lf-about dd { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); margin: 0; }
.lf-badge { display: inline-flex; align-items: center; gap: .35rem; padding: .15rem .55rem; border-radius: 999px; background: var(--kb-muted); color: var(--kb-muted-foreground); font-size: var(--kb-fs-caption); }

/* 数据备份子区 */
.lf-backup { border-top: 1px solid var(--kb-border); padding-top: .25rem; margin-top: -.25rem; }
.lf-dir-row .kb-input { font-family: var(--font-mono); font-size: var(--kb-fs-body-sm); }
.lf-backup-list { margin-top: .9rem; }
.lf-backup-list ul { list-style: none; margin: .4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; max-height: 12rem; overflow-y: auto; }
.lf-backup-list li { display: flex; align-items: center; gap: .5rem; padding: .35rem .55rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-muted); }
.lf-backup-list li > :first-child { color: var(--kb-muted-foreground); flex-shrink: 0; }
.lf-bname { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); font-family: var(--font-mono); word-break: break-all; }
.lf-bmeta { margin-left: auto; font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); white-space: nowrap; flex-shrink: 0; }

.lf-spin { animation: lf-rotate .9s linear infinite; }
@keyframes lf-rotate { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .lf-grid2 { grid-template-columns: 1fr; }
  .lf-span-2 { grid-column: span 1; }
  .lf-cap-grid { grid-template-columns: 1fr; }
}

/* ============ 离线语音模型管理 ============ */
.lf-divider { height: 1px; background: var(--kb-border); margin: .35rem 0 .25rem; }
.lf-subhead { display: flex; align-items: center; gap: .4rem; font-size: var(--kb-fs-h4); font-weight: 600; color: var(--kb-foreground); }
.lf-subhead :deep(svg) { color: var(--kb-primary); }
.lf-mb-2 { margin-bottom: .75rem; }

.lf-radio-row { display: flex; flex-wrap: wrap; gap: .5rem; }
.lf-radio { display: inline-flex; align-items: center; gap: .45rem; padding: .4rem .7rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); cursor: pointer; font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); transition: border-color .15s, background .15s; }
.lf-radio.is-active { border-color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 10%, transparent); }
.lf-radio input { accent-color: var(--kb-primary); }
.lf-accent-row { display: flex; flex-wrap: wrap; gap: .5rem; }
.lf-accent-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 2px solid transparent;
  color: #fff;
  cursor: pointer;
  transition: transform .12s ease, border-color .12s ease, box-shadow .12s ease;
}
.lf-accent-swatch:hover { transform: scale(1.08); }
.lf-accent-swatch.is-on {
  border-color: var(--kb-foreground);
  box-shadow: 0 0 0 2px var(--kb-card), 0 0 0 4px var(--kb-foreground);
}
.lf-export-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.lf-model-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
.lf-model-item { display: grid; grid-template-columns: 1fr auto; gap: .35rem .75rem; align-items: center; padding: .6rem .75rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-muted); }
.lf-model-name { font-size: var(--kb-fs-body-md); font-weight: 600; color: var(--kb-foreground); display: flex; align-items: center; gap: .4rem; }
.lf-tag { font-size: var(--kb-fs-caption); font-weight: 500; padding: .05rem .4rem; border-radius: 999px; background: color-mix(in srgb, var(--kb-primary) 16%, transparent); color: var(--kb-primary); }
.lf-model-meta { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin-top: .1rem; }
.lf-model-ctrl { display: flex; align-items: center; gap: .5rem; }
.lf-model-ctrl .lf-badge { white-space: nowrap; }
.lf-badge.is-ok { color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 14%, transparent); }
.lf-badge.is-busy { color: var(--kb-warning); background: color-mix(in srgb, var(--kb-warning) 14%, transparent); }
.lf-badge.is-off { color: var(--kb-muted-foreground); }

.lf-progress { grid-column: 1 / -1; height: 6px; border-radius: 999px; background: var(--kb-border); overflow: hidden; }
.lf-progress-bar { height: 100%; background: var(--kb-primary); border-radius: 999px; transition: width .2s ease; }
</style>
