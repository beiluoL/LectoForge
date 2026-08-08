<template>
  <div class="il">
    <!-- ============ 工具条：智能过滤 + 多选开关 ============ -->
    <div class="il-toolbar">
      <div class="il-filters" role="tablist" aria-label="智能过滤">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          role="tab"
          class="il-filter"
          :class="{ 'is-active': filter === f.key }"
          :aria-selected="filter === f.key"
          :title="f.hint"
          @click="onFilter(f.key)"
        >
          <Icon :name="f.icon" :size="12" />
          {{ f.label }}
        </button>
      </div>

      <button
        type="button"
        class="kb-btn kb-btn-sm il-batch-toggle"
        :class="{ 'is-on': isBatchMode }"
        :title="isBatchMode ? '退出多选模式' : '进入多选模式，可批量归档 / 删除 / 沉淀'"
        @click="store.toggleBatchMode()"
      >
        <Icon :name="isBatchMode ? 'x' : 'list-checks'" :size="12" />
        {{ isBatchMode ? '退出多选' : '多选' }}
      </button>
    </div>

    <!-- ============ 批量工具栏（吸顶） ============ -->
    <Transition name="il-bar">
      <div v-if="isBatchMode" class="il-batchbar">
        <label class="il-check-all">
          <input
            type="checkbox"
            :checked="isAllSelected"
            :indeterminate.prop="selectedCount > 0 && !isAllSelected"
            @change="store.toggleSelectAll()"
          />
          <span>全选</span>
        </label>

        <span class="il-selected">
          已选 <strong>{{ selectedCount }}</strong> / {{ items.length }} 条
        </span>

        <div class="il-batch-actions">
          <button
            type="button"
            class="kb-btn kb-btn-sm kb-btn-primary"
            :disabled="!selectedCount || batchBusy"
            title="为每条收集项生成一篇康奈尔笔记，原条目自动归档"
            @click="runBatch('cornell')"
          >
            <Icon name="notebook-pen" :size="12" />
            批量沉淀
          </button>
          <button
            type="button"
            class="kb-btn kb-btn-sm"
            :disabled="!selectedCount || batchBusy"
            @click="runBatch('archive')"
          >
            <Icon name="archive" :size="12" />
            批量归档
          </button>
          <button
            type="button"
            class="kb-btn kb-btn-sm kb-btn-danger"
            :disabled="!selectedCount || batchBusy"
            @click="runBatch('delete')"
          >
            <Icon name="trash-2" :size="12" />
            批量删除
          </button>
        </div>
      </div>
    </Transition>

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

    <!-- 空状态：文案随过滤维度变化，避免"明明有条目却说收集箱是空的"的困惑 -->
    <div v-else-if="!items.length" class="wb-empty">
      <div class="wb-empty-icon">
        <Icon name="inbox" :size="30" />
      </div>
      <h3 class="wb-empty-title">{{ emptyTitle }}</h3>
      <p class="wb-empty-desc">{{ emptyDesc }}</p>
      <button v-if="filter !== 'all'" class="kb-btn kb-btn-sm" style="margin-top: 12px" @click="onFilter('all')">
        <Icon name="rotate-ccw" :size="12" />
        查看全部
      </button>
    </div>

    <!-- 卡片流 -->
    <TransitionGroup v-else name="il-flow" tag="div" class="il-cards">
      <article
        v-for="item in items"
        :key="item.id"
        :data-inbox-id="item.id"
        class="il-card"
        :class="[`is-${item.type}`, { 'is-batch': isBatchMode, 'is-picked': selectedIds.has(item.id) }]"
        @click="isBatchMode && store.toggleSelect(item.id)"
      >
        <!-- 多选勾选框：只在多选模式下占位，避免平时把卡片挤窄 -->
        <label v-if="isBatchMode" class="il-pick" @click.stop>
          <input
            type="checkbox"
            :checked="selectedIds.has(item.id)"
            @change="store.toggleSelect(item.id)"
          />
        </label>

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

          <!-- 语音灵感：卡片内直接可听，不必点进详情 -->
          <audio
            v-if="item.type === 'audio' && mediaUrl(item)"
            class="il-audio"
            controls
            preload="none"
            :src="mediaUrl(item)!"
            @click.stop
          ></audio>

          <!-- 图片附件：缩略图预览 -->
          <img
            v-else-if="item.type === 'image' && mediaUrl(item)"
            class="il-thumb"
            :src="mediaUrl(item)!"
            :alt="item.title"
            loading="lazy"
          />

          <footer class="il-foot">
            <div class="il-tags">
              <span v-for="t in item.tags" :key="t" class="il-tag">#{{ t }}</span>
            </div>

            <!-- 多选模式下隐藏单条动作区：避免误触，动作统一交给顶部批量工具栏 -->
            <div v-if="!isBatchMode" class="il-actions">
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
                  <button class="il-menu-item" @click="openPalacePicker(item)">
                    <Icon name="map-pin" :size="14" />
                    <span>
                      <strong>沉淀到记忆宫殿</strong>
                      <em>挂靠到某个宫殿的位点</em>
                    </span>
                  </button>
                  <button class="il-menu-item" @click="doProcess(item, 'story')">
                    <Icon name="wand-2" :size="14" />
                    <span>
                      <strong>沉淀为费曼故事</strong>
                      <em>生成草稿，用故事讲明白</em>
                    </span>
                  </button>
                </div>

                <!-- 记忆宫殿选择器：选宫殿 → 选/建位点 -->
                <div v-if="palacePickerId === item.id" class="il-menu il-palace" @click.stop>
                  <div class="il-palace-head">
                    <span>选择记忆宫殿</span>
                    <button class="il-palace-back" title="返回" @click="palacePickerId = null">✕</button>
                  </div>
                  <div v-if="palaceLoading" class="il-palace-loading">
                    <span class="qc-spinner"></span> 加载宫殿…
                  </div>
                  <template v-else>
                    <button
                      v-for="p in palaces"
                      :key="p.id"
                      class="il-menu-item"
                      :class="{ 'is-active': pickedPalaceId === p.id }"
                      @click="pickPalace(p.id)"
                    >
                      <Icon name="map" :size="14" />
                      <span>
                        <strong>{{ p.name }}</strong>
                        <em>{{ p.loci?.length || 0 }} 个位点</em>
                      </span>
                    </button>
                    <p v-if="!palaces.length" class="il-palace-empty">还没有记忆宫殿，请先去「记忆宫殿」创建一个。</p>
                  </template>

                  <div v-if="pickedPalaceId" class="il-palace-loci">
                    <div class="il-palace-sub">选择目标位点（或新建）：</div>
                    <button
                      v-for="l in currentLoci"
                      :key="l.id"
                      class="il-loci-item"
                      :class="{ 'is-active': pickedLociId === l.id }"
                      @click="pickedLociId = pickedLociId === l.id ? null : l.id"
                    >
                      {{ l.name }}
                    </button>
                    <button class="il-loci-new" @click="pickedLociId = null">＋ 新建位点（用本条标题）</button>
                    <button
                      class="kb-btn kb-btn-primary kb-btn-sm il-palace-go"
                      :disabled="busyId === item.id"
                      @click="confirmPalace(item)"
                    >
                      <Icon name="rocket" :size="12" /> 沉淀到该宫殿
                    </button>
                  </div>
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
 *
 * 进阶能力：
 * - 智能过滤：全部 / 今天 / 本周 / 未打标签，走服务端过滤（store.setFilter → 重新拉列表），
 *   不在前端 filter 数组，否则「今天」这类维度在分页/大数据量下会失真。
 * - 多选批量：进入多选模式后隐藏单条动作区，统一由吸顶工具栏执行归档 / 删除 / 沉淀康奈尔。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useInboxStore } from '@/store/inbox-store';
import { notify, getApiError, confirmDialog } from '@/utils/toast';
import { fromNow, formatDateTime } from '@/utils/time';
import { apiGet } from '@/api/request';
import type { BatchTarget, InboxFilter, InboxItem, InboxType, ProcessTarget } from '@/api/inbox';

interface LocusVO {
  id: number;
  name: string;
}
interface PalaceVO {
  id: number;
  name: string;
  loci?: LocusVO[];
}

const props = defineProps<{
  items: InboxItem[];
  loading: boolean;
}>();

const router = useRouter();
const store = useInboxStore();
const { filter, isBatchMode, selectedIds, selectedCount, isAllSelected } = storeToRefs(store);

/** 智能过滤维度定义（服务端过滤，key 与后端 ?filter= 参数一一对应） */
const FILTERS: Array<{ key: InboxFilter; label: string; icon: string; hint: string }> = [
  { key: 'all', label: '全部', icon: 'layers', hint: '所有未处理条目' },
  { key: 'today', label: '今天', icon: 'sun', hint: '今天 00:00 之后收集的' },
  { key: 'week', label: '本周', icon: 'calendar-days', hint: '最近 7 天收集的' },
  { key: 'untagged', label: '未打标签', icon: 'tag', hint: '还没有任何标签，最容易变成僵尸条目' },
];

/** 批量操作进行中（禁用工具栏按钮，防连点） */
const batchBusy = ref(false);

const emptyTitle = computed(() => {
  if (filter.value === 'today') return '今天还没有新收集';
  if (filter.value === 'week') return '最近 7 天没有新收集';
  if (filter.value === 'untagged') return '没有未打标签的条目';
  return '收集箱是空的';
});
const emptyDesc = computed(() => {
  if (filter.value === 'untagged') return '很好——每条收集都有标签，检索和沉淀都会轻松很多。';
  if (filter.value !== 'all') return '换个时间范围看看，或者现在就记一条。';
  return '在上面记下一个念头，或粘贴网址自动剪藏 —— 先积累，再沉淀。';
});

/** 切换过滤维度：交给 store 走服务端重新拉取 */
async function onFilter(next: InboxFilter) {
  try {
    await store.setFilter(next);
  } catch (e) {
    notify(getApiError(e, '过滤失败'), 'error');
  }
}

/** 批量执行：删除需二次确认，成功后按目标给不同文案 */
async function runBatch(target: BatchTarget) {
  const count = selectedCount.value;
  if (!count) return;
  if (target === 'delete') {
    const ok = await confirmDialog(`确定删除选中的 ${count} 条吗？将统一移入回收站。`);
    if (!ok) return;
  }
  batchBusy.value = true;
  try {
    const res = await store.batchRun(target);
    const skipped = res.skipped?.length ? `，${res.skipped.length} 条被跳过` : '';
    if (target === 'cornell') {
      notify(`已沉淀 ${res.processed} 条为康奈尔笔记${skipped}`, 'success');
      // 只沉淀了一条时直接跳进去继续写，符合"沉淀即开始整理"的直觉
      if (res.processed === 1 && res.noteIds?.[0]) router.push(`/workbench/notes/${res.noteIds[0]}`);
    } else if (target === 'archive') {
      notify(`已归档 ${res.processed} 条${skipped}`, 'success');
    } else {
      notify(`已移入回收站 ${res.processed} 条${skipped}`, 'success');
    }
    // 处理完若列表已空，自动退出多选模式，省一次点击
    if (!props.items.length) store.setBatchMode(false);
  } catch (e) {
    notify(getApiError(e, '批量操作失败'), 'error');
  } finally {
    batchBusy.value = false;
  }
}

/** 当前展开沉淀菜单的卡片 id */
const openMenuId = ref<number | null>(null);
/** 正在执行写操作的卡片 id，用于禁用该卡的按钮 */
const busyId = ref<number | null>(null);

/** ===== 记忆宫殿选择器状态 ===== */
const palacePickerId = ref<number | null>(null);
const palaces = ref<PalaceVO[]>([]);
const palaceLoading = ref(false);
const pickedPalaceId = ref<number | null>(null);
const pickedLociId = ref<number | null>(null);

/** 当前选中宫殿下的位点列表 */
const currentLoci = computed<LocusVO[]>(
  () => palaces.value.find((p) => p.id === pickedPalaceId.value)?.loci ?? [],
);

function typeIcon(t: InboxType): string {
  if (t === 'link') return 'link';
  if (t === 'image') return 'image';
  if (t === 'audio') return 'mic';
  if (t === 'file') return 'paperclip';
  return 'pen-line';
}

function typeLabel(t: InboxType): string {
  if (t === 'link') return '网页剪藏';
  if (t === 'image') return '图片';
  if (t === 'audio') return '语音灵感';
  if (t === 'file') return '附件';
  return '速记';
}

/**
 * 从条目里取出第一个上传资产地址。
 * 富媒体没有独立字段，落在 content 的 Markdown 里（`![](/uploads/...)` 或 `[](/uploads/...)`），
 * 剪藏类则可能在 sourceUrl。这里统一按 `/uploads/...` 前缀捞第一个。
 */
function mediaUrl(item: InboxItem): string | null {
  if (item.sourceUrl?.startsWith('/uploads/')) return item.sourceUrl;
  const m = (item.content || '').match(/\/uploads\/[A-Za-z0-9._\-/]+/);
  return m ? m[0] : null;
}

/** 正文预览：去掉与标题重复的首行、剔除附件 Markdown，压缩空白，截断到 140 字 */
function preview(item: InboxItem): string {
  // 附件的 Markdown 链接对预览毫无信息量，先摘掉，否则一行全是 /uploads/xxx.webm
  const raw = (item.content || '')
    .replace(/!?\[[^\]]*\]\((\/uploads\/[^)]*)\)/g, '')
    .trim();
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
  palacePickerId.value = null;
  busyId.value = item.id;
  try {
    if (target === 'palace') {
      const res = await store.process(item.id, 'palace', {
        palaceId: pickedPalaceId.value!,
        lociId: pickedLociId.value ?? undefined,
      });
      notify(`已沉淀到记忆宫殿：${res.title}`, 'success');
      if (res.palaceId) router.push(`/workbench/palace/${res.palaceId}`);
      return;
    }
    if (target === 'story') {
      const res = await store.process(item.id, 'story');
      notify(`已生成费曼故事草稿：${res.title}`, 'success');
      if (res.storyId) router.push(`/workbench/story/${res.storyId}`);
      return;
    }
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
    pickedPalaceId.value = null;
    pickedLociId.value = null;
  }
}

/** 打开记忆宫殿选择器：拉取宫殿列表（含位点） */
async function openPalacePicker(item: InboxItem) {
  openMenuId.value = item.id;
  palacePickerId.value = item.id;
  pickedPalaceId.value = null;
  pickedLociId.value = null;
  if (palaces.value.length || palaceLoading.value) return;
  palaceLoading.value = true;
  try {
    palaces.value = await apiGet<PalaceVO[]>('/workbench/palaces');
  } catch {
    palaces.value = [];
  } finally {
    palaceLoading.value = false;
  }
}

function pickPalace(id: number) {
  pickedPalaceId.value = id;
  pickedLociId.value = null;
}

/** 从宫殿选择器确认沉淀（按钮在模板里复用 doProcess(target='palace')） */
async function confirmPalace(item: InboxItem) {
  if (!pickedPalaceId.value) {
    notify('请先选择一个记忆宫殿', 'error');
    return;
  }
  await doProcess(item, 'palace');
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

/* ===== 工具条：智能过滤 + 多选开关 ===== */
.il-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.il-filters {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--kb-muted);
  border: 1px solid var(--kb-border);
}
.il-filter {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--kb-muted-foreground);
  font-family: inherit;
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}
.il-filter:hover {
  color: var(--kb-foreground);
}
.il-filter.is-active {
  background: var(--kb-card);
  color: var(--mc, var(--kb-primary));
  font-weight: 600;
  box-shadow: var(--shadow-card);
}
.il-batch-toggle.is-on {
  border-color: var(--mc, var(--kb-primary));
  color: var(--mc, var(--kb-primary));
  background: color-mix(in srgb, var(--mc, var(--kb-primary)) 10%, transparent);
}

/* ===== 批量工具栏（吸顶，滚动时始终可达） ===== */
.il-batchbar {
  position: sticky;
  top: 8px;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding: 10px 14px;
  border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--mc, var(--kb-primary)) 7%, var(--kb-card));
  border: 1px solid color-mix(in srgb, var(--mc, var(--kb-primary)) 32%, var(--kb-border));
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}
.il-check-all {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  color: var(--kb-foreground);
  cursor: pointer;
  user-select: none;
}
.il-check-all input,
.il-pick input {
  width: 15px;
  height: 15px;
  accent-color: var(--mc, var(--kb-primary));
  cursor: pointer;
}
.il-selected {
  font-size: var(--kb-fs-body-sm);
  color: var(--kb-muted-foreground);
}
.il-selected strong {
  font-family: var(--font-mono);
  font-size: 15px;
  color: var(--mc, var(--kb-primary));
  font-variant-numeric: tabular-nums;
}
.il-batch-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;
}
.il-bar-enter-active,
.il-bar-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.il-bar-enter-from,
.il-bar-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ===== 卡片上的勾选框 ===== */
.il-pick {
  display: flex;
  align-items: flex-start;
  padding-top: 9px;
  cursor: pointer;
}
.il-card.is-batch {
  cursor: pointer;
}
.il-card.is-picked {
  border-color: var(--mc, var(--kb-primary));
  background: color-mix(in srgb, var(--mc, var(--kb-primary)) 5%, var(--kb-card));
}
/* 去重提醒「查看原条目」定位到的卡片闪一下（由 QuickCapture 动态加类） */
.il-card.is-flash {
  animation: il-flash 1.6s ease;
}
@keyframes il-flash {
  0%, 100% { box-shadow: var(--shadow-card); }
  25%, 60% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--kb-highlight) 45%, transparent);
    border-color: var(--kb-highlight);
  }
}

/* ===== 富媒体预览 ===== */
.il-audio {
  width: 100%;
  max-width: 380px;
  height: 34px;
  margin-top: 2px;
}
.il-thumb {
  max-width: 220px;
  max-height: 130px;
  margin-top: 2px;
  border-radius: var(--kb-radius-sm);
  border: 1px solid var(--kb-border);
  object-fit: cover;
}
.is-audio .il-icon {
  background: color-mix(in srgb, var(--kb-destructive) 9%, transparent);
  color: var(--kb-destructive);
}
.is-file .il-icon {
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
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

/* ===== 记忆宫殿选择器 ===== */
.il-palace {
  width: 264px;
}
.il-palace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 8px;
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  color: var(--kb-foreground);
  border-bottom: 1px solid var(--kb-border);
}
.il-palace-back {
  border: none;
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: 14px;
  cursor: pointer;
  line-height: 1;
}
.il-palace-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 10px;
  font-size: var(--kb-fs-body-sm);
  color: var(--kb-muted-foreground);
}
.il-palace-empty {
  margin: 0;
  padding: 12px 10px;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  line-height: 1.5;
}
.il-palace-loci {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--kb-border);
}
.il-palace-sub {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  padding: 4px 8px;
}
.il-loci-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  margin-top: 3px;
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-sm);
  background: var(--kb-card);
  color: var(--kb-foreground);
  font-family: inherit;
  font-size: var(--kb-fs-body-sm);
  cursor: pointer;
  transition: all 0.14s ease;
}
.il-loci-item:hover {
  border-color: color-mix(in srgb, var(--kb-primary) 45%, var(--kb-border));
}
.il-loci-item.is-active {
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
  border-color: var(--kb-primary);
  color: var(--kb-primary);
  font-weight: 600;
}
.il-loci-new {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  margin-top: 3px;
  border: 1px dashed var(--kb-border);
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  font-family: inherit;
  font-size: var(--kb-fs-body-sm);
  cursor: pointer;
  transition: all 0.14s ease;
}
.il-loci-new:hover {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
}
.il-palace-go {
  width: 100%;
  margin-top: 10px;
  justify-content: center;
}
.qc-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--kb-muted-foreground) 40%, transparent);
  border-top-color: var(--kb-primary);
  border-radius: 50%;
  animation: qc-rotate 0.7s linear infinite;
}
@keyframes qc-rotate {
  to { transform: rotate(360deg); }
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
