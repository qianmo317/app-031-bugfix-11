<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SheetResult } from '../types'
import { cabinetFill, cabinetStroke } from '../lib/colors'

const props = withDefaults(
  defineProps<{
    sheet: SheetResult
    /** 当前播放到的步骤序号（含），-1 表示不显示刀路 */
    activeStep?: number
    showCuts?: boolean
    draggable?: boolean
    selectedId?: string | null
    printMode?: boolean
  }>(),
  {
    activeStep: -1,
    showCuts: false,
    draggable: false,
    selectedId: null,
    printMode: false
  }
)

const emit = defineEmits<{
  (e: 'drop', payload: { instanceId: string; xMm: number; yMm: number }): void
  (e: 'select', instanceId: string): void
}>()

const MARGIN = 26
const vb = computed(() => ({
  x: -MARGIN,
  y: -MARGIN - 18,
  w: props.sheet.wMm + MARGIN * 2,
  h: props.sheet.hMm + MARGIN * 2 + 18
}))

interface LabelCfg {
  fontSize: number
  showDims: boolean
  showCode: boolean
}
function label(pw: number, ph: number): LabelCfg {
  const fs = Math.max(0, Math.min(pw / 5.2, ph / 2.4))
  return {
    fontSize: Math.min(40, fs),
    showCode: fs >= 15,
    showDims: pw >= 118 && ph >= 58 && fs >= 20
  }
}

const stepsShown = computed(() => {
  if (props.activeStep < 0) return { done: [], active: null }
  const list = props.sheet.steps
  const upto = Math.min(props.activeStep, list.length - 1)
  return { done: list.slice(0, upto), active: list[upto] ?? null }
})

const trim = computed(() => {
  const st0 = props.sheet.steps.find((s) => s.kind === 'trim')
  if (!st0) return 8
  return Math.round(st0.at)
})

// 拖拽
const dragId = ref<string | null>(null)
const ghost = ref<{ x: number; y: number; w: number; h: number } | null>(null)

function clientToMm(e: PointerEvent): { x: number; y: number } {
  const cur = e.currentTarget as Element
  const svg = (cur.tagName.toLowerCase() === 'svg'
    ? cur
    : (cur as SVGElement).ownerSVGElement) as SVGSVGElement | null
  if (!svg) return { x: 0, y: 0 }
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const m = pt.matrixTransform(ctm.inverse())
  return { x: m.x, y: m.y }
}

function onDown(e: PointerEvent, id: string): void {
  if (!props.draggable) return
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  dragId.value = id
  const p = props.sheet.placements.find((x) => x.instanceId === id)
  if (p) ghost.value = { x: p.x, y: p.y, w: p.lenMm, h: p.widMm }
}
function onMove(e: PointerEvent): void {
  if (!dragId.value || !ghost.value) return
  const m = clientToMm(e)
  ghost.value.x = m.x - ghost.value.w / 2
  ghost.value.y = m.y - ghost.value.h / 2
}
function onUp(e: PointerEvent): void {
  if (!dragId.value) return
  const m = clientToMm(e)
  const g = ghost.value
  const payload = {
    instanceId: dragId.value,
    xMm: g ? m.x - g.w / 2 : m.x,
    yMm: g ? m.y - g.h / 2 : m.y
  }
  emit('drop', payload)
  dragId.value = null
  ghost.value = null
}

function partCursor(): string {
  return props.draggable ? 'grab' : 'default'
}
</script>

<template>
  <svg
    class="sheet-svg"
    :viewBox="`${vb.x} ${vb.y} ${vb.w} ${vb.h}`"
    preserveAspectRatio="xMidYMid meet"
    @pointermove="onMove"
    @pointerup="onUp"
  >
    <!-- 原板 -->
    <rect
      :x="0"
      :y="0"
      :width="sheet.wMm"
      :height="sheet.hMm"
      fill="#fbfaf6"
      stroke="#3d4b45"
      stroke-width="2.4"
    />
    <text
      :x="sheet.wMm / 2"
      :y="-4"
      text-anchor="middle"
      class="board-title"
    >{{ sheet.boardName }} · {{ sheet.wMm }}×{{ sheet.hMm }}×{{ sheet.thicknessMm }}</text>
    <!-- 修边区 -->
    <rect
      :x="trim"
      :y="trim"
      :width="sheet.wMm - 2 * trim"
      :height="sheet.hMm - 2 * trim"
      fill="none"
      stroke="#9aa6a0"
      stroke-width="1"
      stroke-dasharray="6 5"
    />
    <!-- 余料 -->
    <g v-for="(o, i) in sheet.offcuts" :key="'oc' + i">
      <rect
        :x="o.x"
        :y="o.y"
        :width="o.wMm"
        :height="o.hMm"
        :fill="o.usable ? 'rgba(21,128,61,0.10)' : 'rgba(120,120,120,0.06)'"
        :stroke="o.usable ? '#15803d' : '#9aa6a0'"
        stroke-width="1"
        stroke-dasharray="4 3"
      />
      <text
        v-if="o.usable && o.wMm >= 150 && o.hMm >= 70"
        :x="o.x + 5"
        :y="o.y + 18"
        class="oc-label"
      >余料 {{ o.wMm }}×{{ o.hMm }}</text>
    </g>
    <!-- 零件 -->
    <g
      v-for="p in sheet.placements"
      :key="p.instanceId"
      :class="{ dragging: dragId === p.instanceId, selected: selectedId === p.instanceId }"
    >
      <rect
        :x="dragId === p.instanceId && ghost ? ghost.x : p.x"
        :y="dragId === p.instanceId && ghost ? ghost.y : p.y"
        :width="p.lenMm"
        :height="p.widMm"
        :fill="cabinetFill(p.cabinet)"
        :stroke="cabinetStroke(p.cabinet)"
        :stroke-width="selectedId === p.instanceId ? 3 : 1.4"
        :style="{ cursor: partCursor() }"
        @pointerdown="onDown($event, p.instanceId)"
        @click="emit('select', p.instanceId)"
      />
      <text
        v-if="dragId !== p.instanceId"
        :x="p.x + p.lenMm / 2"
        :y="p.y + p.widMm / 2 - (label(p.lenMm, p.widMm).showDims ? 6 : 0)"
        text-anchor="middle"
        dominant-baseline="middle"
        class="part-label"
        :font-size="label(p.lenMm, p.widMm).fontSize"
        :font-weight="label(p.lenMm, p.widMm).showDims ? 700 : 600"
        :style="{ cursor: partCursor() }"
        @pointerdown="onDown($event, p.instanceId)"
      >
        <tspan v-if="label(p.lenMm, p.widMm).showCode" x="50%" dy="0">{{ p.code }}</tspan>
        <tspan
          v-if="label(p.lenMm, p.widMm).showDims"
          x="50%"
          :dy="label(p.lenMm, p.widMm).fontSize * 1.15"
          class="part-dims"
        >{{ p.origLen }}×{{ p.origWid }}</tspan>
      </text>
      <circle
        v-if="p.grain !== 'none'"
        :cx="p.x + 7"
        :cy="p.y + 7"
        r="4.2"
        :fill="cabinetStroke(p.cabinet)"
      />
      <title>{{ p.code }} {{ p.name }} {{ p.origLen }}×{{ p.origWid }}（{{ p.cabinet }}）</title>
    </g>
    <!-- 刀路播放 -->
    <g v-if="showCuts">
      <line
        v-for="(st, i) in stepsShown.done"
        :key="'d' + i"
        :x1="st.axis === 'v' ? st.at : st.span[0]"
        :y1="st.axis === 'v' ? st.span[0] : st.at"
        :x2="st.axis === 'v' ? st.at : st.span[1]"
        :y2="st.axis === 'v' ? st.span[1] : st.at"
        :stroke="st.kind === 'trim' ? '#a16207' : '#64748b'"
        :stroke-width="st.kind === 'trim' ? 1.4 : 1.8"
        stroke-dasharray="9 5"
        opacity="0.85"
      />
      <line
        v-if="stepsShown.active"
        :x1="stepsShown.active.axis === 'v' ? stepsShown.active.at : stepsShown.active.span[0]"
        :y1="stepsShown.active.axis === 'v' ? stepsShown.active.span[0] : stepsShown.active.at"
        :x2="stepsShown.active.axis === 'v' ? stepsShown.active.at : stepsShown.active.span[1]"
        :y2="stepsShown.active.axis === 'v' ? stepsShown.active.span[1] : stepsShown.active.at"
        stroke="#dc2626"
        stroke-width="3.4"
        class="active-cut"
      />
    </g>
  </svg>
</template>

<style scoped>
.sheet-svg {
  width: 100%;
  height: auto;
  display: block;
  touch-action: none;
}
.board-title {
  font-size: 20px;
  fill: #5b6b64;
  font-weight: 600;
}
.part-label {
  fill: #1f2a26;
  pointer-events: none;
  user-select: none;
}
.part-dims {
  font-weight: 400;
  fill: #42524b;
}
.oc-label {
  font-size: 15px;
  fill: #15803d;
  pointer-events: none;
}
.draggable rect:active {
  cursor: grabbing;
}
:global(.dragging) rect {
  opacity: 0.55;
}
.active-cut {
  filter: drop-shadow(0 0 3px rgba(220, 38, 38, 0.7));
  animation: blink 0.7s infinite alternate;
}
@keyframes blink {
  from {
    opacity: 0.65;
  }
  to {
    opacity: 1;
  }
}
@media print {
  .part-label {
    fill: #000;
  }
  .part-dims {
    fill: #000;
  }
}
</style>
