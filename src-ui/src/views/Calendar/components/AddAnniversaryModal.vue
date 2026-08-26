<template>
  <Teleport to="body">
    <Transition name="lf-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-[1000] flex items-center justify-center p-4"
        :style="{ background: 'rgba(0,0,0,0.45)' }"
        @click.self="close"
      >
        <div
          class="w-full max-w-[420px] rounded-xl border p-5 shadow-2xl"
          :style="{ background: 'var(--kb-card)', borderColor: 'var(--kb-border)', color: 'var(--kb-foreground)' }"
        >
          <!-- 标题 -->
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold">
              {{ isEdit ? '编辑纪念日' : '💖 新建纪念日' }}
            </h2>
            <button type="button" class="wb-icon-btn" @click="close">
              <Icon name="x" size="md" />
            </button>
          </div>

          <form class="space-y-4" @submit.prevent="save">
            <!-- 名称 -->
            <div>
              <label class="lf-field-label">名称</label>
              <input
                v-model.trim="form.name"
                class="kb-input w-full"
                placeholder="例如：小明的生日 / 结婚纪念日"
                required
              />
            </div>

            <!-- 重复规则 -->
            <div>
              <label class="lf-field-label">重复规则</label>
              <div class="lf-rule-tabs">
                <button
                  type="button"
                  class="lf-rule-tab"
                  :class="form.repeatRule === 'yearly' ? 'is-active' : ''"
                  @click="form.repeatRule = 'yearly'"
                >
                  <Icon name="calendar-heart" size="sm" />
                  每年
                </button>
                <button
                  type="button"
                  class="lf-rule-tab"
                  :class="form.repeatRule === 'monthly' ? 'is-active' : ''"
                  @click="form.repeatRule = 'monthly'"
                >
                  <Icon name="calendar-repeat" size="sm" />
                  每月
                </button>
              </div>
            </div>

            <!-- 日期：触发式按钮 + 定制月/日选择弹层 -->
            <div>
              <label class="lf-field-label">
                {{ form.repeatRule === 'yearly' ? '日期（每年）' : '日期（每月，仅日）' }}
              </label>
              <button
                type="button"
                class="lf-date-trigger"
                @click="openDatePicker($event.currentTarget as HTMLElement)"
              >
                <Icon :name="form.repeatRule === 'yearly' ? 'calendar-heart' : 'calendar-repeat'" size="md" class="lf-date-trigger-icon" />
                <span class="lf-date-trigger-text">{{ dateLabel }}</span>
                <Icon name="chevron-down" size="sm" class="lf-date-trigger-chevron" />
              </button>
            </div>

            <!-- 起始年份（可选） -->
            <div>
              <label class="lf-field-label">起始年份（可选）</label>
              <input
                v-model.number="form.year"
                type="number"
                min="1900"
                max="2100"
                class="kb-input w-full"
                placeholder="留空 = 不限年份"
              />
              <p class="lf-field-hint">设置后仅该年及之后的年份显示（例如出生年）。</p>
            </div>

            <!-- 图标选择（可选） -->
            <div>
              <label class="lf-field-label">图标</label>
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  v-for="ic in ICON_CHOICES"
                  :key="ic.value"
                  type="button"
                  class="lf-icon-chip"
                  :class="{ 'is-active': form.iconName === ic.value }"
                  :title="ic.label"
                  @click="form.iconName = ic.value"
                >
                  <Icon :name="ic.value" size="sm" />
                </button>
              </div>
            </div>

            <!-- 备注 -->
            <div>
              <label class="lf-field-label">备注（可选）</label>
              <textarea v-model.trim="form.note" class="kb-input w-full" rows="2" placeholder="可选"></textarea>
            </div>

            <!-- 操作 -->
            <div class="flex items-center justify-end gap-2 pt-1">
              <button type="button" class="kb-btn" @click="close">取消</button>
              <button type="submit" class="kb-btn kb-btn-primary" :disabled="saving">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 月/日选择弹层（Teleport 到 body，fixed 定位） -->
  <Teleport to="body">
    <Transition name="lf-pop">
      <div
        v-if="dateOpen"
        ref="popEl"
        class="lf-date-pop"
        :style="{ position: 'fixed', zIndex: 1100, left: popLeft + 'px', top: popTop + 'px' }"
      >
        <!-- 月选择：12 个快捷 chip -->
        <div class="lf-date-quick">
          <button
            v-for="m in 12"
            :key="m"
            type="button"
            class="lf-date-quick-chip"
            :class="{ 'is-today': form.month === m }"
            @click="form.month = m"
          >
            {{ m }}月
          </button>
        </div>

        <!-- 日选择：按当前月天数生成格子（yearly）；monthly 只选日数字 1~31 -->
        <template v-if="form.repeatRule === 'yearly'">
          <div class="lf-date-month">
            <span class="lf-date-month-title">{{ form.month }}月</span>
          </div>
          <div class="lf-date-week">
            <span v-for="w in WEEK_LABELS" :key="w" class="lf-date-week-cell">{{ w }}</span>
          </div>
          <div class="lf-date-grid">
            <button
              v-for="cell in yearCells"
              :key="cell.key"
              type="button"
              class="lf-date-cell"
              :class="{ 'is-muted': !cell.inMonth, 'is-selected': cell.isSelected, 'is-today': cell.isToday }"
              @click="pickDay(cell.day)"
            >
              {{ cell.day }}
            </button>
          </div>
        </template>
        <template v-else>
          <div class="lf-date-month">
            <span class="lf-date-month-title">每月 {{ form.day }} 日</span>
          </div>
          <div class="lf-date-grid lf-date-grid-days">
            <button
              v-for="d in 31"
              :key="d"
              type="button"
              class="lf-date-cell"
              :class="{ 'is-selected': form.day === d }"
              @click="pickDay(d)"
            >
              {{ d }}
            </button>
          </div>
        </template>

        <div class="lf-date-actions">
          <button type="button" class="kb-btn kb-btn-sm" @click="dateOpen = false">取消</button>
          <button type="button" class="kb-btn kb-btn-sm kb-btn-primary" @click="confirmDate">完成</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// 新建 / 编辑纪念日弹窗（Teleport 到 body + Transition 淡入）。
// - 数据契约：仅前端视图层，store.addAnniversary / editAnniversary 落后端 wb_anniversary；
// - 日期选择：定制「月 + 日」双级选择（yearly），或「仅日」选择（monthly），
//   完全复用 AddEventModal 的触发式按钮 + Teleport 弹层交互范式；
// - 视觉：全 --kb-* token，浅色/深色随 data-theme 自动切换，无硬编码色值。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { useCalendarStore } from '@/store/calendar-store';
import { notify } from '@/utils/toast';
import type { Anniversary, CreateAnniversaryInput } from '@/api/calendar';

const props = defineProps<{
  open: boolean;
  /** 编辑目标；为空表示新建 */
  anniversary?: Anniversary | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved'): void;
}>();

const store = useCalendarStore();

const isEdit = computed(() => !!props.anniversary);

/** 可选图标（lucide 合法名） */
const ICON_CHOICES = [
  { value: 'heart', label: '爱心' },
  { value: 'cake', label: '蛋糕' },
  { value: 'gift', label: '礼物' },
  { value: 'sparkles', label: '星光' },
  { value: 'party-popper', label: '庆祝' },
  { value: 'star', label: '星星' },
] as const;

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const saving = ref(false);

interface AnniversaryForm {
  name: string;
  iconName: string;
  /** yearly → 1~12；monthly 忽略 */
  month: number;
  /** 日（1~31） */
  day: number;
  year: number | null;
  repeatRule: 'yearly' | 'monthly';
  note: string;
}
const form = ref<AnniversaryForm>({
  name: '',
  iconName: 'heart',
  month: new Date().getMonth() + 1,
  day: new Date().getDate(),
  year: null,
  repeatRule: 'yearly',
  note: '',
});

/** open / anniversary 变化时初始化表单 */
watch(
  () => [props.open, props.anniversary],
  () => {
    if (!props.open) return;
    closeDatePicker();
    if (props.anniversary) {
      const a = props.anniversary;
      const [m, d] = a.repeatRule === 'yearly' ? a.date.split('-').map(Number) : [null, Number(a.date)];
      form.value = {
        name: a.name,
        iconName: a.iconName,
        month: m ?? 1,
        day: d,
        year: a.year,
        repeatRule: a.repeatRule,
        note: a.note ?? '',
      };
    } else {
      form.value = {
        name: '',
        iconName: 'heart',
        month: new Date().getMonth() + 1,
        day: new Date().getDate(),
        year: null,
        repeatRule: 'yearly',
        note: '',
      };
    }
  },
  { immediate: true },
);

/* ==================== 月/日选择弹层 ==================== */
const dateOpen = ref(false);
const popEl = ref<HTMLElement | null>(null);
const popLeft = ref(0);
const popTop = ref(0);

/** 展示文案：每年 → M月D日；每月 → 每月D日 */
const dateLabel = computed(() => {
  if (form.value.repeatRule === 'yearly') return `${form.value.month}月${form.value.day}日`;
  return `每月 ${form.value.day} 日`;
});

/** yearly 模式的日网格（以当前月填充，42 格） */
interface DayCellData {
  day: number;
  key: string;
  inMonth: boolean;
  isSelected: boolean;
  isToday: boolean;
}
const yearCells = computed<DayCellData[]>(() => {
  const y = new Date().getFullYear();
  const m = form.value.month - 1;
  const first = new Date(y, m, 1);
  const startWeekday = first.getDay(); // 周日=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const today = new Date();
  const out: DayCellData[] = [];
  for (let i = 0; i < 42; i++) {
    let day: number;
    let inMonth: boolean;
    if (i < startWeekday) {
      day = prevDays - startWeekday + i + 1;
      inMonth = false;
    } else if (i < startWeekday + daysInMonth) {
      day = i - startWeekday + 1;
      inMonth = true;
    } else {
      day = i - startWeekday - daysInMonth + 1;
      inMonth = false;
    }
    out.push({
      day,
      key: `${m + 1}-${day}`,
      inMonth,
      isSelected: inMonth && day === form.value.day,
      isToday: inMonth && day === today.getDate() && m === today.getMonth(),
    });
  }
  return out;
});

async function openDatePicker(anchor: HTMLElement) {
  dateOpen.value = true;
  await nextTick();
  positionFrom(anchor);
}

function positionFrom(anchor: HTMLElement) {
  const pop = popEl.value;
  if (!pop) return;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const margin = 8;
  let left = r.left;
  if (left + pw > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - pw - margin);
  let top = r.bottom + margin;
  if (top + ph > window.innerHeight - margin) top = Math.max(margin, r.top - ph - margin);
  popLeft.value = Math.round(left);
  popTop.value = Math.round(top);
}

function repositionPop() {
  if (!dateOpen.value) return;
  const pop = popEl.value;
  if (!pop) return;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  popLeft.value = Math.min(popLeft.value, Math.max(8, window.innerWidth - pw - 8));
  popTop.value = Math.min(popTop.value, Math.max(8, window.innerHeight - ph - 8));
}

onMounted(() => window.addEventListener('resize', repositionPop));
onUnmounted(() => window.removeEventListener('resize', repositionPop));

function pickDay(day: number) {
  form.value.day = day;
  // yearly 选中后保留面板等「完成」；monthly 同理（面板顶部实时显示「每月 X 日」）
}

function confirmDate() {
  dateOpen.value = false;
}

function closeDatePicker() {
  dateOpen.value = false;
}

/* ==================== 保存 ==================== */
function buildPayload(): CreateAnniversaryInput {
  const date = form.value.repeatRule === 'yearly'
    ? `${String(form.value.month).padStart(2, '0')}-${String(form.value.day).padStart(2, '0')}`
    : String(form.value.day);
  return {
    name: form.value.name,
    iconName: form.value.iconName,
    date,
    year: form.value.year,
    repeatRule: form.value.repeatRule,
    note: form.value.note || null,
  };
}

async function save() {
  if (!form.value.name.trim()) return;
  saving.value = true;
  try {
    const payload = buildPayload();
    if (isEdit.value && props.anniversary) {
      await store.editAnniversary(props.anniversary.id, payload);
    } else {
      await store.addAnniversary(payload);
    }
    emit('saved');
    close();
  } finally {
    saving.value = false;
  }
}

function close() {
  emit('close');
}
</script>

<style scoped>
.lf-fade-enter-active,
.lf-fade-leave-active {
  transition: opacity 0.18s ease;
}
.lf-fade-enter-from,
.lf-fade-leave-to {
  opacity: 0;
}
.lf-pop-enter-active,
.lf-pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.lf-pop-enter-from,
.lf-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.lf-field-label {
  display: block;
  margin-bottom: 8px;
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  color: var(--kb-foreground);
}
.lf-field-hint {
  margin-top: 6px;
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
}

/* 重复规则分段控件 */
.lf-rule-tabs {
  display: flex;
  gap: 8px;
}
.lf-rule-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
  padding: 8px 0;
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-md);
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.lf-rule-tab:hover {
  background: var(--kb-muted);
}
.lf-rule-tab.is-active {
  border-color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  color: var(--kb-primary);
  font-weight: 600;
}

/* 触发式按钮（与 AddEventModal 同款） */
.lf-date-trigger {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border: 1px solid transparent;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-muted);
  color: var(--kb-foreground);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.lf-date-trigger:hover {
  background: var(--kb-hover-bg);
}
.lf-date-trigger:focus-visible {
  outline: none;
  border-color: var(--kb-ring);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--kb-ring) 20%, transparent);
}
.lf-date-trigger-icon {
  flex-shrink: 0;
  color: var(--kb-primary);
}
.lf-date-trigger-text {
  flex: 1;
  min-width: 0;
  font-size: var(--kb-fs-body-md);
  font-weight: 500;
  color: var(--kb-foreground);
}
.lf-date-trigger-chevron {
  flex-shrink: 0;
  color: var(--kb-muted-foreground);
}

/* 图标选择 chips */
.lf-icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-md);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.lf-icon-chip:hover {
  background: var(--kb-muted);
}
.lf-icon-chip.is-active {
  border-color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  color: var(--kb-primary);
}

/* 弹层（与 AddEventModal 同款视觉） */
.lf-date-pop {
  width: 320px;
  padding: 16px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-popover);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  user-select: none;
  -webkit-user-select: none;
}
.lf-date-quick {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
  margin-bottom: 12px;
}
.lf-date-quick-chip {
  padding: 5px 0;
  border: none;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-foreground);
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.lf-date-quick-chip:hover {
  background: var(--kb-hover-bg);
}
.lf-date-quick-chip.is-today {
  background: color-mix(in srgb, var(--kb-primary) 14%, transparent);
  color: var(--kb-primary);
  font-weight: 600;
}
.lf-date-month {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}
.lf-date-month-title {
  font-size: var(--kb-fs-body-md);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--kb-foreground);
}
.lf-date-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 4px;
}
.lf-date-week-cell {
  text-align: center;
  font-size: var(--kb-fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--kb-muted-foreground);
  padding: 4px 0;
}
.lf-date-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
/* monthly：仅日数字，7 列 × 5 行（31 天） */
.lf-date-grid-days {
  grid-template-columns: repeat(7, 1fr);
}
.lf-date-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--kb-foreground);
  font-size: var(--kb-fs-body-sm);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.lf-date-cell:hover {
  background: var(--kb-muted);
}
.lf-date-cell.is-muted {
  color: var(--kb-muted-foreground);
}
.lf-date-cell.is-today {
  box-shadow: inset 0 0 0 1px var(--kb-ring);
}
.lf-date-cell.is-selected {
  background: var(--kb-primary);
  color: var(--kb-primary-foreground);
  font-weight: 600;
}
.lf-date-cell.is-selected.is-today {
  box-shadow: inset 0 0 0 2px var(--kb-primary-foreground);
}
.lf-date-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
