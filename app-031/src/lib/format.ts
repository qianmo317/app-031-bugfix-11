// 通用工具：ID、金额、面积格式化、文件下载、CSV 解析

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

export function mm(v: number): string {
  return `${Math.round(v)}`
}

export function areaM2(mm2: number): string {
  return `${(mm2 / 1_000_000).toFixed(2)}m²`
}

export function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 解析粘贴的 TSV/CSV 零件清单。表头可中文；无表头时按固定列序。 */
export function parsePartText(
  text: string
): {
  rows: {
    code: string
    name: string
    lenMm: number
    widMm: number
    qty: number
    grain: string
    edges: string
    cabinet: string
    exposed: boolean
  }[]
  errors: string[]
} {
  const errors: string[] = []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return { rows: [], errors: ['没有可解析的内容'] }
  const splitLine = (l: string): string[] => {
    const sep = l.includes('\t') ? '\t' : l.includes(',') ? ',' : /[;；]/.test(l) ? /[;；]/.source : '\t'
    return l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''))
  }
  let startIdx = 0
  let cols: string[] = splitLine(lines[0]).map((c) => c.toLowerCase())
  const headerMap: Record<string, number> = {}
  const headerHints: Record<string, string[]> = {
    code: ['编号', '编码', '代码', 'code'],
    name: ['名称', '零件', 'name'],
    lenMm: ['长', '长度', 'len', 'length', 'l'],
    widMm: ['宽', '宽度', 'wid', 'width', 'w'],
    qty: ['数量', '数', 'qty', 'count', 'n'],
    grain: ['纹理', '纹路', 'grain'],
    edges: ['封边', '封边边', 'edge'],
    cabinet: ['柜体', '房间', '柜', 'cabinet'],
    exposed: ['见光', 'exposed']
  }
  const looksHeader = cols.some((c) => /长|len|length/.test(c))
  if (looksHeader) {
    startIdx = 1
    for (const key of Object.keys(headerHints)) {
      const idx = cols.findIndex((c) => headerHints[key].some((h) => c.includes(h.toLowerCase())))
      if (idx >= 0) headerMap[key] = idx
    }
  } else {
    ;['name', 'lenMm', 'widMm', 'qty', 'grain', 'edges', 'cabinet', 'exposed'].forEach(
      (k, i) => (headerMap[k] = i)
    )
  }
  const rows: {
    code: string
    name: string
    lenMm: number
    widMm: number
    qty: number
    grain: string
    edges: string
    cabinet: string
    exposed: boolean
  }[] = []
  lines.slice(startIdx).forEach((line, li) => {
    const c = splitLine(line)
    const get = (k: string): string => {
      const i = headerMap[k]
      return i === undefined || i >= c.length ? '' : c[i]
    }
    const lenMm = Number(get('lenMm'))
    const widMm = Number(get('widMm'))
    if (!lenMm || !widMm || lenMm <= 0 || widMm <= 0) {
      errors.push(`第 ${li + startIdx + 1} 行长宽无效，已跳过`)
      return
    }
    const qtyRaw = Number(get('qty'))
    const grainRaw = get('grain')
    const grain = /竖|长|length/.test(grainRaw)
      ? 'length'
      : /横|宽|width/.test(grainRaw)
        ? 'width'
        : 'none'
    const expRaw = get('exposed')
    rows.push({
      code: get('code'),
      name: get('name') || `零件${li + 1}`,
      lenMm,
      widMm,
      qty: qtyRaw > 0 ? Math.floor(qtyRaw) : 1,
      grain,
      edges: get('edges'),
      cabinet: get('cabinet') || '未分组',
      exposed: /是|true|1|y|见/.test(expRaw)
    })
  })
  return { rows, errors }
}

/** 把封边文本（如 上下 / TB / 1,3 / top,right / 左右）转成边集合。 */
export function parseEdges(text: string): ('top' | 'bottom' | 'left' | 'right')[] {
  const t = text.trim()
  if (!t || /^(无|none|0|-+)$/i.test(t)) return []
  const sides = new Set<'top' | 'bottom' | 'left' | 'right'>()
  for (const ch of t) {
    if (ch === '上' || ch === '顶') sides.add('top')
    if (ch === '下' || ch === '底') sides.add('bottom')
    if (ch === '左') sides.add('left')
    if (ch === '右') sides.add('right')
  }
  const tokens = t.toLowerCase().match(/\b(top|bottom|left|right|[tblr]|[1-4])\b/g) ?? []
  for (const tok of tokens) {
    if (tok === 'top' || tok === 't' || tok === '1') sides.add('top')
    if (tok === 'bottom' || tok === 'b' || tok === '2') sides.add('bottom')
    if (tok === 'left' || tok === 'l' || tok === '3') sides.add('left')
    if (tok === 'right' || tok === 'r' || tok === '4') sides.add('right')
  }
  return [...sides]
}
