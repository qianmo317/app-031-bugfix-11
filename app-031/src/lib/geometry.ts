// 几何工具：矩形、guillotine（贯通直线切割）合法性校验与切割线分解
import type { CutStep } from '../types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PlacedRect extends Rect {
  id: string
}

export const EPS = 0.05 // 坐标比较容差（mm）

export function rectArea(r: Rect): number {
  return r.w * r.h
}

export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS &&
    b.x < a.x + a.w - EPS &&
    a.y < b.y + b.h - EPS &&
    b.y < a.y + a.h - EPS
  )
}

export function containsRect(outer: Rect, inner: Rect, tol = EPS): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  )
}

/**
 * 判定一组矩形能否由 guillotine 贯通切割得到（手工微调后的合法性校验）。
 * 递归寻找一条贯穿当前外框、且不切开任何零件的直线，把集合二分。
 * 返回 null 表示合法，否则返回原因。
 */
export function guillotineViolation(
  rects: PlacedRect[],
  bounds: Rect,
  kerf: number
): string | null {
  if (rects.length === 0) return null
  for (const r of rects) {
    if (!containsRect(bounds, r)) return `零件 ${r.id} 超出板材边界`
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i], rects[j])) return `零件 ${rects[i].id} 与 ${rects[j].id} 重叠`
    }
  }
  return recurseCheck(rects, bounds, kerf) ? null : '存在非贯通（塞缝）排法，推台锯无法加工'
}

function recurseCheck(rects: PlacedRect[], bounds: Rect, kerf: number): boolean {
  if (rects.length <= 1) return true
  // 候选竖切线：任意零件右边沿（+锯路）
  const cutsV = collectCuts(rects, bounds, 'v', kerf)
  for (const at of cutsV) {
    const left = rects.filter((r) => r.x + r.w <= at + EPS)
    const right = rects.filter((r) => r.x >= at - EPS)
    if (left.length + right.length === rects.length && left.length > 0 && right.length > 0) {
      const lb: Rect = { x: bounds.x, y: bounds.y, w: at - bounds.x, h: bounds.h }
      const rb: Rect = { x: at, y: bounds.y, w: bounds.x + bounds.w - at, h: bounds.h }
      if (recurseCheck(left, lb, kerf) && recurseCheck(right, rb, kerf)) return true
    }
  }
  const cutsH = collectCuts(rects, bounds, 'h', kerf)
  for (const at of cutsH) {
    const bottom = rects.filter((r) => r.y + r.h <= at + EPS)
    const top = rects.filter((r) => r.y >= at - EPS)
    if (bottom.length + top.length === rects.length && bottom.length > 0 && top.length > 0) {
      const bb: Rect = { x: bounds.x, y: bounds.y, w: bounds.w, h: at - bounds.y }
      const tb: Rect = { x: bounds.x, y: at, w: bounds.w, h: bounds.y + bounds.h - at }
      if (recurseCheck(bottom, bb, kerf) && recurseCheck(top, tb, kerf)) return true
    }
  }
  return false
}

function collectCuts(rects: PlacedRect[], bounds: Rect, axis: 'v' | 'h', kerf: number): number[] {
  const out = new Set<number>()
  const spanStart = axis === 'v' ? bounds.x : bounds.y
  const spanSize = axis === 'v' ? bounds.w : bounds.h
  for (const r of rects) {
    const edge = axis === 'v' ? r.x + r.w : r.y + r.h
    const at = edge + kerf / 2
    if (at > spanStart + EPS && at < spanStart + spanSize - EPS) {
      // 该位置必须存在一条“锯路间隙”：左右（上下）零件之间至少有 kerf 间隔
      const hasGap = rects.every((o) => {
        if (axis === 'v') {
          const leftSide = o.x + o.w <= edge + EPS
          const rightSide = o.x >= edge + kerf - EPS
          return leftSide || rightSide
        }
        const beforeSide = o.y + o.h <= edge + EPS
        const afterSide = o.y >= edge + kerf - EPS
        return beforeSide || afterSide
      })
      if (hasGap) out.add(Math.round(at * 10) / 10)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * 对一组已就位的矩形做 guillotine 递归分解，产出原始切割段（未合并）。
 * 同时回收无零件叶子矩形作为余料。
 * 仅在 guillotineViolation 通过后调用。
 */
export interface RawSeg {
  axis: 'v' | 'h'
  at: number
  lo: number
  hi: number
}

export function decomposeGuillotine(
  rects: PlacedRect[],
  bounds: Rect,
  kerf: number
): { segs: RawSeg[]; leftovers: Rect[] } {
  const segs: RawSeg[] = []
  const leftovers: Rect[] = []
  const recurse = (rs: PlacedRect[], b: Rect): void => {
    if (rs.length === 0) {
      leftovers.push(b)
      return
    }
    if (rs.length === 1) {
      const only = rs[0]
      const gapR = b.x + b.w - (only.x + only.w)
      const gapT = b.y + b.h - (only.y + only.h)
      const gapL = only.x - b.x
      const gapB = only.y - b.y
      // 单块未填满：沿更窄的余隙方向补切线，把余料切成可回收矩形
      if (gapL >= kerf - EPS || gapB >= kerf - EPS) {
        // 零件不在原点（手工移动后）：先切出原点方向余料
        if (gapL >= kerf - EPS && gapB >= kerf - EPS) {
          // 不常见，双向各切一刀
          segs.push({ axis: 'v', at: only.x - kerf / 2, lo: b.y, hi: b.y + b.h })
          segs.push({
            axis: 'h',
            at: only.y - kerf / 2,
            lo: only.x,
            hi: b.x + b.w
          })
          recurse([only], {
            x: only.x,
            y: only.y,
            w: b.x + b.w - only.x,
            h: b.y + b.h - only.y
          })
          return
        }
      }
      if (gapR >= kerf - EPS && gapT >= kerf - EPS) {
        segs.push({ axis: 'v', at: only.x + only.w + kerf / 2, lo: b.y, hi: b.y + b.h })
        segs.push({
          axis: 'h',
          at: only.y + only.h + kerf / 2,
          lo: only.x,
          hi: only.x + only.w
        })
        leftovers.push({
          x: only.x + only.w + kerf,
          y: b.y,
          w: gapR - kerf,
          h: b.h
        })
        leftovers.push({
          x: only.x,
          y: only.y + only.h + kerf,
          w: only.w,
          h: gapT - kerf
        })
      } else if (gapR >= kerf - EPS) {
        segs.push({ axis: 'v', at: only.x + only.w + kerf / 2, lo: b.y, hi: b.y + b.h })
        leftovers.push({ x: only.x + only.w + kerf, y: b.y, w: gapR - kerf, h: b.h })
      } else if (gapT >= kerf - EPS) {
        segs.push({ axis: 'h', at: only.y + only.h + kerf / 2, lo: b.x, hi: b.x + b.w })
        leftovers.push({ x: b.x, y: only.y + only.h + kerf, w: b.w, h: gapT - kerf })
      } else if (gapL >= kerf - EPS) {
        segs.push({ axis: 'v', at: only.x - kerf / 2, lo: b.y, hi: b.y + b.h })
        leftovers.push({ x: b.x, y: b.y, w: gapL - kerf, h: b.h })
      } else if (gapB >= kerf - EPS) {
        segs.push({ axis: 'h', at: only.y - kerf / 2, lo: b.x, hi: b.x + b.w })
        leftovers.push({ x: b.x, y: b.y, w: b.w, h: gapB - kerf })
      }
      return
    }
    const tryAxis = (axis: 'v' | 'h'): boolean => {
      const cuts = collectCuts(rs, b, axis, kerf)
      for (const at of cuts) {
        let a: PlacedRect[]
        let c: PlacedRect[]
        let ab: Rect
        let cb: Rect
        if (axis === 'v') {
          a = rs.filter((r) => r.x + r.w <= at + EPS)
          c = rs.filter((r) => r.x >= at - EPS)
          ab = { x: b.x, y: b.y, w: at - b.x - kerf / 2, h: b.h }
          cb = { x: at + kerf / 2, y: b.y, w: b.x + b.w - at - kerf / 2, h: b.h }
        } else {
          a = rs.filter((r) => r.y + r.h <= at + EPS)
          c = rs.filter((r) => r.y >= at - EPS)
          ab = { x: b.x, y: b.y, w: b.w, h: at - b.y - kerf / 2 }
          cb = { x: b.x, y: at + kerf / 2, w: b.w, h: b.y + b.h - at - kerf / 2 }
        }
        if (a.length + c.length === rs.length && a.length > 0 && c.length > 0) {
          segs.push({
            axis,
            at,
            lo: axis === 'v' ? b.y : b.x,
            hi: axis === 'v' ? b.y + b.h : b.x + b.w
          })
          recurse(a, ab)
          recurse(c, cb)
          return true
        }
      }
      return false
    }
    // 优先竖切（与排样器的列优先一致，减少刀向翻转）
    if (!tryAxis('v') && !tryAxis('h')) {
      // 理论不会进入（已通过合法性校验）
    }
  }
  recurse(rects, bounds)
  return { segs, leftovers }
}

/** 把同轴线、位置相同且区间相接/重叠的切割段合并为贯通刀（车间一刀成型）。 */
export interface MergedSeg extends RawSeg {
  id: number
  deps: Set<number>
}

export function mergeSegs(raw: RawSeg[], kerf: number): MergedSeg[] {
  const groups: MergedSeg[] = []
  for (const s of raw) {
    let target: MergedSeg | undefined
    for (const g of groups) {
      if (g.axis === s.axis && Math.abs(g.at - s.at) < 0.02) {
        const gap = Math.max(g.lo, s.lo) - Math.min(g.hi, s.hi)
        if (gap <= kerf + 0.6) {
          target = g
          break
        }
      }
    }
    if (target) {
      target.lo = Math.min(target.lo, s.lo)
      target.hi = Math.max(target.hi, s.hi)
    } else {
      groups.push({ id: groups.length, axis: s.axis, at: s.at, lo: s.lo, hi: s.hi, deps: new Set() })
    }
  }
  return groups
}

/** 把合并后的切割段排成可执行序列，相邻步骤尽量同向（减少推台翻转）。 */
export function orderSegs(
  segs: MergedSeg[],
  prerequisiteOf: (s: MergedSeg) => number[]
): MergedSeg[] {
  const indeg = new Map<number, number>()
  const dependents = new Map<number, number[]>()
  for (const s of segs) indeg.set(s.id, 0)
  for (const s of segs) {
    for (const d of prerequisiteOf(s)) {
      if (d === s.id || !indeg.has(d)) continue
      indeg.set(s.id, (indeg.get(s.id) ?? 0) + 1)
      const arr = dependents.get(d) ?? []
      arr.push(s.id)
      dependents.set(d, arr)
    }
  }
  const ready = segs.filter((s) => (indeg.get(s.id) ?? 0) === 0).map((s) => s.id)
  const byId = new Map(segs.map((s) => [s.id, s]))
  const out: MergedSeg[] = []
  let lastAxis: 'v' | 'h' | null = null
  const popReady = (): number | undefined => {
    if (ready.length === 0) return undefined
    if (lastAxis) {
      const same = ready.find((id) => byId.get(id)?.axis === lastAxis)
      if (same !== undefined) {
        ready.splice(ready.indexOf(same), 1)
        return same
      }
    }
    ready.sort((a, b) => {
      const sa = byId.get(a)!
      const sb = byId.get(b)!
      return sa.axis === sb.axis ? sa.at - sb.at : sa.axis < sb.axis ? -1 : 1
    })
    return ready.shift()
  }
  while (ready.length > 0) {
    const id = popReady()
    if (id === undefined) break
    const seg = byId.get(id)!
    out.push(seg)
    lastAxis = seg.axis
    for (const dep of dependents.get(id) ?? []) {
      const n = (indeg.get(dep) ?? 0) - 1
      indeg.set(dep, n)
      if (n === 0) ready.push(dep)
    }
  }
  return out
}

export function segsToSteps(
  ordered: MergedSeg[],
  boardIndex: number,
  startOrder: number
): CutStep[] {
  return ordered.map((s, i) => ({
    boardIndex,
    axis: s.axis,
    at: Math.round(s.at * 10) / 10,
    span: [Math.round(s.lo), Math.round(s.hi)],
    order: startOrder + i,
    kind: 'cut' as const,
    label:
      s.axis === 'v'
        ? `沿 X = ${Math.round(s.at)}mm 竖切，贯通 ${Math.round(s.hi - s.lo)}mm`
        : `沿 Y = ${Math.round(s.at)}mm 横切，贯通 ${Math.round(s.hi - s.lo)}mm`
  }))
}
