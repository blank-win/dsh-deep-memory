/**
 * 深度记忆 · 记忆核心（memory-node@1）
 *
 * 目标模型来自《两套记忆系统的对比》里的「本系统」：
 *   · Markdown + JSONL，词法检索，不引入 SQLite / 语义向量
 *   · L0–L5、8 分区、分舱 top-2、六位卦象、衰减、晋升、flash
 *   · 只产草稿/差异，不自动改写长期记忆
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const VERSION = 'memory-node@1'
export const LAYERS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']
export const REGIONS = ['core', 'relationship', 'daily', 'expression', 'work', 'world', 'dream', 'flash']
export const CELL_K = 8
export const CELL_TOPK = 2
export const DEDUP_THRESHOLD = 0.92
export const PROMOTE_IMPORTANT = 4
export const PROMOTE_CORE = 12
export const TAU = { L0: 36500, L1: 36500, L2: 30, L3: 7, L4: 7, L5: 7 }

export const VIEW_FILES = [
  '00-醒来先读我.md',
  '01-关于她.md',
  '02-关系.md',
  '03-日常.md',
  '04-表达.md',
  '05-对话摘要.md',
  '06-偏好.md',
  '07-会话脉络.md',
  '08-长期记忆.md',
  '09-索引.md',
]

function sha(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex')
}
function shortHash(text) { return sha(text).slice(0, 16) }
function clip(text, n = 4000) { return String(text || '').replace(/\r\n/g, '\n').trim().slice(0, n) }

export function bigrams(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, '')
  const out = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}
function vector(text) {
  const v = new Map()
  for (const g of bigrams(text)) v.set(g, (v.get(g) || 0) + 1)
  let norm = 0
  for (const n of v.values()) norm += n * n
  norm = Math.sqrt(norm) || 1
  for (const [k, n] of v) v.set(k, n / norm)
  return v
}
function cosine(a, b) {
  const va = vector(a), vb = vector(b)
  let dot = 0
  for (const [k, n] of va) dot += n * (vb.get(k) || 0)
  return dot
}
function jaccard(a, b) {
  const A = new Set(bigrams(a)), B = new Set(bigrams(b))
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter || 1)
}
/** 文档里的 0.65 余弦 + 0.35 Jaccard；这里的余弦是字符 bigram 词法向量。 */
export function similarity(a, b) {
  if (!a || !b) return 0
  return 0.65 * cosine(a, b) + 0.35 * jaccard(a, b)
}

export function cellOf(node) {
  const basis = [node.region, ...(node.tags || [])].join('|')
  return `cell-${parseInt(sha(basis).slice(0, 8), 16) % CELL_K}`
}
export function hexagramOf(text) {
  const n = parseInt(sha(text).slice(0, 8), 16)
  return n.toString(2).padStart(32, '0').slice(0, 6)
}
function hexFactor(a, b) {
  if (!a || !b) return 1
  if (a === b) return 1
  let same = 0
  for (let i = 0; i < 6; i++) if (a[i] === b[i]) same++
  if (same >= 4) return 0.86
  if (same >= 2) return 0.72
  return 0.6
}

export function makeNode(input = {}) {
  const text = clip(input.text)
  if (!text) throw new Error('text is required')
  const layer = LAYERS.includes(input.layer) ? input.layer : 'L2'
  const region = REGIONS.includes(input.region) ? input.region : 'daily'
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : []
  const now = input.createdAt || new Date().toISOString()
  const node = {
    schema: VERSION,
    id: input.id || shortHash(`${input.viewFile || ''}\n${layer}\n${region}\n${tags.join(',')}\n${text}`),
    viewFile: input.viewFile || '',
    title: String(input.title || '').slice(0, 160),
    text,
    layer, region, tags,
    weight: Number(input.weight) || 1,
    hits: Number(input.hits) || 0,
    important: input.important === true,
    pinned: input.pinned === true,
    flash: region === 'flash' || input.flash === true,
    createdAt: now,
    updatedAt: input.updatedAt || now,
    validUntil: input.validUntil || null,
    supersededBy: input.supersededBy || null,
    source: input.source || '',
    workspaceKey: input.workspaceKey || 'global',
    device: input.device || '',
    rev: Number(input.rev) || 1,
    deleted: input.deleted === true,
    isNew: input.isNew !== false,
  }
  node.cell = input.cell || cellOf(node)
  node.hexagram = input.hexagram || hexagramOf(node.text)
  return node
}

export function tauFor(layer) { return TAU[layer] || 30 }
export function decay(node, now = Date.now()) {
  if (node.flash) return 1
  const t = Date.parse(node.updatedAt || node.createdAt || 0)
  const days = Math.max(0, (now - (Number.isNaN(t) ? now : t)) / 86400000)
  return Math.exp(-days / tauFor(node.layer))
}

/** 晋升只看命中次数，不自动合并、不自动改写文本。 */
export function promote(node) {
  if (node.flash) return { node, changed: false }
  const hits = Number(node.hits) || 0
  let changed = false
  if (hits >= PROMOTE_CORE) {
    if (node.layer !== 'L0' || node.region !== 'core' || !node.pinned) {
      node.layer = 'L0'; node.region = 'core'; node.pinned = true; changed = true
    }
  } else if (hits >= PROMOTE_IMPORTANT && !['L0', 'L1'].includes(node.layer)) {
    node.layer = 'L1'; node.important = true; changed = true
  }
  if (changed) node.updatedAt = new Date().toISOString()
  return { node, changed }
}

export function buildIndex(nodes) {
  const cells = new Map()
  for (let i = 0; i < CELL_K; i++) cells.set(`cell-${i}`, [])
  for (const n of nodes) {
    if (n.deleted) continue
    if (!n.cell) n.cell = cellOf(n)
    if (!cells.has(n.cell)) cells.set(n.cell, [])
    cells.get(n.cell).push(n)
  }
  return { version: VERSION, cells, nodes: nodes.length }
}

/**
 * 分舱检索：查询向量找 top-2 舱；未入舱的新节点一律放行。
 * 分数 = (0.65 余弦 + 0.35 Jaccard) × 衰减 × 卦象系数。
 */
export function retrieve(nodes, query, { topK = 8, now = Date.now(), index = null } = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return []
  const idx = index || buildIndex(nodes)
  const q = String(query || '').trim()
  if (!q) {
    return [...nodes]
      .sort((a, b) => (Number(b.weight) || 1) * decay(b, now) - (Number(a.weight) || 1) * decay(a, now))
      .slice(0, topK)
      .map((node) => ({ node, score: Number(node.weight) || 1 }))
  }

  const cellScores = [...idx.cells.entries()].map(([cell, list]) => ({
    cell,
    score: list.length ? similarity(q, list.map((n) => n.text).join('\n')) : 0,
  })).sort((a, b) => b.score - a.score)
  const topCells = new Set(cellScores.slice(0, CELL_TOPK).map((x) => x.cell))

  const candidates = nodes.filter((n) => !n.deleted && (n.isNew || n.flash || topCells.has(n.cell)))
  const hex = hexagramOf(q)
  const scored = candidates.map((n) => {
    const base = 0.65 * cosine(q, n.text) + 0.35 * jaccard(q, n.text)
    const score = base * decay(n, now) * hexFactor(hex, n.hexagram) * (Number(n.weight) || 1)
    return { node: n, score }
  }).sort((a, b) => b.score - a.score)

  const seen = new Set()
  const out = []
  for (const hit of scored) {
    if (seen.has(hit.node.id)) continue
    seen.add(hit.node.id)
    out.push(hit)
    if (out.length >= topK) break
  }
  return out
}

/** 只报告相似对，不自动合并。 */
export function findDuplicates(nodes, threshold = DEDUP_THRESHOLD) {
  const out = []
  const list = nodes.filter((n) => !n.flash)
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const s = similarity(list[i].text, list[j].text)
      if (s >= threshold) out.push({ a: list[i].id, b: list[j].id, score: s })
    }
  }
  return out
}

export function loadJsonl(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return makeNode({ ...JSON.parse(line), isNew: false }) } catch { return null }
  }).filter(Boolean)
}

export function appendJsonl(file, nodes) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lines = nodes.map((n) => JSON.stringify(n)).join('\n')
  if (lines) fs.appendFileSync(file, lines + '\n', 'utf8')
}

export function writeJsonl(file, nodes) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, nodes.map((n) => JSON.stringify(n)).join('\n') + '\n', 'utf8')
}

function splitSections(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const sections = []
  let title = ''
  let buf = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) sections.push({ title, text })
    buf = []
  }
  for (const line of lines) {
    const h = line.match(/^##\s+(.+)/)
    if (h) { flush(); title = h[1].trim() } else if (/^#\s+/.test(line)) { continue } else buf.push(line)
  }
  flush()
  return sections
}

const FILE_META = {
  '00-醒来先读我.md': { layer: 'L0', region: 'core', view: '00' },
  '01-主人档案.md': { layer: 'L1', region: 'relationship', view: '01' },
  '02-关系.md': { layer: 'L1', region: 'relationship', view: '02' },
  '03-日常.md': { layer: 'L2', region: 'daily', view: '03' },
  '04-表达.md': { layer: 'L4', region: 'expression', view: '04' },
  '05-对话摘要.md': { layer: 'L3', region: 'work', view: '05' },
  '06-偏好.md': { layer: 'L2', region: 'daily', view: '06' },
  '07-会话脉络.md': { layer: 'L4', region: 'daily', view: '07' },
  '08-长期记忆.md': { layer: 'L2', region: 'daily', view: '08' },
}

/** 把现有 Markdown 记忆库解析成节点；不修改原文件。 */
export function parseLibrary(root) {
  const nodes = []
  const warnings = []
  for (const [file, meta] of Object.entries(FILE_META)) {
    const full = path.join(root, file)
    if (!fs.existsSync(full)) { warnings.push(`缺文件：${file}`); continue }
    const md = fs.readFileSync(full, 'utf8')
    if (file === '08-长期记忆.md') {
      // 08 按日期与条目拆分，每条独立成节点
      let date = ''
      const entries = []
      let cur = null
      for (const line of md.split(/\r?\n/)) {
        const d = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/)
        if (d) { date = d[1]; continue }
        const e = line.match(/^- \*\*(.+?)\*\*\s*$/)
        if (e) {
          if (cur) entries.push(cur)
          cur = { title: e[1], body: [], date }
        } else if (cur) {
          cur.body.push(line)
        }
      }
      if (cur) entries.push(cur)
      for (const e of entries) {
        const text = [e.title, ...e.body].join('\n').trim()
        if (!text) continue
        nodes.push(makeNode({
          viewFile: meta.view, title: e.title, text,
          layer: meta.layer, region: meta.region,
          tags: ['08', ...(date ? [date] : [])],
          createdAt: e.date ? new Date(e.date + 'T00:00:00+08:00').toISOString() : new Date().toISOString(),
          source: file,
        }))
      }
      continue
    }
    const sections = splitSections(md)
    if (sections.length === 0) {
      nodes.push(makeNode({ viewFile: meta.view, title: file, text: md, layer: meta.layer, region: meta.region, tags: [meta.view], source: file }))
    } else {
      for (const s of sections) {
        nodes.push(makeNode({
          viewFile: meta.view, title: s.title || file, text: s.text,
          layer: meta.layer, region: meta.region,
          tags: [meta.view, ...(s.title ? [s.title] : [])],
          source: file,
        }))
      }
    }
  }
  return { nodes, warnings }
}

function renderView(nodes, view, title) {
  const list = nodes.filter((n) => n.viewFile === view)
  const lines = [`# ${title}`, '', `> 从 memory.jsonl 生成的视图；原文件保留。`, '']
  for (const n of list) {
    lines.push(`## ${n.title || n.id}`)
    lines.push(`- id: \`${n.id}\` · ${n.layer} · ${n.region} · cell ${n.cell} · hex ${n.hexagram} · hits ${n.hits}`)
    lines.push(n.text)
    lines.push('')
  }
  return lines.join('\n')
}

export function renderViews(nodes) {
  return {
    '00-醒来先读我.md': renderView(nodes, '00', '00 · 醒来先读我（视图）'),
    '01-关于她.md': renderView(nodes, '01', '01 · 关于她（视图）'),
    '02-关系.md': renderView(nodes, '02', '02 · 关系（视图）'),
    '03-日常.md': renderView(nodes, '03', '03 · 日常（视图）'),
    '04-表达.md': renderView(nodes, '04', '04 · 表达（视图）'),
    '05-对话摘要.md': renderView(nodes, '05', '05 · 对话摘要（视图）'),
    '06-偏好.md': renderView(nodes, '06', '06 · 偏好（视图）'),
    '07-会话脉络.md': renderView(nodes, '07', '07 · 会话脉络（视图）'),
    '08-长期记忆.md': renderView(nodes, '08', '08 · 长期记忆（视图）'),
  }
}
