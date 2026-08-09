<template>
  <Teleport to="body">
    <Transition name="lf-fade">
      <div v-if="open" class="fixed inset-0 z-[1000] flex" :style="{ background: 'rgba(0,0,0,0.4)' }" @click.self="close">
        <!-- 右侧抽屉 -->
        <aside
          class="ml-auto w-full max-w-sm h-full border-l shadow-2xl flex flex-col"
          :style="{ background: 'var(--kb-card)', borderColor: 'var(--kb-border)', color: 'var(--kb-foreground)' }"
        >
          <header class="flex items-center justify-between p-4 border-b" :style="{ borderColor: 'var(--kb-border)' }">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-3 h-3 rounded-full shrink-0" :style="{ background: event?.color }"></span>
              <h2 class="font-semibold truncate">{{ event?.title }}</h2>
            </div>
            <button type="button" class="wb-icon-btn" @click="close">
              <Icon name="x" size="md" />
            </button>
          </header>

          <div v-if="event" class="flex-1 overflow-y-auto p-4 space-y-4">
            <!-- 时间 -->
            <div class="flex items-start gap-2">
              <Icon name="clock" size="md" class="mt-0.5 shrink-0" :style="{ color: 'var(--kb-muted-foreground)' }" />
              <div class="text-sm">
                <div v-if="event.isAllDay" class="font-medium">全天</div>
                <div v-else class="font-medium">{{ formatScheduleTime(event.startTime) }} – {{ formatScheduleTime(event.endTime || event.startTime) }}</div>
                <div class="text-xs mt-0.5" :style="{ color: 'var(--kb-muted-foreground)' }">
                  {{ event.isAllDay ? allDayRange : `${formatDateTime(event.startTime)} ~ ${formatDateTime(event.endTime || event.startTime)}` }}
                </div>
              </div>
            </div>

            <!-- 地点 -->
            <div v-if="event.location" class="flex items-start gap-2">
              <Icon name="map-pin" size="md" class="mt-0.5 shrink-0" :style="{ color: 'var(--kb-muted-foreground)' }" />
              <div class="text-sm">{{ event.location }}</div>
            </div>

            <!-- 描述 -->
            <div v-if="event.description" class="flex items-start gap-2">
              <Icon name="align-left" size="md" class="mt-0.5 shrink-0" :style="{ color: 'var(--kb-muted-foreground)' }" />
              <p class="text-sm whitespace-pre-wrap leading-relaxed">{{ event.description }}</p>
            </div>
          </div>

          <footer class="flex items-center justify-end gap-2 p-4 border-t" :style="{ borderColor: 'var(--kb-border)' }">
            <button type="button" class="kb-btn kb-btn-danger" @click="onDelete">删除</button>
            <button type="button" class="kb-btn kb-btn-primary" @click="onEdit">编辑</button>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// 事件详情抽屉（右侧滑出，Teleport + Transition）。
// 只读展示 + 「编辑 / 删除」两个操作：编辑把事件抛给 index 打开 AddEventModal，
// 删除先 confirm 再走 store.deleteEvent（store 内部乐观摘除 + 失败回滚）。
import { computed } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { useCalendarStore } from '@/store/calendar-store';
import { formatScheduleTime, formatDateTime } from '@/lib/date';
import { confirmDialog } from '@/utils/toast';
import type { CalendarEvent } from '@/api/calendar';

const props = defineProps<{
  open: boolean;
  event: CalendarEvent | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'edit', ev: CalendarEvent): void;
  (e: 'deleted'): void;
}>();

const store = useCalendarStore();

const allDayRange = computed(() => {
  const ev = props.event;
  if (!ev) return '';
  const s = formatDateTime(ev.startTime);
  const e = ev.endTime ? ' ~ ' + formatDateTime(ev.endTime) : '';
  return `${s}${e}`;
});

function close() {
  emit('close');
}

function onEdit() {
  if (props.event) emit('edit', props.event);
}

async function onDelete() {
  if (!props.event) return;
  const ok = await confirmDialog(`确定删除「${props.event.title}」吗？`);
  if (!ok) return;
  const success = await store.deleteEvent(props.event.id);
  if (success) {
    emit('deleted');
    close();
  }
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
</style>
