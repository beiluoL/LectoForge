<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">通知中心</h2>
    </header>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="bell" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">提醒类型</h3>
          <p class="kb-set-card-desc">开启后，到达设定时间会推送本地通知。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>复习到期提醒</span>
          <span class="kb-setting-desc">SM-2 排程到期时提醒</span>
        </div>
        <div class="kb-setting-control">
          <input type="time" v-model="prefs.notifications.review.time" class="kb-input" style="max-width: 140px;" />
          <label class="kb-switch" :class="{ 'is-on': prefs.notifications.review.enabled }">
            <input type="checkbox" v-model="prefs.notifications.review.enabled" />
          </label>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>任务今日到期</span>
          <span class="kb-setting-desc">当天待办集中提醒</span>
        </div>
        <div class="kb-setting-control">
          <input type="time" v-model="prefs.notifications.task.time" class="kb-input" style="max-width: 140px;" />
          <label class="kb-switch" :class="{ 'is-on': prefs.notifications.task.enabled }">
            <input type="checkbox" v-model="prefs.notifications.task.enabled" />
          </label>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>习惯未打卡</span>
          <span class="kb-setting-desc">每日习惯提醒</span>
        </div>
        <div class="kb-setting-control">
          <input type="time" v-model="prefs.notifications.habit.time" class="kb-input" style="max-width: 140px;" />
          <label class="kb-switch" :class="{ 'is-on': prefs.notifications.habit.enabled }">
            <input type="checkbox" v-model="prefs.notifications.habit.enabled" />
          </label>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>日程临近提醒</span>
          <span class="kb-setting-desc">提前若干分钟提醒</span>
        </div>
        <div class="kb-setting-control">
          <input type="number" min="0" max="120" v-model.number="prefs.notifications.calendar.minutesBefore" class="kb-input" style="max-width: 96px;" />
          <span class="kb-setting-desc">分钟前</span>
          <label class="kb-switch" :class="{ 'is-on': prefs.notifications.calendar.enabled }">
            <input type="checkbox" v-model="prefs.notifications.calendar.enabled" />
          </label>
        </div>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="moon-star" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">勿扰时段</h3>
          <p class="kb-set-card-desc">时段内的提醒延迟到结束后合并推送。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>启用勿扰</span>
          <span class="kb-setting-desc">{{ prefs.notifications.dnd.from }} 至 {{ prefs.notifications.dnd.to }}</span>
        </div>
        <div class="kb-setting-control">
          <input type="time" v-model="prefs.notifications.dnd.from" class="kb-input" style="max-width: 120px;" />
          <span class="kb-setting-desc">至</span>
          <input type="time" v-model="prefs.notifications.dnd.to" class="kb-input" style="max-width: 120px;" />
          <label class="kb-switch" :class="{ 'is-on': prefs.notifications.dnd.enabled }">
            <input type="checkbox" v-model="prefs.notifications.dnd.enabled" />
          </label>
        </div>
      </div>
    </section>

    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="eye" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">通知预览</h3>
          <p class="kb-set-card-desc">实际推送的样式示意。</p>
        </div>
      </div>
      <div class="kb-notify-preview">
        <div class="kb-notify-item"><Icon name="book-open" :size="16" /><div><b>复习到期</b> · Java 并发 3 张</div></div>
        <div class="kb-notify-item"><Icon name="check" :size="16" /><div><b>习惯未打卡</b> · 阅读 30 分钟</div></div>
        <div class="kb-notify-item"><Icon name="calendar-clock" :size="16" /><div><b>日程临近</b> · 团队周会 15 分钟后</div></div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { usePrefsStore } from '@/store/prefs-store'

const prefs = usePrefsStore()
</script>

<style scoped>
.kb-notify-preview { display: flex; flex-direction: column; gap: .5rem; }
.kb-notify-item { display: flex; align-items: center; gap: .55rem; padding: .55rem .7rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-muted); font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); }
.kb-notify-item :deep(svg) { color: var(--kb-primary); flex-shrink: 0; }
</style>
