<template>
  <main class="kb-set-detail">
    <component :is="current" />
  </main>
</template>

<script setup lang="ts">
import { computed, markRaw, type Component } from 'vue'
import GeneralSection from './sections/GeneralSection.vue'
import DataSection from './sections/DataSection.vue'
import AiSection from './sections/AiSection.vue'
import LocalModelSection from './sections/LocalModelSection.vue'
import AppearanceSection from './sections/AppearanceSection.vue'
import NotificationSection from './sections/NotificationSection.vue'
import ShortcutSection from './sections/ShortcutSection.vue'
import SyncSection from './sections/SyncSection.vue'
import AboutSection from './sections/AboutSection.vue'

const props = defineProps<{ section: string }>()

const map: Record<string, Component> = {
  general: markRaw(GeneralSection),
  data: markRaw(DataSection),
  ai: markRaw(AiSection),
  'local-model': markRaw(LocalModelSection),
  appearance: markRaw(AppearanceSection),
  notification: markRaw(NotificationSection),
  shortcut: markRaw(ShortcutSection),
  sync: markRaw(SyncSection),
  about: markRaw(AboutSection),
}

const current = computed<Component>(() => map[props.section] || map.general)
</script>
