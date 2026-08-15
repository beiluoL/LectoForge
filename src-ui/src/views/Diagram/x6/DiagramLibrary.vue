<template>
  <div class="x6-lib" :style="{ width: width + 'px' }">
    <div class="x6-lib-head">
      <input
        class="x6-lib-search"
        type="text"
        placeholder="搜索形状…"
        v-model="query"
      />
    </div>

    <div class="x6-lib-body">
      <div v-for="grp in filteredGroups" :key="grp.id" class="x6-lib-group">
        <button class="x6-lib-group-head" @click="toggle(grp.id)">
          <span class="x6-lib-caret" :class="{ open: !collapsed.has(grp.id) }">▸</span>
          <span>{{ grp.name }}</span>
          <span class="x6-lib-count">{{ grp.shapes.length }}</span>
        </button>

        <div v-show="!collapsed.has(grp.id)" class="x6-lib-grid">
          <button
            v-for="s in grp.shapes"
            :key="s.type"
            class="x6-lib-item"
            :title="s.label"
            @mousedown="startDrag(s, $event)"
            @touchstart.prevent="startDrag(s, $event)"
          >
            <span class="x6-lib-thumb" v-html="thumbHtml(s)"></span>
            <span class="x6-lib-label">{{ s.label }}</span>
          </button>
        </div>

        <!-- UML 分组下额外渲染关系边工具（点两节点连边） -->
        <div v-if="grp.id === 'uml' && !collapsed.has(grp.id)" class="x6-lib-grid x6-lib-edges">
          <button
            v-for="r in umlRelations"
            :key="r.type"
            class="x6-lib-item x6-lib-edge"
            :title="`${r.label}：点源节点再点目标节点`"
            @click="armEdge(r.type)"
          >
            <span class="x6-lib-thumb" v-html="edgeThumbHtml(r.type)"></span>
            <span class="x6-lib-label">{{ r.label }}</span>
          </button>
        </div>
      </div>

      <p v-if="!filteredGroups.length" class="x6-lib-empty">无匹配形状</p>
    </div>

    <!-- 右侧拖拽改变面板宽度（200~420） -->
    <div class="x6-lib-resizer" @mousedown.prevent="startResize"></div>
  </div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B 分组图形库面板（P2-T1.1）。
 * - 6 个分组（基础/流程图·BPMN/UML/ER/AWS/网络）手风琴展开折叠；
 * - 顶部搜索跨分组过滤，命中分组自动展开；
 * - 节点形状：mousedown/touchstart 经 x6-plugin-dnd 拖入画布落点；
 * - UML 关系边：点击「武装」，由 playground 监听两次 node:click 连边；
 * - 右侧可拖拽改面板宽度（200~420px）。
 */
import { ref, computed, inject } from 'vue'
import { Dnd } from '@antv/x6-plugin-dnd'
import { X6_CTX_KEY, type X6Context } from './context'
import {
  SHAPE_GROUPS,
  SHAPE_BY_TYPE,
  UML_RELATIONS,
  type ShapeDef,
  type UmlRelationType,
} from '../shapeDefs'

const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{ (e: 'arm-edge', relation: UmlRelationType): void }>()

const ctx = inject(X6_CTX_KEY) as X6Context
const query = ref('')
const collapsed = ref<Set<string>>(new Set())
const width = ref(240)
const umlRelations = UML_RELATIONS

const filteredGroups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return SHAPE_GROUPS.map((g) => ({
    ...g,
    shapes: g.shapes.map((t) => SHAPE_BY_TYPE[t]).filter(Boolean).filter((s) => !q || s.label.toLowerCase().includes(q)),
  })).filter((g) => g.shapes.length > 0)
})

function toggle(id: string) {
  const s = new Set(collapsed.value)
  s.has(id) ? s.delete(id) : s.add(id)
  collapsed.value = s
}

function ensureDnd(): Dnd | null {
  const g = ctx.graph.value
  if (!g) return null
  return new Dnd({ target: g, scaled: false })
}

function startDrag(def: ShapeDef, evt: MouseEvent | TouchEvent) {
  const dnd = ensureDnd()
  const g = ctx.graph.value
  if (!dnd || !g) return
  const isAws = def.render === 'awsBadge'
  const meta: any = {
    shape: `diagram-${def.type}`,
    width: def.defaultWidth,
    height: def.defaultHeight,
    attrs: {
      body: isAws
        ? { fill: '#FFF1DD', stroke: '#FF9900' }
        : { fill: '#FFFFFF', stroke: '#475569' },
      label: { text: def.defaultText },
      ...(isAws ? { badge: { text: def.badge || def.label } } : {}),
    },
    data: { label: def.defaultText, capsule: !!def.capsule, render: def.render },
  }
  dnd.start(meta, evt as any)
}

function armEdge(relation: UmlRelationType) {
  emit('arm-edge', relation)
}

// ===== 缩略图：用简化 SVG 还原各 render 外形（仅轮廓，节点尺寸无关） =====
function thumbHtml(def: ShapeDef): string {
  const w = 46
  const h = 34
  const stroke = '#475569'
  const fill = def.render === 'awsBadge' ? '#FFF1DD' : '#FFFFFF'
  const s = def.render
  let inner = ''
  if (['rect', 'rounded', 'card', 'predefined', 'doubleRect', 'device', 'document'].includes(s)) {
    inner = `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="${s === 'rounded' || s === 'device' ? 8 : 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['stadium', 'start', 'end'].includes(s) || def.capsule) {
    inner = `<rect x="3" y="6" width="${w - 6}" height="${h - 12}" rx="${(h - 12) / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['ellipse', 'usecase', 'doubleEllipse', 'underlineEllipse', 'attribute', 'multiAttr', 'keyAttr'].includes(s)) {
    inner = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 4}" ry="${h / 2 - 4}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['diamond', 'relation', 'decision'].includes(s)) {
    inner = `<polygon points="${w / 2},3 ${w - 3},${h / 2} ${w / 2},${h - 3} 3,${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['doubleDiamond', 'weakRelation'].includes(s)) {
    inner = `<polygon points="${w / 2},3 ${w - 3},${h / 2} ${w / 2},${h - 3} 3,${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><polygon points="${w / 2},9 ${w - 9},${h / 2} ${w / 2},${h - 9} 9,${h / 2}" fill="none" stroke="${stroke}" stroke-width="1"/>`
  } else if (['hexagon', 'preparation'].includes(s)) {
    inner = `<polygon points="${w * 0.18},3 ${w * 0.82},3 ${w - 3},${h / 2} ${w * 0.82},${h - 3} ${w * 0.18},${h - 3} 3,${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['triangle'].includes(s)) {
    inner = `<polygon points="${w / 2},3 ${w - 3},${h - 3} 3,${h - 3}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['parallelogram', 'io'].includes(s)) {
    inner = `<polygon points="${w * 0.2},3 ${w - 3},3 ${w * 0.8},${h - 3} 3,${h - 3}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['trapezoid', 'storedData'].includes(s)) {
    inner = `<polygon points="${w * 0.15},3 ${w * 0.85},3 ${w - 3},${h - 3} 3,${h - 3}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['pentagon', 'pageRef', 'offpage'].includes(s)) {
    inner = `<polygon points="${w / 2},3 ${w - 3},${h * 0.35} ${w * 0.82},${h - 3} ${w * 0.18},${h - 3} 3,${h * 0.35}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['hourglass', 'delay'].includes(s)) {
    inner = `<polygon points="3,3 ${w - 3},3 ${w / 2},${h / 2} ${w - 3},${h - 3} 3,${h - 3} ${w / 2},${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['cylinder', 'disk', 'database', 'server', 'storage'].includes(s)) {
    inner = `<rect x="3" y="8" width="${w - 6}" height="${h - 14}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><ellipse cx="${w / 2}" cy="8" rx="${w / 2 - 3}" ry="5" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['actor', 'user'].includes(s)) {
    inner = `<ellipse cx="${w / 2}" cy="10" rx="7" ry="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><line x1="${w / 2}" y1="16" x2="${w / 2}" y2="24" stroke="${stroke}" stroke-width="1.5"/><line x1="14" y1="19" x2="${w - 14}" y2="19" stroke="${stroke}" stroke-width="1.5"/><line x1="${w / 2}" y1="24" x2="16" y2="${h - 3}" stroke="${stroke}" stroke-width="1.5"/><line x1="${w / 2}" y1="24" x2="${w - 16}" y2="${h - 3}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['cloud'].includes(s)) {
    inner = `<ellipse cx="${w / 2}" cy="${h / 2 + 4}" rx="${w / 2 - 4}" ry="${h / 2 - 8}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><ellipse cx="16" cy="12" rx="9" ry="7" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><ellipse cx="${w - 16}" cy="12" rx="10" ry="7" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (['note', 'annotation'].includes(s)) {
    inner = `<polygon points="3,3 ${w - 11},3 ${w - 3},12 ${w - 3},${h - 3} 3,${h - 3}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  } else if (def.render === 'awsBadge') {
    inner = `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="8" fill="#FFF1DD" stroke="#FF9900" stroke-width="1.5"/><text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#FF9900">${def.badge || ''}</text>`
  } else if (['router'].includes(s)) {
    inner = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 5}" ry="${h / 2 - 5}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><line x1="10" y1="${h / 2 - 3}" x2="${w - 10}" y2="${h / 2 - 3}" stroke="${stroke}" stroke-width="1.2"/><line x1="10" y1="${h / 2 + 3}" x2="${w - 10}" y2="${h / 2 + 3}" stroke="${stroke}" stroke-width="1.2"/>`
  } else if (['switch', 'loadbalancer'].includes(s)) {
    inner = `<rect x="5" y="6" width="${w - 10}" height="${h - 12}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><line x1="12" y1="13" x2="${w - 12}" y2="13" stroke="${stroke}" stroke-width="1.2"/><line x1="12" y1="21" x2="${w - 12}" y2="21" stroke="${stroke}" stroke-width="1.2"/>`
  } else if (['firewall'].includes(s)) {
    inner = `<rect x="4" y="8" width="${w - 8}" height="${h - 14}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><polyline points="4,8 10,13 16,8 22,13 28,8 34,13 42,8" fill="none" stroke="${stroke}" stroke-width="1.2"/>`
  } else if (['envelope', 'mail'].includes(s)) {
    inner = `<rect x="4" y="7" width="${w - 8}" height="${h - 13}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><path d="M4 7 L${w / 2} 17 L${w - 4} 7" fill="none" stroke="${stroke}" stroke-width="1.2"/>`
  } else {
    inner = `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="46" height="34" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
}

function edgeThumbHtml(type: UmlRelationType): string {
  const w = 46
  const h = 34
  const dashed = type === 'realization' || type === 'dependency' ? ' stroke-dasharray="4 3"' : ''
  const marker = type === 'generalization' || type === 'realization'
    ? '<polygon points="44,17 36,12 36,22" fill="#fff" stroke="#475569" stroke-width="1"/>'
    : type === 'aggregation' || type === 'composition'
      ? `<polygon points="44,17 36,12 36,22" fill="${type === 'composition' ? '#475569' : '#fff'}" stroke="#475569" stroke-width="1"/>`
      : '<polygon points="44,17 36,12 36,22" fill="#475569"/>'
  return `<svg viewBox="0 0 ${w} ${h}" width="46" height="34" xmlns="http://www.w3.org/2000/svg"><line x1="4" y1="17" x2="38" y2="17" stroke="#475569" stroke-width="1.5"${dashed}/>${marker}</svg>`
}

// ===== 面板宽度拖拽（200~420） =====
function startResize(e: MouseEvent) {
  const startX = e.clientX
  const startW = width.value
  const move = (ev: MouseEvent) => {
    width.value = Math.min(420, Math.max(200, startW + (startX - ev.clientX)))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
</script>

<style scoped>
.x6-lib {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--kb-border, #e2e8f0);
  background: var(--kb-card, #fff);
  min-height: 0;
}
.x6-lib-head {
  padding: 8px;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
}
.x6-lib-search {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  font-size: 12px;
}
.x6-lib-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 0 12px;
}
.x6-lib-group-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--kb-foreground, #0f172a);
  cursor: pointer;
}
.x6-lib-caret {
  transition: transform 0.15s ease;
  font-size: 10px;
  color: var(--kb-muted-foreground, #64748b);
}
.x6-lib-caret.open {
  transform: rotate(90deg);
}
.x6-lib-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
  font-weight: 400;
}
.x6-lib-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 0 10px 8px;
}
.x6-lib-edges {
  padding-top: 4px;
  border-top: 1px dashed var(--kb-border, #e2e8f0);
}
.x6-lib-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  border: 1px solid var(--kb-border, #e2e8f0);
  border-radius: 8px;
  background: var(--kb-background, #f8fafc);
  cursor: grab;
  user-select: none;
}
.x6-lib-item:hover {
  border-color: var(--kb-primary, #3b6fe0);
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 8%, transparent);
}
.x6-lib-item:active {
  cursor: grabbing;
}
.x6-lib-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
}
.x6-lib-label {
  font-size: 11px;
  color: var(--kb-foreground, #0f172a);
  text-align: center;
  line-height: 1.2;
}
.x6-lib-empty {
  padding: 16px;
  font-size: 12px;
  color: var(--kb-muted-foreground, #64748b);
  text-align: center;
}
.x6-lib-resizer {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}
.x6-lib-resizer:hover {
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 25%, transparent);
}
</style>
