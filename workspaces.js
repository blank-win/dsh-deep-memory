import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json')
const PROJ = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const POLICY_DIR = path.join(DSH_HOME, 'deep-memory')
const POLICY_FILE = path.join(POLICY_DIR, 'workspaces.json')
const HANDOFF_DIR = path.join(POLICY_DIR, 'handoffs')
const MEMORY_HINTS = [
  path.join(os.homedir(), 'DeepMemory'),
  path.join(os.homedir(), 'DeepMemory'),
]

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}
function policyAll() {
  const j = readJson(POLICY_FILE, { version: 1, workspaces: {} })
  if (!j.workspaces || typeof j.workspaces !== 'object') j.workspaces = {}
  return j
}
function policyFor(p) {
  return policyAll().workspaces[p] || {
    mode: 'off', maxSurfaceTokens: 200000, maxAgeDays: 7,
    minIdleMs: 1800000, offPeakOnly: true, keepOld: true,
  }
}
function firstSessionId(value) {
  if (Array.isArray(value)) return String(value[0] || '')
  return String(value || '').split(',')[0].trim()
}
function sessionMetrics(sessionId) {
  if (!sessionId) return { surface: 0, pressure: 0, ageDays: 0, lastMessageAt: 0, turns: [] }
  const p = path.join(PROJ, `${sessionId}.json`)
  const j = readJson(p, null)
  const rows = j?.record?.rows || {}
  const cp = rows.contextPressure?.val || {}
  const id = j?.record?.identity || {}
  const stat = rows.sessionStats?.val || {}
  const turns = rows.turnOutline?.val?.turns || []
  const lastMessageAt = Number(rows.timeContext?.val?.lastMessageTime || 0)
  const ageDays = id.createdAt ? Math.max(0, (Date.now() - Number(id.createdAt)) / 86400000) : 0
  return {
    surface: Number(cp.surfaceTokens) || 0,
    pressure: Number(cp.pressureTokens) || 0,
    ageDays,
    lastMessageAt,
    turns: Array.isArray(turns) ? turns : [],
    turnsCount: Number(stat.turns) || 0,
  }
}
function workspaceRows() {
  const store = readJson(WORKSPACE_STORE, null)
  const table = store?.tables?.workspaces || {}
  const out = []
  for (const [id, w] of Object.entries(table)) {
    const p = String(w?.path || '')
    if (!p) continue
    const sid = firstSessionId(w?.sessionIds)
    const m = sessionMetrics(sid)
    out.push({
      id, path: p, title: String(w?.title || p),
      sessionId: sid,
      sessionIds: Array.isArray(w?.sessionIds) ? w.sessionIds.map(String) : (sid ? [sid] : []),
      surface: m.surface, pressure: m.pressure,
      ageDays: Number(m.ageDays.toFixed(2)), lastMessageAt: m.lastMessageAt,
      turns: m.turnsCount, turnList: m.turns.slice(0, 3), policy: policyFor(p),
    })
  }
  return out
}

function isPeakNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const wd = d.getUTCDay()
  const h = d.getUTCHours()
  return wd >= 1 && wd <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18))
}

function safeName(s) {
  return String(s || 'workspace').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60)
}

export function listWorkspaces() {
  return { ok: true, workspaces: workspaceRows(), policyFile: POLICY_FILE, handoffDir: HANDOFF_DIR }
}

export function workspaceBySession(sessionId) {
  const id = String(sessionId || '')
  return workspaceRows().find((x) => x.sessionId === id || (Array.isArray(x.sessionIds) && x.sessionIds.includes(id))) || null
}

export function setPolicy(patch = {}) {
  const p = String(patch.path || '')
  if (!p) throw new Error('缺少工作区路径')
  const mode = ['off', 'summary', 'next-open'].includes(patch.mode) ? patch.mode : 'off'
  const j = policyAll()
  const prev = j.workspaces[p] || {}
  j.workspaces[p] = {
    ...prev,
    mode,
    maxSurfaceTokens: Math.max(10000, Number(patch.maxSurfaceTokens) || prev.maxSurfaceTokens || 200000),
    maxAgeDays: Math.max(1, Number(patch.maxAgeDays) || prev.maxAgeDays || 7),
    minIdleMs: Math.max(60000, Number(patch.minIdleMs) || prev.minIdleMs || 1800000),
    offPeakOnly: patch.offPeakOnly === undefined ? (prev.offPeakOnly !== false) : patch.offPeakOnly !== false,
    keepOld: true,
  }
  writeJson(POLICY_FILE, j)
  return { ok: true, path: p, policy: j.workspaces[p] }
}

export function makeHandoff(workspacePath, { auto = false } = {}) {
  const row = workspaceRows().find((x) => x.path === workspacePath)
  if (!row) throw new Error('工作区不在 DSH registry 里：' + workspacePath)
  fs.mkdirSync(HANDOFF_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  const file = path.join(HANDOFF_DIR, `${safeName(row.title)}-${stamp}.md`)
  const memory = MEMORY_HINTS.find((p) => fs.existsSync(p)) || MEMORY_HINTS[0]
  const last = (row.turnList || []).slice(0, 3)
  const lines = [
    '# 工作区交接',
    '',
    `- 工作区：${row.path}`,
    `- 标题：${row.title}`,
    `- 完成时间：${new Date().toLocaleString('zh-CN')}`,
    `- 旧 session：${row.sessionId || '（无）'}`,
    `- 上下文：surface ${row.surface} / pressure ${row.pressure} / 年龄 ${row.ageDays} 天`,
    `- 方式：${auto ? '自动阈值' : '手动'}`,
    '',
    '## 新会话先读',
    `- 记忆库：${memory}`,
    '- 先读 `00-醒来先读我.md`、`05-对话摘要.md`、`07-会话脉络.md`；需要细节再按 `09-索引` 翻 `08`。',
    '- 旧会话未确认的事，不要当成已经完成；先看当前文件和未读消息。',
    '',
  ]
  if (last.length) {
    lines.push('## 旧会话最后几轮（机械摘要，不是全文）')
    for (const t of last) {
      lines.push(`### 第 ${t.turn ?? '?'} 轮`)
      lines.push('用户：' + String(t.prompt || '').replace(/\s+/g, ' ').slice(0, 300))
      lines.push('我：' + String(t.response || '').replace(/\s+/g, ' ').slice(0, 500))
      lines.push('')
    }
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf8')
  const j = policyAll()
  const pol = j.workspaces[workspacePath] || policyFor(workspacePath)
  pol.lastHandoffAt = new Date().toISOString()
  pol.lastHandoffSession = row.sessionId
  if (pol.mode === 'next-open') pol.pendingNextOpen = true
  j.workspaces[workspacePath] = pol
  writeJson(POLICY_FILE, j)
  return { ok: true, file, workspace: row.title, sessionId: row.sessionId, auto }
}

let timer = null
export function startWatcher(log = () => {}) {
  if (timer) return () => {}
  timer = setInterval(() => {
    try {
      for (const row of workspaceRows()) {
        const p = row.policy
        if (p.mode === 'off') continue
        if (p.lastHandoffSession && p.lastHandoffSession === row.sessionId) continue
        if (p.offPeakOnly !== false && isPeakNow()) continue
        if (p.minIdleMs && row.lastMessageAt && Date.now() - row.lastMessageAt < p.minIdleMs) continue
        if (row.surface < (p.maxSurfaceTokens || 200000) && row.ageDays < (p.maxAgeDays || 7)) continue
        const r = makeHandoff(row.path, { auto: true })
        log(`[handoff] ${row.title} → ${r.file}`)
      }
    } catch (e) { log(`[handoff] 检查失败：${e.message}`) }
  }, 60 * 1000)
  timer.unref?.()
  return () => { if (timer) { clearInterval(timer); timer = null } }
}
