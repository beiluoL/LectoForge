<template>
  <div class="il">
    <!-- 加载骨架 -->
    <div v-if="loading" class="il-skels">
      <div v-for="i in 3" :key="i" class="il-card il-skel">
        <div class="wb-skeleton">
          <div class="wb-skel-line" style="height: 14px; width: 42%"></div>
          <div class="wb-skel-line" style="height: 12px; width: 88%; margin-top: 10px"></div>
          <div class="wb-skel-line" style="height: 12px; width: 64%; margin-top: 6px"></div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!items.length" class="wb-empty">
      <div class="wb-empty-icon">
        <Icon name="inbox" :size="30" />
      </div>
      <h3 class="wb-empty-title">收集箱是空的</h3>
      <p class="wb-empty-desc">
        在上面记下一个念头，或粘贴网址自动剪藏 —— 先积累，再沉淀。
      </p>
    </div>

    <!-- 卡片流 -->
    <TransitionGroup v-else name="il-flow" tag="div" class="il-cards">
      <article v-for="item in items" :key="item.id" class="il-card" :class="`is-${item.type}`">
        <!-- 类型图标 -->
        <div class="il-icon" :title="typeLabel(item.type)">
          <Icon :name="typeIcon(item.type)" :size="16" />
        </div>

        <div class="il-main">
          <header class="il-head">
            <h3 class="il-title">
              <a
                v-if="item.sourceUrl"
                :href="item.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="il-title-link"
                :title="item.sourceUrl"
              >
                {{ item.title }}
                <Icon name="external-link" :size="12" class="il-title-ext" />
              </a>
              <template v-else>{{ item.title }}</template>
            </h3>
            <time class="il-time" :title="formatDateTime(item.createdAt)">
              {{ fromNow(item.createdAt) }}
            </time>
          </header>

          <p v-if="preview(item)" class="il-preview">{{ preview(item) }}</p>

          <footer class="il-foot">
            <div class="il-tags">
              <span v-for="t in item.tags" :key="t" class="il-tag">#{{ t }}</span>
            </div>

            <div class="il-actions">
              <!-- 沉淀（带下拉：普通文档 / 康奈尔笔记） -->
              <div class="il-drop" :class="{ 'is-open': openMenuId === item.id }">
                <button
                  class="kb-btn kb-btn-sm kb-btn-primary il-btn-flow"
                  :disabled="busyId === item.id"
                  @click.stop="toggleMenu(item.id)"
                >
                  <Icon name="rocket" :size="12" />
                  沉淀
                  <Icon name="chevron-down" :size="11" class="il-caret" />
                </button>
                <div v-if="openMenuId === item.id" class="il-menu" @click.stop>
                  <button class="il-menu-item" @click="doProcess(item, 'note')">
                    <Icon name="file-text" :size="14" />
                    <span>
                      <strong>沉淀为文档</strong>
                      <em>写入文档库，成为一篇 Markdown</em>
                    </span>
                  </button>
                  <button class="il-menu-item" @click="doProcess(item, 'cornell')">
                    <Icon name="notebook-pen" :size="14" />
                    <span>
                      <strong>沉淀为康奈尔笔记</strong>
                      <em>建卡片，进入复习闭环</em>
                    </span>
                  </button>
                </div>
              </div>

              <button
                class="kb-btn kb-btn-sm"
                :disabled="busyId === item.id"
                title="归档：不沉淀，直接收走"
                @click="doArchive(item)"
              >
                <Icon name="archive" :size="12" /> 归档
              </button>

              <button
                class="kb-btn kb-btn-sm kb-btn-danger"
                :disabled="busyId === item.id"
                title="删除到回收站"
                @click="doDelete(item)"
              >
                <Icon name="trash-2" :size="12" />
              </button>
            </div>
          </footer>
        </div>
      </article>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
/**
 * 收集箱卡片流。
 *
 * 每张卡三个动作：沉淀（下拉选目标）/ 归档 / 删除。
 * 三者都会让卡片离开「未处理」列表，store 用乐观更新先摘掉卡片、失败再插回原位，
 * 所以这里不需要手动 reload。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '@/components/ui/Icon.vue';
import { useInboxStore } from '@/stores/inboxStore';
import { notify, getApiError, confirmDialog } from '@/utils/toast';
import { fromNow, formatDateTime } from '@/utils/time';
import type { InboxItem, InboxType, ProcessTarget } from '@/api/inbox';

defineProps<{
  items: InboxItem[];
  loading: boolean;
}>();

const router = useRouter();
const store = useInboxStore();

/** 当前展开沉淀菜单的卡片 id */
const openMenuId = ref<number | null>(null);
/** 正在执行写操作的卡片 id，用于禁用该卡的按钮 */
const busyId = ref<number | null>(null);

function typeIcon(t: InboxType): string {
  if (t === 'link') return 'link';
  if (t === 'image') return 'image';
  return 'pen-line';
}

function typeLabel(t: InboxType): string {
  if (t === 'link') return '网页剪藏';
  if (t === 'image') return '图片';
  return '速记';
}

/** 正文预览：去掉与标题重复的首行，压缩空白，截断到 140 字 */
function preview(item: InboxItem): string {
  const raw = (item.content || '').trim();
  if (!raw) return '';
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length && lines[0] === item.title.trim()) lines.shift();
  const body = lines.join(' ').replace(/\s+/g, ' ');
  return body.length > 140 ? `${body.slice(0, 140)}…` : body;
}

function toggleMenu(id: number) {
  openMenuId.value = openMenuId.value === id ? null : id;
}

function closeMenu() {
  openMenuId.value = null;
}

// 点击空白处 / 按 Esc 收起下拉
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu();
}
onMounted(() => {
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', onEsc);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenu);
  document.removeEventListener('keydown', onEsc);
});

/** 沉淀：成功后给一条带「去看看」语义的提示，并跳到下游 */
async function doProcess(item: InboxItem, target: ProcessTarget) {
  closeMenu();
  busyId.value = item.id;
  try {
    const res = await store.process(item.id, target);
    if (target === 'cornell' && res.noteId) {
      notify(`已沉淀为康奈尔笔记：${res.title}`, 'success');
      router.push(`/workbench/notes/${res.noteId}`);
    } else {
      notify(`已沉淀到文档库：${res.title}`, 'success');
      router.push('/library');
    }
  } catch (e) {
    notify(getApiError(e, '沉淀失败，请重试'), 'error');
  } finally {
    busyId.value = null;
  }
}

async function doArchive(item: InboxItem) {
  busyId.value = item.id;
  try {
    await store.archive(item.id);
    notify('已归档', 'success');
  } catch (e) {
    notify(getApiError(e, '归档失败'), 'error');
  } finally {
    busyId.value = null;
  }
}

async function doDelete(item: InboxItem) {
  const ok = await confirmDialog(`确定删除「${item.title}」吗？将移入回收站。`);
  if (!ok) return;
  busyId.value = item.id;
  try {
    await store.remove(item.id);
    notify('已移入回收站', 'success');
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error');
  } finally {
    busyId.value = null;
  }
}
</script>

<style scoped>
.il-cards,
.il-skels {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== 卡片 ===== */
.il-card {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}
.il-card:hover {
  box-shadow: var(--shadow-card-hover);
  border-color: color-mix(in srgb, var(--mc, var(--kb-primary)) 35%, var(--kb-border));
}
.il-skel { cursor: default; }
.il-skel:hover { box-shadow: var(--shadow-card); border-color: var(--kb-border); }

/* 类型图标：不同类型用不同色调区分，但不喧宾夺主 */
.il-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: var(--kb-radius-sm);
  background: color-mix(in srgb, var(--kb-primary) 8%, transparent);
  color: var(--kb-primary);
}
.is-link .il-icon {
  background: color-mix(in srgb, var(--kb-accent) 10%, transparent);
  color: var(--kb-accent);
}
.is-image .il-icon {
  background: var(--kb-highlight-soft);
  color: var(--kb-highlight);
}

.il-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.il-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.il-title {
  margin: 0;
  min-width: 0;
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--kb-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}
.il-title-link {
  color: inherit;
  text-decoration: none;
  transition: color 0.15s ease;
}
.il-title-link:hover {
  color: var(--kb-primary);
}
.il-title-ext {
  display: inline-block;
  vertical-align: baseline;
  margin-left: 3px;
  opacity: 0.55;
}
.il-time {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  white-space: nowrap;
}

.il-preview {
  margin: 0;
  font-size: var(--kb-fs-body-sm);
  line-height: 1.65;
  color: var(--kb-muted-foreground);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.il-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.il-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.il-tag {
  font-size: var(--kb-fs-xs);
  font-weight: 500;
  color: var(--kb-muted-foreground);
  background: var(--kb-muted);
  padding: 2px 8px;
  border-radius: 999px;
}

/* ===== 操作区 ===== */
.il-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  /* 默认低调，hover 卡片时才完全显现，减少卡片流的视觉噪音 */
  opacity: 0.75;
  transition: opacity 0.18s ease;
}
.il-card:hover .il-actions,
.il-drop.is-open .il-actions {
  opacity: 1;
}
.il-btn-flow {
  gap: 4px;
}
.il-caret {
  opacity: 0.8;
  transition: transform 0.15s ease;
}
.il-drop.is-open .il-caret {
  transform: rotate(180deg);
}

.il-drop {
  position: relative;
}
.il-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 20;
  width: 246px;
  padding: 4px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-popover);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  animation: il-pop 0.14s ease;
}
@keyframes il-pop {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.il-menu-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-foreground);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease;
}
.il-menu-item:hover {
  background: var(--kb-muted);
}
.il-menu-item > span {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.il-menu-item strong {
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
}
.il-menu-item em {
  font-style: normal;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  line-height: 1.4;
}

/* ===== 列表进出场：沉淀/归档/删除时卡片平滑滑出 ===== */
.il-flow-enter-active,
.il-flow-leave-active {
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.il-flow-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
.il-flow-leave-to {
  opacity: 0;
  transform: translateX(28px);
}
.il-flow-leave-active {
  position: absolute;
  width: 100%;
}
.il-flow-move {
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

@media (max-width: 720px) {
  .il-actions { opacity: 1; }
  .il-menu { width: 208px; }
}
</style>
