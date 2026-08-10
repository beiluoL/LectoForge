<template>
  <Teleport to="body">
    <Transition name="sch-fade">
      <div v-if="open" class="sch-mask" @click.self="close">
        <div class="sch-modal" role="dialog" aria-modal="true" aria-label="模板管理">
          <header class="sch-modal-head">
            <div class="sch-modal-titles">
              <span class="wb-eyebrow sch-eyebrow">
                <Icon name="layout-template" :size="12" />
                每日任务模板
              </span>
              <span class="sch-modal-title">模板管理</span>
            </div>
            <button class="qcm-close" title="关闭" @click="close">
              <Icon name="x" :size="15" />
            </button>
          </header>

          <div class="sch-modal-body">
            <!-- 保存当前任务为模板 -->
            <div class="sch-save">
              <div class="wb-field">
                <label class="wb-label">用当前任务新建模板</label>
                <div class="sch-save-row">
                  <input
                    v-model="newName"
                    class="kb-input"
                    placeholder="例如：晨间 Routine / 备考日"
                    @keydown.enter="saveAsTemplate"
                  />
                  <button
                    class="kb-btn kb-btn-primary kb-btn-sm"
                    :disabled="savingTemplate || !newName.trim()"
                    @click="saveAsTemplate"
                  >
                    <Icon name="save" :size="14" />
                    保存
                  </button>
                </div>
              </div>
              <p class="sch-save-hint">
                将把「{{ currentTasks.length }}」条当前任务（含重复规则）存为可复用模板。
              </p>
            </div>

            <!-- 模板列表 -->
            <div v-if="!templates.length" class="wb-empty" style="padding: 32px 16px">
              <span class="wb-empty-icon"><Icon name="layout-template" :size="24" /></span>
              <p class="wb-empty-title">还没有模板</p>
              <p class="wb-empty-desc">在上面输入名称，把今天的任务存成第一个模板。</p>
            </div>

            <ul v-else class="sch-tpl-list">
              <li v-for="tpl in templates" :key="tpl.id" class="sch-tpl-card">
                <div class="sch-tpl-head">
                  <span class="sch-tpl-title">
                    <Icon name="layout-template" :size="15" />
                    {{ tpl.name }}
                  </span>
                  <button class="wb-icon-btn note-danger-btn" title="删除模板" @click="store.removeTemplate(tpl.id)">
                    <Icon name="trash-2" :size="15" />
                  </button>
                </div>
                <ul class="sch-tpl-tasks">
                  <li v-for="(t, i) in tpl.tasks" :key="i" class="sch-tpl-task">
                    <span class="sch-dot"></span>
                    <span class="sch-tpl-task-content">{{ t.content }}</span>
                    <span v-if="t.repeatRule" class="sch-tpl-task-repeat">
                      <Icon name="repeat" :size="11" />
                      {{ repeatLabel(t.repeatRule) }}
                    </span>
                  </li>
                  <li v-if="!tpl.tasks.length" class="sch-tpl-task sch-tpl-task-empty">（无任务）</li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useScheduleStore } from '@/store/schedule-store';
import type { DailyTask, RepeatRule } from '@/api/schedule';

const props = defineProps<{
  open: boolean;
  /** 当前日期的任务，用于「保存为模板」 */
  currentTasks: DailyTask[];
}>();

const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>();

const store = useScheduleStore();
const { templates, savingTemplate } = storeToRefs(store);

const newName = ref('');

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

function close() {
  emit('update:open', false);
}

async function saveAsTemplate() {
  if (!newName.value.trim()) return;
  await store.saveAsTemplate(newName.value);
  newName.value = '';
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      store.fetchTemplates();
      newName.value = '';
    }
  },
);
</script>

<style scoped>
/* 遮罩：全屏固定 + 居中（原先漏写在 index.vue 的 scoped 里，子组件收不到，导致裸块挂在页面底部） */
.sch-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--kb-space-5);
  background: color-mix(in srgb, var(--kb-foreground) 45%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* 居中卡片弹窗（与「生成计划」弹窗同款视觉） */
.sch-modal {
  width: 100%;
  max-width: 520px;
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
  padding: var(--kb-space-3) var(--kb-space-4);
  border-bottom: 1px solid var(--kb-border);
}
.sch-modal-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sch-modal-title {
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--kb-foreground);
}
.sch-modal-body {
  padding: var(--kb-space-3) var(--kb-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--kb-space-3);
  max-height: 64vh;
  overflow-y: auto;
}

/* 关闭按钮 */
.qcm-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.qcm-close:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

.sch-eyebrow {
  margin-bottom: 4px;
}

/* 保存为模板 */
.sch-save {
  padding: 12px 14px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
}
.sch-save-row {
  display: flex;
  gap: 8px;
}
.sch-save-row .kb-input {
  flex: 1;
}
.sch-save-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}

/* 模板列表 */
.sch-tpl-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sch-tpl-card {
  padding: 12px 14px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
}
.sch-tpl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.sch-tpl-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.sch-tpl-tasks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sch-tpl-task {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--kb-foreground);
}
.sch-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--kb-muted-foreground);
  flex: none;
}
.sch-tpl-task-content {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.sch-tpl-task-repeat {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
  padding: 1px 7px;
  border-radius: 999px;
}
.sch-tpl-task-empty {
  color: var(--kb-muted-foreground);
}

/* 入场淡入（与 index.vue 的生成弹窗同源，但必须在本组件内定义，scoped 不泄漏） */
.sch-fade-enter-active,
.sch-fade-leave-active {
  transition: opacity 0.18s ease;
}
.sch-fade-enter-from,
.sch-fade-leave-to {
  opacity: 0;
}
</style>
