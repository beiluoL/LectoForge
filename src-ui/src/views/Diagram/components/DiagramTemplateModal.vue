<template>
  <Teleport to="body">
    <div
      class="lf-tpl-mask"
      tabindex="-1"
      @click.self="close"
      @keydown.esc="close"
    >
      <div class="lf-tpl-panel" role="dialog" aria-modal="true" aria-label="模板库">
        <header class="lf-tpl-head">
          <div>
            <h3 class="lf-tpl-title">模板库</h3>
            <p class="lf-tpl-sub">选择骨架一键套用，快速开始绘制（套用会替换当前画布）</p>
          </div>
          <button class="lf-tpl-close" v-tip="'关闭'" @click="close">
            <Icon name="x" size="sm" />
          </button>
        </header>

        <div class="lf-tpl-grid">
          <button
            v-for="item in thumbs"
            :key="item.tpl.id"
            type="button"
            class="lf-tpl-card"
            v-tip="`套用：${item.tpl.name}`"
            @click="apply(item.tpl)"
          >
            <div class="lf-tpl-thumb">
              <svg :viewBox="`0 0 ${item.thumb.w} ${item.thumb.h}`" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <marker :id="`tpl-arrow-${item.tpl.id}`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
                  </marker>
                </defs>
                <!-- 连线 -->
                <line
                  v-for="(e, i) in item.thumb.edges"
                  :key="'e' + i"
                  :x1="e.x1"
                  :y1="e.y1"
                  :x2="e.x2"
                  :y2="e.y2"
                  stroke="#94a3b8"
                  stroke-width="1.5"
                  :marker-end="`url(#tpl-arrow-${item.tpl.id})`"
                />
                <!-- 节点 -->
                <g v-for="n in item.thumb.nodes" :key="n.ref">
                  <ellipse
                    v-if="n.render === 'ellipse'"
                    :cx="n.x + n.w / 2"
                    :cy="n.y + n.h / 2"
                    :rx="n.w / 2"
                    :ry="n.h / 2"
                    class="lf-tpl-shape"
                  />
                  <polygon
                    v-else-if="n.render === 'diamond'"
                    :points="diamondPoints(n)"
                    class="lf-tpl-shape"
                  />
                  <rect
                    v-else
                    :x="n.x"
                    :y="n.y"
                    :width="n.w"
                    :height="n.h"
                    :rx="n.render === 'stadium' ? n.h / 2 : n.render === 'rounded' ? 8 : 2"
                    class="lf-tpl-shape"
                  />
                </g>
              </svg>
            </div>
            <div class="lf-tpl-meta">
              <span class="lf-tpl-name">{{ item.tpl.name }}</span>
              <span class="lf-tpl-cat">{{ item.tpl.category }}</span>
            </div>
            <p class="lf-tpl-desc">{{ item.tpl.description }}</p>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 模板库弹窗（ProcessOn / Fynote 风格画廊）。
 * - 网格卡片 + 内联 SVG 缩略图（按模板节点/连线结构实时绘制，不依赖外部图片资源）；
 * - 点击卡片 emit('applied', tpl)，由 index.vue 负责「非空确认 + 套用 + 自适应视口」；
 * - Esc / 点遮罩关闭。
 */
import { computed } from 'vue';

import Icon from '@/components/ui/Icon.vue';
import { shapeOf } from '../shapeDefs';
import { DIAGRAM_TEMPLATES, type DiagramTemplate } from '../templates';

const emit = defineEmits<{ (e: 'applied', tpl: DiagramTemplate): void; (e: 'close'): void }>();

const THUMB_W = 240;
const THUMB_H = 130;
const PAD = 18;

interface ThumbNode {
  ref: string;
  x: number;
  y: number;
  w: number;
  h: number;
  render: string;
}
interface ThumbEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function thumbFor(tpl: DiagramTemplate) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of tpl.nodes) {
    const w = n.width ?? shapeOf(n.type).defaultWidth;
    const h = n.height ?? shapeOf(n.type).defaultHeight;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }
  const cw = maxX - minX || 1;
  const ch = maxY - minY || 1;
  const scale = Math.min((THUMB_W - PAD * 2) / cw, (THUMB_H - PAD * 2) / ch);
  const ox = (THUMB_W - cw * scale) / 2 - minX * scale;
  const oy = (THUMB_H - ch * scale) / 2 - minY * scale;
  const mapX = (x: number) => x * scale + ox;
  const mapY = (y: number) => y * scale + oy;

  const geo = new Map<string, { x: number; y: number; w: number; h: number; render: string }>();
  const nodes: ThumbNode[] = tpl.nodes.map((n) => {
    const def = shapeOf(n.type);
    const w = n.width ?? def.defaultWidth;
    const h = n.height ?? def.defaultHeight;
    geo.set(n.ref, { x: n.x, y: n.y, w, h, render: def.render });
    return { ref: n.ref, x: mapX(n.x), y: mapY(n.y), w: w * scale, h: h * scale, render: def.render };
  });
  const edges: ThumbEdge[] = tpl.edges
    .map((e) => {
      const s = geo.get(e.from);
      const t = geo.get(e.to);
      if (!s || !t) return null;
      return {
        x1: mapX(s.x + s.w / 2),
        y1: mapY(s.y + s.h / 2),
        x2: mapX(t.x + t.w / 2),
        y2: mapY(t.y + t.h / 2),
      };
    })
    .filter(Boolean) as ThumbEdge[];

  return { w: THUMB_W, h: THUMB_H, nodes, edges };
}

function diamondPoints(n: ThumbNode): string {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const hw = n.w / 2;
  const hh = n.h / 2;
  return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
}

const thumbs = computed(() => DIAGRAM_TEMPLATES.map((tpl) => ({ tpl, thumb: thumbFor(tpl) })));

function apply(tpl: DiagramTemplate) {
  emit('applied', tpl);
}
function close() {
  emit('close');
}
</script>

<style scoped>
.lf-tpl-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
}
.lf-tpl-panel {
  width: min(880px, 92vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--kb-background, #fff);
  border: 1px solid var(--kb-border);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}
:global(.dark) .lf-tpl-panel {
  background: var(--kb-card, #1f1f1f);
}
.lf-tpl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--kb-border);
}
.lf-tpl-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.lf-tpl-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.lf-tpl-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
}
.lf-tpl-close:hover {
  background: var(--kb-muted, #e9eef5);
  color: var(--kb-foreground);
}
.lf-tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 14px;
  padding: 18px 20px 22px;
  overflow-y: auto;
}
.lf-tpl-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--kb-border);
  border-radius: 12px;
  background: var(--kb-background, #fff);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
:global(.dark) .lf-tpl-card {
  background: var(--kb-muted, #18181b);
}
.lf-tpl-card:hover {
  border-color: var(--kb-primary, #3b6fe0);
  box-shadow: 0 6px 16px rgba(59, 111, 224, 0.18);
  transform: translateY(-2px);
}
.lf-tpl-thumb {
  height: 96px;
  border-radius: 8px;
  background: var(--kb-muted, #f8fafc);
  border: 1px solid var(--kb-border);
  overflow: hidden;
}
:global(.dark) .lf-tpl-thumb {
  background: #141417;
}
.lf-tpl-thumb svg {
  width: 100%;
  height: 100%;
  display: block;
}
.lf-tpl-shape {
  fill: #fff;
  stroke: var(--kb-primary, #3b6fe0);
  stroke-width: 1.6;
}
:global(.dark) .lf-tpl-shape {
  fill: #232327;
}
.lf-tpl-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.lf-tpl-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.lf-tpl-cat {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 14%, transparent);
  color: var(--kb-primary, #3b6fe0);
  white-space: nowrap;
}
.lf-tpl-desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--kb-muted-foreground);
}
</style>
