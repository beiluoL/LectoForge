<template>
  <!-- 待复习清单抽屉：Teleport 到 body，避开刷题页的 3D transform 上下文。
       ⚠️ FlashCard 用了 perspective / preserve-3d，任何在其祖先链里的 fixed 元素
       都会被当成 3D 子层渲染，导致抽屉跟着卡片一起旋转飞出。必须 Teleport。 -->
  <Teleport to="body">
    <Transition name="rql-fade">
      <div v-if="visible" class="rql-mask" @click.self="close">
        <Transition name="rql-slide" appear>
          <aside v-if="visible" class="rql-panel" role="dialog" aria-label="待复习卡片清单">
            <!-- 头部 -->
            <header class="rql-head">
              <div class="rql-head-main">
                <h3 class="rql-title">
                  <Icon name="layers" :size="16" />
                  待复习清单
                </h3>
                <p class="rql-sub">
                  <template v-if="pendingLoading">正在加载…</template>
                  <template v-else-if="list.length === 0">当前没有到期卡片</template>
                  <template v-else>
                    共 <b>{{ list.length }}</b> 张
                    <span v-if="counts.new" class="rql-dot rql-dot--new">新 {{ counts.new }}</span>
                    <span v-if="counts.review" class="rql-dot rql-dot--review">复习 {{ counts.review }}</span>
                    <span v-if="counts.risk" class="rql-dot rql-dot--risk">易忘 {{ counts.risk }}</span>
                  </template>
                </p>
              </div>
              <button class="rql-icon-btn" title="关闭" @click="close">
                <Icon name="x" :size="18" />
              </button>
            </header>

            <!-- 筛选条 -->
            <div v-if="list.length > 0" class="rql-filters">
              <button
                v-for="f in filters"
                :key="f.key"
                class="rql-chip"
                :class="{ 'is-on': activeFilter === f.key }"
                @click="activeFilter = f.key"
              >
                {{ f.label }}
                <span class="rql-chip-num">{{ f.count }}</span>
              </button>
            </div>

            <!-- 列表主体 -->
            <div class="rql-body">
              <div v-if="pendingLoading" class="rql-state">
                <Icon name="loader-2" :size="20" class="rql-spin" />
                <span>加载中…</span>
              </div>

              <div v-else-if="visibleList.length === 0" class="rql-state">
                <Icon name="check-circle-2" :size="26" class="rql-state-ic" />
                <p class="rql-state-title">
                  {{ list.length === 0 ? '全部复习完啦' : '该分类下没有卡片' }}
                </p>
                <p class="rql-state-desc">
                  {{ list.length === 0 ? '保持节奏，明天再来' : '换个筛选条件试试' }}
                </p>
              </div>

              <ul v-else class="rql-list">
                <li
                  v-for="card in visibleList"
                  :key="`${card.sourceType}-${card.id}`"
                  class="rql-item"
                  :class="{ 'is-busy': busyKey === keyOf(card) }"
                >
                  <!-- 主体：点击 → 跳转刷题页并把这张顶到队首 -->
                  <button class="rql-item-main" @click="goReview(card)">
                    <div class="rql-item-top">
                      <span class="rql-badge" :class="badgeOf(card).cls">{{ badgeOf(card).text }}</span>
                      <span class="rql-src">{{ card.sourceType === 'note' ? '康奈尔笔记' : '记忆宫殿' }}</span>
                    </div>
                    <p class="rql-front">{{ card.front || '（无标题）' }}</p>
                    <p class="rql-meta">
                      <Icon name="clock" :size="11" />
                      {{ dueLabel(card.dueDate) }}
                      <span class="rql-meta-sep">·</span>
                      熟练度 {{ card.masteredLevel }}/5
                      <template v-if="card.imageHint">
                        <span class="rql-meta-sep">·</span>
                        <Icon name="sparkles" :size="11" /> 已有口诀
                      </template>
                    </p>
                  </button>

                  <!-- 挂起 24h -->
                  <button
                    class="rql-snooze"
                    :disabled="busyKey === keyOf(card)"
                    title="挂起 24 小时"
                    @click.stop="onSnooze(card)"
                  >
                    <Icon :name="busyKey === keyOf(card) ? 'loader-2' : 'pause'" :size="14"
                          :class="busyKey === keyOf(card) ? 'rql-spin' : ''" />
                    <span>挂起</span>
                  </button>
                </li>
              </ul>
            </div>

            <!-- 底部操作 -->
            <footer class="rql-foot">
              <button class="kb-btn rql-foot-btn" :disabled="pendingLoading" @click="refresh">
                <Icon name="refresh-cw" :size="14" />
                刷新
              </button>
              <button
                class="kb-btn kb-btn-primary rql-foot-btn"
                :disabled="list.length === 0"
                @click="startAll"
              >
                <Icon name="play" :size="14" />
                开始复习
              </button>
            </footer>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 待复习卡片清单（抽屉）。
 *
 * 设计要点：
 * 1. 数据源是 store.pendingList（`GET /reviews/due?limit=100`），**独立于刷题队列 queue**。
 *    清单要看全量，队列只装当前批 20 张；共用一个数组会导致关掉抽屉后队列被撑大。
 * 2. 挂起走 store.snoozeCard(silentToast)，成功后本地摘除，不整表重拉——
 *    100 张的列表重拉一次视觉上会整体闪一下，体验很差。
 * 3. 点击卡片 → promoteCard 顶到队首 + router.push('/review')，
 *    用户看到的第一张就是他点的那张。
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useReviewStore } from '@/store/review-store';
import { confirmDialog } from '@/utils/toast';
import type { ReviewCard } from '@/api/review';

const props = defineProps<{ modelValue?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const router = useRouter();
const store = useReviewStore();
const { pendingList, pendingLoading, queueListVisible } = storeToRefs(store);

/**
 * 双模式开关：既支持 v-model（父组件受控），也支持不传 prop 时回落到
 * store.queueListVisible（顶栏 / 驾驶舱 / 刷题页三处共用同一个抽屉实例）。
 */
const visible = computed(() =>
  props.modelValue === undefined ? queueListVisible.value : props.modelValue,
);

const list = computed<ReviewCard[]>(() => pendingList.value);
const busyKey = ref('');

type FilterKey = 'all' | 'new' | 'review' | 'risk';
const activeFilter = ref<FilterKey>('all');

function keyOf(c: ReviewCard): string {
  return `${c.sourceType}:${c.id}`;
}

/** 卡型判定：与 FlashCard.vue 的徽章逻辑保持一致（易忘 > 新卡 > 复习卡） */
function badgeOf(c: ReviewCard) {
  if (c.lapseCount > 2) return { text: '⚠️ 易忘卡', cls: 'rql-badge--risk', key: 'risk' as const };
  if (c.repetitions === 0) return { text: '💡 新卡', cls: 'rql-badge--new', key: 'new' as const };
  return { text: '🔄 复习卡', cls: 'rql-badge--review', key: 'review' as const };
}

const counts = computed(() => {
  const r = { new: 0, review: 0, risk: 0 };
  for (const c of list.value) r[badgeOf(c).key] += 1;
  return r;
});

const filters = computed(() => [
  { key: 'all' as const, label: '全部', count: list.value.length },
  { key: 'new' as const, label: '新卡', count: counts.value.new },
  { key: 'review' as const, label: '复习卡', count: counts.value.review },
  { key: 'risk' as const, label: '易忘卡', count: counts.value.risk },
]);

const visibleList = computed(() =>
  activeFilter.value === 'all'
    ? list.value
    : list.value.filter((c) => badgeOf(c).key === activeFilter.value),
);

/** 到期时间人话化：负数表示已逾期 */
function dueLabel(iso: string): string {
  if (!iso) return '待安排';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '待安排';
  const diffDay = Math.floor((Date.now() - t) / 86400000);
  if (diffDay <= 0) return '今天到期';
  if (diffDay === 1) return '逾期 1 天';
  if (diffDay < 365) return `逾期 ${diffDay} 天`;
  return '很久没复习';
}

function close(): void {
  if (props.modelValue === undefined) store.closeQueueList();
  else emit('update:modelValue', false);
}

function refresh(): void {
  void store.loadPendingList();
}

async function onSnooze(card: ReviewCard): Promise<void> {
  const ok = await confirmDialog(
    `挂起「${(card.front || '未命名卡片').slice(0, 30)}」？该卡将在 24 小时后重新出现在待复习列表中。`,
  );
  if (!ok) return;
  busyKey.value = keyOf(card);
  try {
    await store.snoozeCard(card.id, card.sourceType, true);
  } finally {
    busyKey.value = '';
  }
}

function goReview(card: ReviewCard): void {
  store.promoteCard(card);
  close();
  void router.push('/review');
}

function startAll(): void {
  close();
  void router.push('/review');
}

// 抽屉打开时若还没有数据就拉一次（父组件用 v-model 直接打开的场景）
watch(visible, (v) => {
  if (v && list.value.length === 0 && !pendingLoading.value) store.loadPendingList();
  if (!v) activeFilter.value = 'all';
});
</script>

<style scoped>
.rql-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--kb-foreground) 28%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.rql-panel {
  width: min(420px, 92vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--kb-card) 92%, transparent);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border-left: 1px solid var(--kb-border);
  box-shadow: -18px 0 48px -24px rgba(0, 0, 0, 0.35);
}

/* ---------- 头部 ---------- */
.rql-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 18px 12px;
  border-bottom: 1px solid var(--kb-border);
}
.rql-head-main {
  flex: 1;
  min-width: 0;
}
.rql-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.rql-sub {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--kb-muted-foreground);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.rql-sub b {
  color: var(--kb-foreground);
}
.rql-dot {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.rql-dot--new {
  color: color-mix(in srgb, var(--kb-accent) 85%, black);
  background: color-mix(in srgb, var(--kb-accent) 16%, transparent);
}
.rql-dot--review {
  color: color-mix(in srgb, var(--kb-warning) 85%, black);
  background: color-mix(in srgb, var(--kb-warning) 18%, transparent);
}
.rql-dot--risk {
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 14%, transparent);
}
.rql-icon-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--kb-radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.rql-icon-btn:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

/* ---------- 筛选 ---------- */
.rql-filters {
  display: flex;
  gap: 6px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--kb-border);
  overflow-x: auto;
}
.rql-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--kb-border);
  background: transparent;
  font-size: 12px;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: all 0.15s;
}
.rql-chip:hover {
  border-color: var(--kb-primary);
  color: var(--kb-foreground);
}
.rql-chip.is-on {
  border-color: var(--kb-primary);
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  font-weight: 600;
}
.rql-chip-num {
  font-size: 11px;
  opacity: 0.75;
}

/* ---------- 列表 ---------- */
.rql-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
}
.rql-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rql-item {
  display: flex;
  align-items: stretch;
  gap: 8px;
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius);
  background: var(--kb-card);
  transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
}
.rql-item:hover {
  border-color: var(--kb-primary);
  box-shadow: 0 2px 10px -4px color-mix(in srgb, var(--kb-primary) 40%, transparent);
}
.rql-item.is-busy {
  opacity: 0.55;
  pointer-events: none;
}
.rql-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 12px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.rql-item-top {
  display: flex;
  align-items: center;
  gap: 7px;
}
.rql-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.rql-badge--new {
  color: color-mix(in srgb, var(--kb-accent) 85%, black);
  background: color-mix(in srgb, var(--kb-accent) 16%, transparent);
}
.rql-badge--review {
  color: color-mix(in srgb, var(--kb-warning) 85%, black);
  background: color-mix(in srgb, var(--kb-warning) 18%, transparent);
}
.rql-badge--risk {
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 14%, transparent);
}
.rql-src {
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.rql-front {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--kb-foreground);
  /* 最多两行，超出省略；长笔记线索不至于把列表撑爆 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.rql-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.rql-meta-sep {
  opacity: 0.5;
}
.rql-snooze {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 56px;
  flex-shrink: 0;
  border: none;
  border-left: 1px solid var(--kb-border);
  background: transparent;
  font-size: 11px;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  border-radius: 0 var(--kb-radius) var(--kb-radius) 0;
  transition: background 0.15s, color 0.15s;
}
.rql-snooze:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kb-warning) 12%, transparent);
  color: color-mix(in srgb, var(--kb-warning) 85%, black);
}
.rql-snooze:disabled {
  cursor: not-allowed;
}

/* ---------- 空态 / 加载 ---------- */
.rql-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 56px 20px;
  color: var(--kb-muted-foreground);
  font-size: 13px;
}
.rql-state-ic {
  color: var(--kb-accent);
}
.rql-state-title {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.rql-state-desc {
  margin: 0;
  font-size: 12px;
}
.rql-spin {
  animation: rql-rotate 0.9s linear infinite;
}
@keyframes rql-rotate {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- 底部 ---------- */
.rql-foot {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--kb-border);
}
.rql-foot-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

/* ---------- 过渡 ---------- */
.rql-fade-enter-active,
.rql-fade-leave-active {
  transition: opacity 0.2s ease;
}
.rql-fade-enter-from,
.rql-fade-leave-to {
  opacity: 0;
}
.rql-slide-enter-active,
.rql-slide-leave-active {
  transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
.rql-slide-enter-from,
.rql-slide-leave-to {
  transform: translateX(100%);
}
</style>
