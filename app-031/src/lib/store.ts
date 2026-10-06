// 全局状态：Vue reactive 单例 + localStorage 持久化（无 Pinia/Vuex）
import { reactive, computed } from 'vue'
import type { Board, EdgeSide, Job, NestResult, Part, RegisteredOffcut, SheetResult } from '../types'
import { nestJob } from './packing'
import { rebuildFromPlacements } from './cuts'
import { guillotineViolation } from './geometry'
import { uid } from './format'
import boardsData from '../data/boards.json'

const JOBS_KEY = 'fco.jobs.v1'
const OFFCUTS_KEY = 'fco.offcuts.v1'

interface State {
  jobs: Job[]
  offcuts: RegisteredOffcut[]
  loaded: boolean
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as T
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback
    return parsed
  } catch {
    return fallback
  }
}

const state = reactive<State>({
  jobs: [],
  offcuts: [],
  loaded: false
})

/** 先改内存，再把整份清单写回本机存储；所有变更都经此一处落盘。 */
function persist(): void {
  localStorage.setItem(JOBS_KEY, JSON.stringify(state.jobs))
  localStorage.setItem(OFFCUTS_KEY, JSON.stringify(state.offcuts))
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/**
 * 兼容读回旧存档：旧版本复制出过同编号项目、浅拷贝共用零件/板材，
 * 且可能缺字段。这里按默认值补齐、给缺失编号补发新 id，
 * 不让任何一条坏数据导致整份列表打不开。
 */
function normalizeBoard(raw: unknown, seen: Set<string>): Board | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  let id = asString(o.id, '')
  if (!id || seen.has(id)) id = uid('b')
  seen.add(id)
  return {
    id,
    name: asString(o.name, '未命名板材'),
    wMm: isNum(o.wMm) ? o.wMm : 2440,
    hMm: isNum(o.hMm) ? o.hMm : 1220,
    thicknessMm: isNum(o.thicknessMm) ? o.thicknessMm : 18,
    material: asString(o.material, '刨花板'),
    priceCents: isNum(o.priceCents) ? o.priceCents : 0,
    quantity: isNum(o.quantity) ? o.quantity : 0,
    kind: o.kind === 'offcut' ? 'offcut' : 'stock',
    offcutId: typeof o.offcutId === 'string' ? o.offcutId : undefined
  }
}

function normalizePart(raw: unknown, boardIds: Set<string>, seen: Set<string>): Part | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  let id = asString(o.id, '')
  if (!id || seen.has(id)) id = uid('p')
  seen.add(id)
  const grain = o.grain === 'length' || o.grain === 'width' ? o.grain : 'none'
  const boardId = typeof o.boardId === 'string' && boardIds.has(o.boardId) ? o.boardId : ''
  return {
    id,
    code: asString(o.code, ''),
    name: asString(o.name, ''),
    lenMm: isNum(o.lenMm) && o.lenMm > 0 ? o.lenMm : 0,
    widMm: isNum(o.widMm) && o.widMm > 0 ? o.widMm : 0,
    qty: isNum(o.qty) && o.qty > 0 ? Math.floor(o.qty) : 1,
    grain,
    edgeBands: asArray<EdgeSide>(o.edgeBands).filter(
      (e) => e === 'top' || e === 'bottom' || e === 'left' || e === 'right'
    ),
    cabinet: asString(o.cabinet, '未分组'),
    exposed: asBool(o.exposed, false),
    boardId
  }
}

/** 排样结果结构较复杂，旧存档若缺关键字段就当作没排过样，由用户重排。 */
function normalizeResult(raw: unknown): NestResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const sheets = asArray<unknown>(o.sheets)
  if (!sheets.length || !isNum(o.boardsUsed) || !isNum(o.generatedAt)) return undefined
  return o as unknown as NestResult
}

const jobIds = new Set<string>()

function normalizeJob(raw: unknown, fallbackName: string): Job | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  let id = asString(o.id, '')
  if (!id) id = uid('job')
  // 同编号项目（旧复制 bug 遗留）：给后一条补发新 id
  if (jobIds.has(id)) id = uid('job')
  jobIds.add(id)

  const boardSeen = new Set<string>()
  const boards = asArray<unknown>(o.boards)
    .map((b) => normalizeBoard(b, boardSeen))
    .filter((b): b is Board => b !== null)
  const boardIds = new Set(boards.map((b) => b.id))

  const partSeen = new Set<string>()
  const parts = asArray<unknown>(o.parts)
    .map((p) => normalizePart(p, boardIds, partSeen))
    .filter((p): p is Part => p !== null)

  return {
    id,
    name: asString(o.name, '').trim() || fallbackName,
    createdAt: isNum(o.createdAt) ? o.createdAt : Date.now(),
    boards,
    parts,
    kerfMm: isNum(o.kerfMm) && o.kerfMm > 0 ? o.kerfMm : boardsData.defaults.kerfMm,
    trimMm: isNum(o.trimMm) && o.trimMm >= 0 ? o.trimMm : boardsData.defaults.trimMm,
    useOffcutIds: asArray<string>(o.useOffcutIds).filter((x) => typeof x === 'string'),
    batchByCabinet: asBool(o.batchByCabinet, false),
    result: normalizeResult(o.result)
  }
}

/** 项目总件数：每种零件的数量合计（不是清单行数）。 */
export function jobPieceCount(job: Job): number {
  return job.parts.reduce((sum, p) => sum + (Number.isFinite(p.qty) && p.qty > 0 ? p.qty : 0), 0)
}

function init(): void {
  if (state.loaded) return
  const stored = load<unknown[]>(JOBS_KEY, [])
  const jobs: Job[] = []
  jobIds.clear()
  stored.forEach((raw, i) => {
    const j = normalizeJob(raw, `未命名项目 ${i + 1}`)
    if (j) jobs.push(j)
  })
  state.jobs = jobs
  state.offcuts = load<RegisteredOffcut[]>(OFFCUTS_KEY, [])
  state.loaded = true
  // 旧存档修好之后立刻整份写回，刷新后读到的就是干净数据
  persist()
}

export function defaultBoards(): Board[] {
  return boardsData.stockBoards.slice(0, 3).map((b) => ({
    id: uid('b'),
    name: b.name,
    wMm: b.wMm,
    hMm: b.hMm,
    thicknessMm: b.thicknessMm,
    material: b.material,
    priceCents: b.priceCents,
    quantity: 0,
    kind: 'stock'
  }))
}

export function allStockTemplates(): Omit<Board, 'id'>[] {
  return boardsData.stockBoards.map((b) => ({
    name: b.name,
    wMm: b.wMm,
    hMm: b.hMm,
    thicknessMm: b.thicknessMm,
    material: b.material,
    priceCents: b.priceCents,
    quantity: 0,
    kind: 'stock' as const
  }))
}

/** 列表内同名时自动加「2 / 3 …」后缀，保证列表上一眼能区分。 */
function uniqueCopyName(base: string): string {
  const taken = new Set(state.jobs.map((j) => j.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** 空名字补默认名：未命名项目 / 未命名项目 2 … */
function defaultJobName(input: string): string {
  const trimmed = input.trim()
  if (trimmed) return uniqueCopyName(trimmed)
  return uniqueCopyName('未命名项目')
}

export function createJob(name: string): Job {
  init()
  const job: Job = {
    id: uid('job'),
    name: defaultJobName(name),
    createdAt: Date.now(),
    boards: defaultBoards(),
    parts: [],
    kerfMm: boardsData.defaults.kerfMm,
    trimMm: boardsData.defaults.trimMm,
    useOffcutIds: [],
    batchByCabinet: false
  }
  jobIds.add(job.id)
  // 新项目排最前面：先改内存，再整份写回
  state.jobs.unshift(job)
  persist()
  return job
}

export function deleteJob(id: string): void {
  init()
  // 只按唯一编号删除选中的那一条（旧代码按名字删，同名项目会被一起删掉）
  const idx = state.jobs.findIndex((j) => j.id === id)
  if (idx < 0) return
  state.jobs.splice(idx, 1)
  jobIds.delete(id)
  persist()
}

/**
 * 复制项目。
 *
 * 取舍：副本一律清掉原单的排样结果（result），当作「未排样」的新单。
 * 理由——带过去虽然省一次重排，但那份用板张数、料钱、利用率是按原项目
 * 零件算的；副本零件一旦改动，数就对不上，打开看到的是假数，按它导出的
 * 单据也得作废重来。清掉后多排一次，让出的只是刚建好那一下看不到数字，
 * 换来的是副本里每一个数都只对应副本自己的零件。
 */
export function duplicateJob(id: string): Job | null {
  init()
  const src = state.jobs.find((j) => j.id === id)
  if (!src) return null
  // 深拷贝 + 全部 id 重发：旧代码浅拷贝导致副本与原单共用 boards/parts，
  // 改一个另一个跟着变
  const clone = JSON.parse(JSON.stringify(src)) as Job
  clone.id = uid('job')
  clone.name = uniqueCopyName(`${src.name} 副本`)
  clone.createdAt = Date.now()
  const boardIdMap = new Map<string, string>()
  clone.boards = clone.boards.map((b) => {
    const nb = uid('b')
    boardIdMap.set(b.id, nb)
    return { ...b, id: nb }
  })
  clone.parts = clone.parts.map((p) => ({
    ...p,
    id: uid('p'),
    boardId: p.boardId ? boardIdMap.get(p.boardId) ?? '' : ''
  }))
  clone.useOffcutIds = []
  // 排样结果引用的是旧零件/旧板的 id 与按旧零件算出的张数，整体作废
  clone.result = undefined
  jobIds.add(clone.id)
  state.jobs.unshift(clone)
  persist()
  return clone
}

export function saveJob(_job: Job): void {
  persist()
}

export function getJob(id: string): Job | undefined {
  init()
  return state.jobs.find((j) => j.id === id)
}

/** 把勾选的登记余料转成本单可用的小板（排在板材列表前，优先消耗）。 */
function boardsWithOffcuts(job: Job): Board[] {
  const offcutBoards: Board[] = state.offcuts
    .filter((o) => o.available && job.useOffcutIds.includes(o.id))
    .map((o) => ({
      id: `offcut_${o.id}`,
      name: `余料板 ${o.wMm}×${o.hMm}×${o.thicknessMm}（${o.material}）`,
      wMm: o.wMm,
      hMm: o.hMm,
      thicknessMm: o.thicknessMm,
      material: o.material,
      priceCents: 0,
      quantity: 1,
      kind: 'offcut' as const,
      offcutId: o.id
    }))
  return [...offcutBoards, ...job.boards]
}

export function runNest(job: Job): NestResult {
  const effective: Job = { ...job, boards: boardsWithOffcuts(job) }
  const result = nestJob(effective)
  // 标记被用掉的余料
  const usedOffcutBoardIds = new Set(
    result.sheets.filter((s) => s.boardId.startsWith('offcut_')).map((s) => s.boardId)
  )
  for (const oc of state.offcuts) {
    if (usedOffcutBoardIds.has(`offcut_${oc.id}`)) {
      oc.available = false
      oc.usedByJobId = job.id
    }
  }
  job.result = result
  persist()
  return result
}

/** 手工微调：移动/交换后重新校验 guillotine 并重算刀路；非法返回错误信息。 */
export function applyAdjustment(
  job: Job,
  sheetIndex: number,
  placements: SheetResult['placements']
): string | null {
  if (!job.result) return '尚未排样'
  const sheet = job.result.sheets[sheetIndex]
  const bounds = {
    x: job.trimMm,
    y: job.trimMm,
    w: sheet.wMm - 2 * job.trimMm,
    h: sheet.hMm - 2 * job.trimMm
  }
  const violation = guillotineViolation(
    placements.map((p) => ({ id: p.instanceId, x: p.x, y: p.y, w: p.lenMm, h: p.widMm })),
    bounds,
    job.kerfMm
  )
  if (violation) return violation
  const rebuilt = rebuildFromPlacements(
    sheet.wMm,
    sheet.hMm,
    job.kerfMm,
    job.trimMm,
    sheetIndex,
    placements
  )
  if (!rebuilt) return '调整后无法生成可执行的贯通裁切刀路'
  const offcuts = rebuilt.leftovers
    .filter((r) => r.w >= 300 - 0.05 && r.h >= 300 - 0.05)
    .map((r) => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      wMm: Math.round(r.w),
      hMm: Math.round(r.h),
      areaMm2: Math.round(r.w * r.h),
      usable: true
    }))
    .sort((a, b) => b.areaMm2 - a.areaMm2)
  sheet.placements = placements.map((p) => ({ ...p, adjusted: true }))
  sheet.steps = rebuilt.steps
  sheet.offcuts = offcuts
  sheet.adjusted = true
  sheet.usedAreaMm2 = sheet.placements.reduce((a, p) => a + p.origLen * p.origWid, 0)
  sheet.utilization = sheet.usedAreaMm2 / sheet.boardAreaMm2
  persist()
  return null
}

export function registerOffcuts(
  job: Job,
  picks: { sheetIndex: number; x: number; y: number; wMm: number; hMm: number }[]
): number {
  if (!job.result) return 0
  let n = 0
  for (const pick of picks) {
    const sheet = job.result.sheets[pick.sheetIndex]
    state.offcuts.push({
      id: uid('oc'),
      jobId: job.id,
      jobName: job.name,
      sheetIndex: pick.sheetIndex,
      wMm: pick.wMm,
      hMm: pick.hMm,
      thicknessMm: sheet.thicknessMm,
      material: sheet.material,
      createdAt: Date.now(),
      available: true
    })
    n++
  }
  persist()
  return n
}

export function addManualOffcut(input: {
  wMm: number
  hMm: number
  thicknessMm: number
  material: string
}): void {
  state.offcuts.push({
    id: uid('oc'),
    jobId: '',
    jobName: '手工登记',
    sheetIndex: -1,
    wMm: input.wMm,
    hMm: input.hMm,
    thicknessMm: input.thicknessMm,
    material: input.material,
    createdAt: Date.now(),
    available: true
  })
  persist()
}

export function removeOffcut(id: string): void {
  const i = state.offcuts.findIndex((o) => o.id === id)
  if (i >= 0) state.offcuts.splice(i, 1)
  persist()
}

export function toggleOffcut(id: string): void {
  const o = state.offcuts.find((x) => x.id === id)
  if (o) {
    o.available = !o.available
    if (o.available) o.usedByJobId = undefined
    persist()
  }
}

/** 示例：一套橱柜 + 衣柜混合 BOM（含竖纹门板、见光侧板、背板 9mm） */
export function createSampleJob(): Job {
  const job = createJob('示例：三室全屋柜体（18mm 柜体 + 9mm 背板）')
  const b18 = job.boards[0] // 颗粒板 18mm
  const bBack = boardsData.stockBoards[6]
  const back: Board = {
    id: uid('b'),
    name: bBack.name,
    wMm: bBack.wMm,
    hMm: bBack.hMm,
    thicknessMm: bBack.thicknessMm,
    material: bBack.material,
    priceCents: bBack.priceCents,
    quantity: 0,
    kind: 'stock'
  }
  job.boards.push(back)
  const P = (
    code: string,
    name: string,
    l: number,
    w: number,
    qty: number,
    grain: Part['grain'],
    edges: Part['edgeBands'],
    cabinet: string,
    exposed: boolean,
    boardId?: string
  ): Part => ({
    id: uid('p'),
    code,
    name,
    lenMm: l,
    widMm: w,
    qty,
    grain,
    edgeBands: edges,
    cabinet,
    exposed,
    boardId: boardId ?? b18.id
  })
  const all4: Part['edgeBands'] = ['top', 'bottom', 'left', 'right']
  const lb: Part['edgeBands'] = ['left', 'right']
  const tb: Part['edgeBands'] = ['top', 'bottom']
  job.parts = [
    // 地柜（600 宽标准柜 ×2 + 800 宽水槽柜）
    P('DC-S', '地柜侧板', 700, 560, 4, 'length', lb, '地柜', false),
    P('DC-D', '地柜底板', 564, 560, 2, 'none', tb, '地柜', false),
    P('DC-T', '地柜顶板/拉带', 564, 100, 2, 'none', [], '地柜', false),
    P('DC-M', '地柜门(竖纹见光)', 700, 296, 2, 'length', all4, '地柜', true),
    P('SC-S', '水槽柜侧板', 700, 560, 2, 'length', lb, '水槽柜', false),
    P('SC-D', '水槽柜底板', 764, 560, 1, 'none', tb, '水槽柜', false),
    P('SC-M', '水槽柜门(竖纹见光)', 700, 396, 2, 'length', all4, '水槽柜', true),
    // 吊柜
    P('GC-S', '吊柜侧板', 700, 320, 4, 'length', lb, '吊柜', false),
    P('GC-P', '吊柜层板', 764, 320, 2, 'none', tb, '吊柜', false),
    P('GC-M', '吊柜门板(竖纹见光)', 700, 396, 2, 'length', all4, '吊柜', true),
    // 衣柜
    P('WR-S', '衣柜见光侧板', 2200, 580, 2, 'length', all4, '衣柜', true),
    P('WR-IS', '衣柜中侧板', 2180, 560, 1, 'length', lb, '衣柜', false),
    P('WR-P', '衣柜层板', 564, 560, 5, 'none', tb, '衣柜', false),
    P('WR-T', '衣柜顶板', 1800, 560, 1, 'none', tb, '衣柜', false),
    P('WR-B', '衣柜底板', 1800, 560, 1, 'none', tb, '衣柜', false),
    P('WR-M', '衣柜门板(竖纹见光)', 2180, 446, 4, 'length', all4, '衣柜', true),
    // 9mm 背板（指定板材）
    P('BB-D', '地柜/水槽柜背板', 690, 564, 3, 'none', [], '地柜', false, back.id),
    P('BB-G', '吊柜背板', 690, 764, 1, 'none', [], '吊柜', false, back.id),
    P('BB-W', '衣柜背板(竖纹)', 2180, 900, 2, 'length', [], '衣柜', false, back.id)
  ]
  return job
}

export function newPart(partial: Partial<Part> = {}): Part {
  return {
    id: uid('p'),
    code: partial.code ?? '',
    name: partial.name ?? '',
    lenMm: partial.lenMm ?? 0,
    widMm: partial.widMm ?? 0,
    qty: partial.qty ?? 1,
    grain: partial.grain ?? 'none',
    edgeBands: partial.edgeBands ?? [],
    cabinet: partial.cabinet ?? '未分组',
    exposed: partial.exposed ?? false,
    boardId: partial.boardId ?? ''
  }
}

export function exportJobJson(job: Job): string {
  return JSON.stringify(job, null, 2)
}

export function importJobJson(json: string): Job | null {
  init()
  try {
    const parsed = JSON.parse(json)
    // 外部文件字段可能缺/坏，走同一套兼容补齐，坏文件返回 null 而不是让列表打不开
    const job = normalizeJob(parsed, '导入的项目')
    if (!job) return null
    // 同一文件反复导入也不许出现重复编号：job/板/零件 id 全部重发
    job.id = uid('job')
    const boardIdMap = new Map<string, string>()
    job.boards = job.boards.map((b) => {
      const nb = uid('b')
      boardIdMap.set(b.id, nb)
      return { ...b, id: nb }
    })
    job.parts = job.parts.map((p) => ({
      ...p,
      id: uid('p'),
      boardId: p.boardId ? boardIdMap.get(p.boardId) ?? '' : ''
    }))
    job.name = uniqueCopyName(job.name)
    job.createdAt = Date.now()
    job.useOffcutIds = []
    // 排样结果引用旧 id 且属于原单零件，导入一律重排
    job.result = undefined
    jobIds.add(job.id)
    state.jobs.unshift(job)
    persist()
    return job
  } catch {
    return null
  }
}

export function useStore() {
  init()
  return {
    state,
    jobs: computed(() => state.jobs),
    offcuts: computed(() => state.offcuts)
  }
}

export { boardsData }
