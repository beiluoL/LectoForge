<template>
  <div class="sch-page wb-page" :style="{ '--mc': '#6366F1' }">
    <!-- ===== Hero 控制台 ===== -->
    <section class="wb-hero">
      <div class="wb-hero-bg">
        <span class="wb-blob"></span>
        <span class="wb-grid"></span>
      </div>
      <div class="wb-hero-inner">
        <div class="wb-hero-head">
          <div class="wb-hero-text">
            <span class="wb-eyebrow">
              <span class="wb-eyebrow-dot"></span>
              {{ isToday ? '今日任务' : '日程安排' }}
            </span>
            <h1 class="wb-title">
              <Icon name="calendar-days" class="wb-title-icon" :size="26" />
              日程计划
            </h1>
            <p class="wb-subtitle">
              解决<strong>「今天要做什么」</strong>：用模板一键生成今日计划，或随手记下几件事。
              重复任务（每天 / 每周 / 每月）会在你打开对应日期时自动出现。
            </p>
          </div>

          <div class="sch-hero-tools">
            <label class="sch-date">
              <Icon name="calendar" :size="15" />
              <input type="date" :value="currentDate" @change="onDateChange" />
            </label>
            <button class="kb-btn kb-btn-primary" :disabled="generating" @click="openGenerate">
              <Icon name="sparkles" :size="15" />
              {{ generating ? '生成中…' : '✨ 一键生成今日计划' }}
            </button>
            <button class="kb-btn" @click="templateOpen = true">
              <Icon name="layout-template" :size="15" />
              模板管理
            </button>
          </div>
        </div>

        <!-- 进度条 -->
        <div v-if="totalCount" class="sch-progress">
          <div class="sch-progress-bar">
            <span class="sch-progress-fill" :style="{ width: progressPct + '%' }"></span>
          </div>
          <span class="sch-progress-text">已完成 {{ completedCount }} / {{ totalCount }}</span>
        </div>
      </div>
    </section>

    <!-- ===== 任务列表 ===== -->
    <section>
      <div class="wb-section-title">
        <Icon name="list-check" :size="18" />
        {{ isToday ? '今日任务' : `日程安排 · ${currentDate}` }}
        <span class="wb-section-hint">勾选即标记完成，重复任务可单独设置周期</span>
      </div>

      <!-- 加载骨架 -->
      <div v-if="loading" class="wb-skeleton">
        <span v-for="n in 4" :key="n" class="wb-skel-line" style="height: 44px"></span>
      </div>

      <!-- 空态 -->
      <div v-else-if="!totalCount" class="wb-empty">
        <span class="wb-empty-icon"><Icon name="calendar-plus" :size="28" /></span>
        <p class="wb-empty-title">这一天还没有安排</p>
        <p class="wb-empty-desc">
          点右上角「✨ 一键生成今日计划」从模板导入，或在下方文本框直接添加几件事。
        </p>
      </div>

      <!-- 任务行 -->
      <ul v-else class="sch-list">
        <li
          v-for="t in tasks"
          :key="t.id"
          class="sch-row"
          :class="{ 'is-done': t.completed }"
        >
          <button
            class="sch-check"
            :class="{ 'is-checked': t.completed }"
            :aria-label="t.completed ? '标记为未完成' : '标记为已完成'"
            @click="store.toggleTask(t.id)"
          >
            <Icon v-if="t.completed" name="check" :size="14" />
          </button>

          <span class="sch-content" :class="{ 'is-done': t.completed }">{{ t.content }}</span>

          <button
            v-if="t.repeatRule"
            class="sch-repeat-badge"
            :title="'点击修改重复规则'"
            @click="openRepeat(t)"
          >
            <Icon name="repeat" :size="12" />
            {{ repeatLabel(t.repeatRule) }}
          </button>

          <span class="sch-actions">
            <button class="wb-icon-btn" title="设置重复" @click="openRepeat(t)">
              <Icon name="repeat" :size="15" />
            </button>
            <button class="wb-icon-btn note-danger-btn" title="删除" @click="store.removeTask(t.id)">
              <Icon name="trash-2" :size="15" />
            </button>
          </span>
        </li>
      </ul>
    </section>

    <!-- ===== 批量添加 ===== -->
    <section class="sch-add">
      <div class="wb-section-title">
        <Icon name="list-plus" :size="18" />
        快速添加
        <span class="wb-section-hint">每行一条，回车换行，支持一次性粘贴多行</span>
      </div>
      <textarea
        v-model="batchText"
        class="sch-textarea"
        rows="3"
        placeholder="例如：&#10;晨间阅读 30 分钟&#10;复习昨天的复习卡&#10;写周报初稿"
        @keydown.enter.exact.prevent="submitBatch"
      ></textarea>
      <div class="sch-add-foot">
        <span class="sch-add-hint">⌘/Ctrl + Enter 快速添加</span>
        <button
          class="kb-btn kb-btn-primary"
          :disabled="submitting || !batchText.trim()"
          @click="submitBatch"
        >
          <Icon name="plus" :size="15" />
          {{ submitting ? '添加中…' : '添加任务' }}
        </button>
      </div>
    </section>

    <!-- ===== 生成计划弹窗（选模板） ===== -->
    <Teleport to="body">
      <Transition name="sch-fade">
        <div v-if="generateOpen" class="sch-mask" @click.self="generateOpen = false">
          <div class="sch-modal" role="dialog" aria-modal="true" aria-label="选择模板">
            <header class="sch-modal-head">
              <span class="sch-modal-title">
                <Icon name="sparkles" :size="16" />
                从模板生成计划
              </span>
              <button class="qcm-close" @click="generateOpen = false">
                <Icon name="x" :size="15" />
              </button>
            </header>
            <div class="sch-modal-body">
              <p v-if="!templates.length" class="sch-modal-empty">
                还没有模板。先去「模板管理」保存一套你常用的每日任务吧。
              </p>
              <button
                v-for="tpl in templates"
                :key="tpl.id"
                class="sch-tpl-item"
                :disabled="generating"
                @click="pickTemplate(tpl.id)"
              >
                <span class="sch-tpl-name">
                  <Icon name="layout-template" :size="15" />
                  {{ tpl.name }}
                </span>
                <span class="sch-tpl-meta">{{ tpl.tasks.length }} 项 · 含重复 {{ repeatTplCount(tpl) }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ===== 模板管理弹窗 ===== -->
    <TemplateManagerModal v-model:open="templateOpen" :current-tasks="tasks" />

    <!-- ===== 重复规则弹窗 ===== -->
    <TaskRepeatModal
      v-model:open="repeatOpen"
      :initial="repeatTarget ? repeatTarget.repeatRule : null"
      @save="onRepeatSave"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useScheduleStore } from '@/store/schedule-store';
import type { DailyTask, RepeatRule, TaskTemplate } from '@/api/schedule';
import TemplateManagerModal from './components/TemplateManagerModal.vue';
import TaskRepeatModal from './components/TaskRepeatModal.vue';

const store = useScheduleStore();
const { currentDate, tasks, templates, loading, generating, submitting, isToday, completedCount, totalCount, progress } =
  storeToRefs(store);

const progressPct = computed(() => Math.round(progress.value * 100));

/* ===== 弹窗开关 ===== */
const generateOpen = ref(false);
const templateOpen = ref(false);
const repeatOpen = ref(false);
const repeatTarget = ref<DailyTask | null>(null);

/* ===== 批量添加 ===== */
const batchText = ref('');

function onDateChange(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  if (v) store.fetchTasks(v);
}

async function submitBatch() {
  if (!batchText.value.trim() || submitting.value) return;
  await store.batchAddTasks(currentDate.value, batchText.value);
  batchText.value = '';
}

/* ===== 生成计划：选模板 ===== */
function openGenerate() {
  store.fetchTemplates();
  generateOpen.value = true;
}
async function pickTemplate(id: number) {
  await store.generateFromTemplate(id);
  generateOpen.value = false;
}

/* ===== 重复规则编辑 ===== */
function openRepeat(t: DailyTask) {
  repeatTarget.value = t;
  repeatOpen.value = true;
}
async function onRepeatSave(rule: RepeatRule | null) {
  if (repeatTarget.value) await store.setRepeat(repeatTarget.value.id, rule);
  repeatOpen.value = false;
  repeatTarget.value = null;
}

/* ===== 文案辅助 ===== */
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function repeatLabel(rule: RepeatRule): string {
  switch (rule.type) {
    case 'daily':
      return rule.interval <= 1 ? '每天' : `每 ${rule.interval} 天`;
    case 'weekly':
      return '每周 ' + (rule.days.length ? rule.days.map((d) => WEEK[d]).join('') : '—');
    case 'monthly':
      return `每月 ${rule.day} 号`;
    default:
      return '';
  }
}

function repeatTplCount(tpl: TaskTemplate): number {
  return tpl.tasks.filter((t) => t.repeatRule).length;
}

onMounted(() => {
  store.fetchTemplates();
  store.fetchTasks();
});
</script>

<style scoped>
.sch-page {
  max-width: 880px;
  margin: 0 auto;
  padding: 8px 4px 40px;
}

/* Hero 工具区 */
.sch-hero-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.sch-date {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  color: var(--kb-muted-foreground);
  font-size: 13px;
}
.sch-date input {
  border: none;
  background: transparent;
  color: var(--kb-foreground);
  font: inherit;
  outline: none;
}
@media (max-width: 640px) {
  .sch-hero-tools {
    justify-content: flex-start;
  }
}

/* 进度条 */
.sch-progress {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sch-progress-bar {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mc) 16%, transparent);
  overflow: hidden;
}
.sch-progress-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--mc);
  transition: width 0.3s ease;
}
.sch-progress-text {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--kb-muted-foreground);
  white-space: nowrap;
}

/* 任务列表 */
.sch-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sch-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  transition: border-color 0.15s ease, opacity 0.15s ease;
}
.sch-row:hover {
  border-color: color-mix(in srgb, var(--mc) 40%, var(--kb-border));
}
.sch-row.is-done {
  opacity: 0.62;
}
.sch-check {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  border: 2px solid var(--kb-border);
  background: var(--kb-card);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sch-check.is-checked {
  background: var(--mc);
  border-color: var(--mc);
}
.sch-content {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--kb-foreground);
  word-break: break-word;
}
.sch-content.is-done {
  text-decoration: line-through;
  color: var(--kb-muted-foreground);
}
.sch-repeat-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--mc);
  background: color-mix(in srgb, var(--mc) 12%, transparent);
  border: none;
  cursor: pointer;
}
.sch-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.sch-row:hover .sch-actions,
.sch-row:focus-within .sch-actions {
  opacity: 1;
}

/* 批量添加 */
.sch-add {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sch-textarea {
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  color: var(--kb-foreground);
  font: inherit;
  line-height: 1.6;
  outline: none;
  transition: border-color 0.15s ease;
}
.sch-textarea:focus {
  border-color: var(--mc);
}
.sch-add-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sch-add-hint {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}

/* ===== 弹窗（生成选模板） ===== */
.sch-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 18, 24, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.sch-modal {
  width: 460px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.sch-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--kb-border);
}
.sch-modal-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.sch-modal-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 60vh;
  overflow-y: auto;
}
.sch-modal-empty {
  margin: 0;
  font-size: 13px;
  color: var(--kb-muted-foreground);
  text-align: center;
  padding: 16px 0;
}
.sch-tpl-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  padding: 10px 14px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}
.sch-tpl-item:hover:not(:disabled) {
  border-color: var(--mc);
  background: color-mix(in srgb, var(--mc) 6%, var(--kb-card));
}
.sch-tpl-item:disabled {
  opacity: 0.6;
  cursor: default;
}
.sch-tpl-name {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.sch-tpl-meta {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}

.sch-fade-enter-active,
.sch-fade-leave-active {
  transition: opacity 0.18s ease;
}
.sch-fade-enter-from,
.sch-fade-leave-to {
  opacity: 0;
}
</style>
