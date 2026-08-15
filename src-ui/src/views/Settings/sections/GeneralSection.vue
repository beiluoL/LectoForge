<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">通用设置</h2>
    </header>

    <!-- 基础 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="sliders-horizontal" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">基础</h3>
          <p class="kb-set-card-desc">语言、网络与编辑偏好。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>语言</span>
          <span class="kb-setting-desc">界面显示语言</span>
        </div>
        <div class="kb-setting-control">
          <select v-model="prefs.locale" class="kb-select">
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>代理模式</span>
          <span class="kb-setting-desc">访问云端 AI 时的网络出口</span>
        </div>
        <div class="kb-setting-control">
          <select v-model="prefs.proxyMode" class="kb-select">
            <option value="system">系统代理</option>
            <option value="manual">手动配置</option>
            <option value="off">不使用代理</option>
          </select>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>拼写检查</span>
          <span class="kb-setting-desc">输入时高亮拼写错误</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.spellCheck }">
            <input type="checkbox" v-model="prefs.spellCheck" />
          </label>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>禁用硬件加速</span>
          <span class="kb-setting-desc">渲染异常时可尝试关闭</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.hardwareAccel }">
            <input type="checkbox" v-model="prefs.hardwareAccel" />
          </label>
        </div>
      </div>
    </section>

    <!-- 通知 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="bell" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">通知</h3>
          <p class="kb-set-card-desc">全局通知开关（具体提醒时间见「通知中心」）。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label"><span>助手消息</span></div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.notifications.review.enabled }">
            <input type="checkbox" v-model="prefs.notifications.review.enabled" />
          </label>
        </div>
      </div>
      <div class="kb-setting-row">
        <div class="kb-setting-label"><span>备份提醒</span></div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.notifications.habit.enabled }">
            <input type="checkbox" v-model="prefs.notifications.habit.enabled" />
          </label>
        </div>
      </div>
      <div class="kb-setting-row">
        <div class="kb-setting-label"><span>知识库同步提醒</span></div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.notifications.calendar.enabled }">
            <input type="checkbox" v-model="prefs.notifications.calendar.enabled" />
          </label>
        </div>
      </div>
    </section>

    <!-- 启动 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="power" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">启动</h3>
          <p class="kb-set-card-desc">登录系统与最小化行为。</p>
        </div>
      </div>

      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>开机自动启动</span>
          <span class="kb-setting-desc">随系统登录自动运行</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.autoStart }">
            <input type="checkbox" v-model="prefs.autoStart" />
          </label>
        </div>
      </div>
      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>启动时最小化到托盘</span>
          <span class="kb-setting-desc">启动后仅驻留菜单栏</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.minimizeToTray }">
            <input type="checkbox" v-model="prefs.minimizeToTray" />
          </label>
        </div>
      </div>
    </section>

    <!-- 托盘 -->
    <section class="kb-set-card">
      <div class="kb-set-card-head">
        <Icon name="panel-bottom" :size="18" class="kb-set-card-icon" />
        <div>
          <h3 class="kb-set-card-title">托盘</h3>
        </div>
      </div>
      <div class="kb-setting-row">
        <div class="kb-setting-label">
          <span>显示托盘图标</span>
          <span class="kb-setting-desc">在菜单栏常驻快速入口</span>
        </div>
        <div class="kb-setting-control">
          <label class="kb-switch" :class="{ 'is-on': prefs.showTrayIcon }">
            <input type="checkbox" v-model="prefs.showTrayIcon" />
          </label>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { usePrefsStore } from '@/store/prefs-store'

const prefs = usePrefsStore()
</script>
