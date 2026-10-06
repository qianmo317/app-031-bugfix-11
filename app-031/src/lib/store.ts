// 全局状态：Vue reactive 单例 + localStorage 持久化（无 Pinia/Vuex）
import { reactive, computed } from 'vue'
import type {
  Board,
  EdgeSide,
  Job,
  NestResult,
  Part,
  RegisteredOffcut,
  SheetResult
} from '../types'
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

function persist(): void {
  // 约定：所有写操作先改内存里的 state，再整份写回本机存储。
  localStorage.setItem(JOBS_KEY, JSON.stringify(state.jobs))
  localStorage.setItem(OFFCUTS_KEY, JSON.stringify(state.offcuts))
}

// ---- 读档兼容：旧存档里可能有缺字段、重复编号的复制副本，逐条按默认值补全 ----

function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function asStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
function freshId(prefix: string, used: Set<string>): string {
  let id = uid(prefix)
  while (used.has(id)) id = uid(prefix)
  used.add(id)
  return id
}

function hydratePart(raw: unknown, boardIds: Set<string>): Part | null {
  if (!isObj(raw)) return null
  const id = asStr(raw.id, '') || uid('p')
  const qty = Math.max(0, Math.floor(asNum(raw.qty, 1)))
  const grain = ['length', 'width', 'none'].includes(asStr(raw.grain, ''))
    ? (raw.grain as Part['grain'])
    : 'none'
  const edgeBands = Array.isArray(raw.edgeBands)
    ? (raw.edgeBands.filter((e) => ['top', 'bottom', 'left', 'right'].includes(e as string)) as EdgeSide[])
    : []
  const boardId = asStr(raw.boardId, '')
  return {
    id,
    code: asStr(raw.code, ''),
    name: asStr(raw.name, ''),
    lenMm: asNum(raw.lenMm, 0),
    widMm: asNum(raw.widMm, 0),
    qty,
    grain,
    edgeBands,
    cabinet: asStr(raw.cabinet, '未分组') || '未分组',
    exposed: asBool(raw.exposed, false),
    // 指定板材若已不在库中，回落为自动分配，避免悬空引用
    boardId: boardId && boardIds.has(boardId) ? boardId : ''
  }
}

function hydrateBoard(raw: unknown): Board | null {
  if (!isObj(raw)) return null
  const kind = raw.kind === 'offcut' ? 'offcut' : 'stock'
  return {
    id: asStr(raw.id, '') || uid('b'),
    name: asStr(raw.name, '未命名板材') || '未命名板材',
    wMm: asNum(raw.wMm, 0),
    hMm: asNum(raw.hMm, 0),
    thicknessMm: asNum(raw.thicknessMm, 0),
    material: asStr(raw.material, ''),
    priceCents: asNum(raw.priceCents, 0),
    quantity: Math.max(0, Math.floor(asNum(raw.quantity, 0))),
    kind,
    offcutId: kind === 'offcut' ? asStr(raw.offcutId, '') : undefined
  }
}

/** 排样结果必须结构完整，否则视为旧副本残留的脏数据直接丢弃（项目本体照常可用）。 */
function sanitizeResult(raw: unknown): NestResult | undefined {
  if (!isObj(raw) || !Array.isArray(raw.sheets) || raw.sheets.length === 0) return undefined
  for (const s of raw.sheets) {
    if (
      !isObj(s) ||
      !Array.isArray(s.placements) ||
      !Array.isArray(s.steps) ||
      typeof s.wMm !== 'number' ||
      typeof s.hMm !== 'number'
    ) {
      return undefined
    }
  }
  const r = raw as unknown as NestResult
  r.boardsUsed = asNum(r.boardsUsed, r.sheets.length)
  r.boardsByType = isObj(r.boardsByType) ? (r.boardsByType as Record<string, number>) : {}
  r.edgeBandM = isObj(r.edgeBandM)
    ? { exposed: asNum(r.edgeBandM.exposed, 0), normal: asNum(r.edgeBandM.normal, 0) }
    : { exposed: 0, normal: 0 }
  r.unplaced = Array.isArray(r.unplaced) ? r.unplaced : []
  r.baselineBoards = asNum(r.baselineBoards, r.boardsUsed)
  r.savedBoards = asNum(r.savedBoards, 0)
  r.savedCents = asNum(r.savedCents, 0)
  r.totalCostCents = asNum(r.totalCostCents, 0)
  r.stockShortage = Array.isArray(r.stockShortage) ? r.stockShortage : []
  r.elapsedMs = asNum(r.elapsedMs, 0)
  r.generatedAt = asNum(r.generatedAt, Date.now())
  return r
}

function hydrateJob(raw: unknown, usedJobIds: Set<string>): Job | null {
  if (!isObj(raw)) return null
  const boardList = Array.isArray(raw.boards)
    ? (raw.boards.map(hydrateBoard).filter(Boolean) as Board[])
    : []
  if (boardList.length === 0) return null // 连板材库都没有的不是有效项目
  // 板材编号在本单内去重（旧复制副本可能整份克隆过编号）
  const boardIds = new Set<string>()
  for (const b of boardList) {
    if (boardIds.has(b.id)) b.id = freshId('b', boardIds)
    else boardIds.add(b.id)
  }
  const partList = Array.isArray(raw.parts)
    ? (raw.parts.map((p) => hydratePart(p, boardIds)).filter(Boolean) as Part[])
    : []
  const partIds = new Set<string>()
  for (const p of partList) {
    if (partIds.has(p.id)) p.id = freshId('p', partIds)
    else partIds.add(p.id)
  }
  let id = asStr(raw.id, '') || uid('job')
  if (usedJobIds.has(id)) {
    // 项目编号重复（早先复制留下的）：换编号，并作废其排样结果——
    // 旧结果里的引用已无法保证与现存零件一致。
    id = freshId('job', usedJobIds)
    raw.result = undefined
  } else {
    usedJobIds.add(id)
  }
  const name = asStr(raw.name, '').trim() || `未命名项目 ${id.slice(-4)}`
  return {
    id,
    name,
    createdAt: asNum(raw.createdAt, Date.now()),
    boards: boardList,
    parts: partList,
    kerfMm: asNum(raw.kerfMm, boardsData.defaults.kerfMm),
    trimMm: asNum(raw.trimMm, boardsData.defaults.trimMm),
    useOffcutIds: Array.isArray(raw.useOffcutIds)
      ? raw.useOffcutIds.filter((x): x is string => typeof x === 'string')
      : [],
    batchByCabinet: asBool(raw.batchByCabinet, false),
    result: sanitizeResult(raw.result)
  }
}

function hydrateOffcut(raw: unknown): RegisteredOffcut | null {
  if (!isObj(raw)) return null
  return {
    id: asStr(raw.id, '') || uid('oc'),
    jobId: asStr(raw.jobId, ''),
    jobName: asStr(raw.jobName, ''),
    sheetIndex: Math.floor(asNum(raw.sheetIndex, -1)),
    wMm: asNum(raw.wMm, 0),
    hMm: asNum(raw.hMm, 0),
    thicknessMm: asNum(raw.thicknessMm, 0),
    material: asStr(raw.material, ''),
    createdAt: asNum(raw.createdAt, Date.now()),
    available: asBool(raw.available, true),
    usedByJobId:
      typeof raw.usedByJobId === 'string' && raw.usedByJobId ? raw.usedByJobId : undefined
  }
}

function init(): void {
  if (state.loaded) return
  const usedJobIds = new Set<string>()
  const jobs = load<unknown[]>(JOBS_KEY, [])
    .map((raw) => hydrateJob(raw, usedJobIds))
    .filter((j): j is Job => j !== null)
  // 新项目永远排在最前面：按创建时间倒序（同时间保持读入顺序，稳定排序）
  jobs.sort((a, b) => b.createdAt - a.createdAt)
  // 旧存档里可能已有重名项目（旧复制只按名字展示），读回时补齐为互不重名
  const names = new Set<string>()
  for (const j of jobs) {
    let name = j.name
    let n = 2
    while (names.has(name)) {
      name = `${j.name} ${n++}`
    }
    j.name = name
    names.add(name)
  }
  state.jobs = jobs
  state.offcuts = load<unknown[]>(OFFCUTS_KEY, [])
    .map(hydrateOffcut)
    .filter((o): o is RegisteredOffcut => o !== null)
  state.loaded = true
  persist() // 兼容补全后的整份清单立即写回，避免旧脏数据反复进入逻辑
}

/** 清单上唯一的项目名：连点两下复制也不能落下重名/重编号的项目。 */
function uniqueJobName(base: string): string {
  let name = base
  let n = 2
  while (state.jobs.some((j) => j.name === name)) {
    name = `${base} ${n}`
    n++
  }
  return name
}

function defaultJobName(): string {
  return uniqueJobName('未命名项目')
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

export function createJob(name: string): Job {
  init()
  const finalName = name.trim() ? uniqueJobName(name.trim()) : defaultJobName()
  const job: Job = {
    id: uid('job'),
    name: finalName,
    createdAt: Date.now(),
    boards: defaultBoards(),
    parts: [],
    kerfMm: boardsData.defaults.kerfMm,
    trimMm: boardsData.defaults.trimMm,
    useOffcutIds: [],
    batchByCabinet: false
  }
  state.jobs.unshift(job) // 新项目排最前
  persist()
  return job
}

export function deleteJob(id: string): void {
  init()
  const before = state.jobs.length
  // 只删编号相同的那一条；同名的其它项目保留
  state.jobs = state.jobs.filter((j) => j.id !== id)
  if (state.jobs.length !== before) persist() // 删完立刻整份写回本机存储
}

/** 零件总件数（按每行数量合计，不是清单行数）。列表/统计共用同一口径。 */
export function jobPieceCount(job: Job): number {
  return job.parts.reduce((a, p) => a + (Number.isFinite(p.qty) && p.qty > 0 ? p.qty : 0), 0)
}

/**
 * 复制项目。
 * 取舍（二选一里选“清掉排样结果”）：副本深拷贝原单的板材库与零件清单并换全新编号，
 * 但不带 result——副本一打开显示“未排样”，没有用板张数/料钱/利用率可看。
 * 理由：若把上次排样带过去，副本顶的就是一份按原单零件算出来的张数与金额，
 * 副本零件一改立刻对不上；一旦写回本机存档，存档里的副本及按它导出的单据全部作废。
 * 清掉只多花一次重排，换来任何时刻副本里的数都自洽。
 */
export function duplicateJob(id: string): Job | null {
  init()
  const src = state.jobs.find((j) => j.id === id)
  if (!src) return null
  // JSON 深拷贝切断 parts/boards 数组与原单的共享（旧版浅拷贝导致改副本原单跟着变）
  const copy: Job = {
    ...(JSON.parse(JSON.stringify(src)) as Job),
    id: uid('job'),
    name: uniqueJobName(`${src.name} 副本`),
    createdAt: Date.now(),
    result: undefined // 明确当作尚未排样
  }
  // 深拷贝已切断与原单的数组共享；编号也全部换新，避免双份同 id
  const boardIdMap = new Map<string, string>()
  for (const b of copy.boards) {
    const nid = uid('b')
    boardIdMap.set(b.id, nid)
    b.id = nid
  }
  for (const p of copy.parts) {
    p.id = uid('p')
    if (p.boardId && boardIdMap.has(p.boardId)) p.boardId = boardIdMap.get(p.boardId)!
  }
  state.jobs.unshift(copy)
  persist()
  return copy
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
    const obj = JSON.parse(json)
    if (!isObj(obj) || !Array.isArray(obj.parts) || !Array.isArray(obj.boards)) return null
    // 导入即新项目：预置一个不冲突的新编号，走与读档同一套补全
    // （缺字段补默认、旧排样结果作废、板材/零件引用修复）
    const usedIds = new Set(state.jobs.map((j) => j.id))
    obj.id = freshId('job', usedIds)
    obj.result = undefined
    obj.createdAt = Date.now()
    const job = hydrateJob(obj, usedIds)
    if (!job) return null
    const trimmed = asStr(obj.name, '').trim()
    job.name = trimmed ? uniqueJobName(trimmed) : defaultJobName()
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
