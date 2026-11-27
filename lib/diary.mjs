/**
 * 深度记忆 · 日记（原始对话留底）
 *
 * 解决的问题：memory.jsonl 里的 node 是压缩后的摘要，换会话就回不到原话。
 * 这里按天从会话日志里抄一份「原话」，每条带锚点：
 *     <!-- src: session-<id>#seq=<seq> -->
 * 锚点能直接定位到 <DSH_HOME>\sessions\<工作区>\session-<id>\session.v4.jsonl.zstd
 * 里的那条记录（seq 字段），所以记忆可以点回证据。
 *
 * 只抄不改：用户与助手的可见文本，跳过 reasoning / tool / system。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

export const DIARY_DIR_NAME = '日记'

// 最近一次读取/解压失败的记录（软失败不再静默，供 /diary/status 暴露）
const readFailures = []
function noteFailure(log, e) {
  readFailures.push({ at: new Date().toISOString(), log, error: String(e && (e.code || e.message) || e) })
  if (readFailures.length > 20) readFailures.shift()
}
export function diaryHealth() {
  return { failures: readFailures.slice(-5), failureCount: readFailures.length }
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}
export function sessionsRoot() {
  return path.join(dshHome(), 'sessions')
}

/** 递归找 session.v4.jsonl.zstd（最多两层：工作区目录 / 会话目录）。 */
export function listSessionLogs(root = sessionsRoot()) {
  const out = []
  if (!fs.existsSync(root)) return out
  for (const ws of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue
    const wsDir = path.join(root, ws.name)
    for (const sd of safeReaddir(wsDir)) {
      const sessDir = path.join(wsDir, sd.name)
      const log = path.join(sessDir, 'session.v4.jsonl.zstd')
      if (fs.existsSync(log)) out.push({ workspace: ws.name, sessionDir: sd.name, log })
    }
  }
  return out
}
function safeReaddir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()) } catch { return [] }
}

// 会话日志是「一帧一条记录」的多帧 zstd。
// 宿主运行时 node 24.21 的 zstdDecompressSync/ZstdDecompress 都只解第一帧
// （9.7 MB 的日志只出 192 字节），24.22 才修好。这里自己找帧头逐帧解，
// 不依赖运行时版本：先扫 magic，再逐个贪心延长到能解出来为止。
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function decodeFrames(buf) {
  const offs = []
  let i = 0
  while (true) {
    const k = buf.indexOf(ZSTD_MAGIC, i)
    if (k < 0) break
    offs.push(k)
    i = k + 4
  }
  if (offs.length <= 1) return zlib.zstdDecompressSync(buf)
  const parts = []
  let cur = offs[0]
  let lost = 0
  for (let n = 1; n <= offs.length; n++) {
    const end = n < offs.length ? offs[n] : buf.length
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(cur, end)))
      cur = end
    } catch { lost++ }
  }
  if (lost && !parts.length) throw new Error('zstd 全部帧解不开：' + lost)
  return Buffer.concat(parts)
}

async function zstdAll(buf) {
  return decodeFrames(buf)
}

async function readRecords(log) {
  try {
    const raw = await zstdAll(fs.readFileSync(log))
    return raw.toString('utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch (e) {
    noteFailure(log, e)
    return []
  }
}

function textOf(parts) {
  if (!Array.isArray(parts)) return ''
  return parts.filter((p) => p && (p.type === 'text') && typeof p.text === 'string').map((p) => p.text).join('\n')
}

function dayKey(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function clock(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
export function todayKey(now = Date.now()) { return dayKey(now) }

/** 收集某一天的原话。date = 'YYYY-MM-DD'（本机时区）。 */
export async function collectDay(date) {
  let filtered = 0
  const [y, m, d] = String(date).split('-').map(Number)
  if (!y || !m || !d) throw new Error('日期格式应是 YYYY-MM-DD')
  const from = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  const to = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime()
  const sessions = []
  let total = 0
  for (const item of listSessionLogs()) {
    const records = await readRecords(item.log)
    if (!records.length) continue
    const head = records.find((r) => r.type === 'session') || {}
    const entries = []
    for (const r of records) {
      if (r.type !== 'user/message' && r.type !== 'assistant/message') continue
      const t = Number(r.time)
      if (!(t >= from && t < to)) continue
      const seq = Number(r.seq)
      let role = ''
      let text = ''
      if (r.type === 'user/message') {
        role = 'user'
        text = textOf(r.data?.content)
      } else {
        role = 'assistant'
        text = textOf(r.data?.message?.content)
      }
      text = String(text || '').replace(/\r\n/g, '\n').trim()
      if (!text) continue
      if (isInjected(text)) { filtered++; continue }
      entries.push({ at: t, clock: clock(t), role, seq, text })
    }
    if (!entries.length) continue
    entries.sort((a, b) => a.at - b.at)
    // 同一段话被反复注入时只留第一条
    const seenSig = new Set()
    const unique = []
    for (const e of entries) {
      const sig = `${e.role}:${e.text.replace(/\s+/g, '').slice(0, 90)}`
      if (seenSig.has(sig)) continue
      seenSig.add(sig)
      unique.push(e)
    }
    total += unique.length
    sessions.push({
      id: String(head.id || item.sessionDir),
      short: String(head.id || item.sessionDir).replace(/^session-/, '').slice(0, 8),
      cwd: String(head.cwd || ''),
      entries: unique,
    })
  }
  sessions.sort((a, b) => (a.entries[0]?.at || 0) - (b.entries[0]?.at || 0))
  return { date, sessions, messages: total, filtered }
}

const MAX_CHARS = 1200
const MAX_USER = 800
const MAX_ASSIST = 420

/** 明显是系统注入的片段（记忆检索、压缩摘要、角色卡模板、运行时上下文等）不进日记。 */
function isInjected(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (/^\[(记忆检索|Compressed conversation section|记忆卡|转发消息|会话令牌|bili\]|EAC design|统一人设卡)/i.test(t)) return true
  if (t.startsWith('<!--')) return true
  if (/^Current runtime context\./.test(t)) return true
  if (/^Time sampled while preparing turn/.test(t)) return true
  if (/^Browser time zone for this request/.test(t)) return true
  if (t.includes('［统一人设卡')) return true
  if (t.includes('Compressed conversation section') && t.includes('TASK AS OF THIS BLOCK')) return true
  // QQ 桥 / B 站调度器的注入提示：不是用户说的，别写进日记
  if (/^<system-reminder>/i.test(t)) return true
  if (t.includes('【当前时间】') && t.includes('Asia/Shanghai')) return true
  if (/【主动找主人[^】]*】/.test(t)) return true
  if (t.includes('【当前角色】') && t.includes('【你此刻的状态】')) return true
  if (/^【[^】]*(回合|目的|系统)[^】]*】/.test(t)) return true
  return false
}

function clipText(text, role = 'user') {
  const t = String(text || '').replace(/\r\n/g, '\n').trim()
  const max = role === 'assistant' ? MAX_ASSIST : MAX_USER
  if (t.length <= max) return t
  return t.slice(0, max).trimEnd() + `…（原话 ${t.length} 字）`
}

/** 渲染成 markdown。 */
export function renderDay(day) {
  const lines = []
  lines.push(`# ${day.date} 日记`)
  lines.push('')
  lines.push(`> 深度记忆自动抄录的原话留底：共 ${day.sessions.length} 个会话、${day.messages} 条消息。`)
  lines.push('> 只摘原文，不改写。锚点 \`session-xxxxxxxx#seq=NNN\` 定位到 \`%DSH_HOME%\\sessions\\<工作区>\\<会话>\\session.v4.jsonl.zstd\`。')
  lines.push('')
  for (const s of day.sessions) {
    const title = `${s.short}${s.cwd ? ' · ' + s.cwd : ''}`
    lines.push(`## 会话 ${title}`)
    lines.push('')
    for (const e of s.entries) {
      const who = e.role === 'user' ? '她' : '我'
      const body = clipText(e.text, e.role).split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
      if (!body) continue
      lines.push(`- **${e.clock} ${who}**：${body}`)
      lines.push(`  <!-- src: ${s.id}#seq=${e.seq} -->`)
    }
    lines.push('')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function indexFile(root) {
  return path.join(root, DIARY_DIR_NAME, 'index.json')
}
function readIndex(root) {
  try { return JSON.parse(fs.readFileSync(indexFile(root), 'utf8')) } catch { return { version: 1, days: [] } }
}
function writeIndex(root, idx) {
  fs.mkdirSync(path.join(root, DIARY_DIR_NAME), { recursive: true })
  fs.writeFileSync(indexFile(root), JSON.stringify(idx, null, 2) + '\n', 'utf8')
}

/** 写一天的日记。force=false 且文件已存在则跳过（除非有新消息）。 */
export async function writeDay(root, date, { force = false, allowShrink = false } = {}) {
  const day = await collectDay(date)
  const dir = path.join(root, DIARY_DIR_NAME)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${date}.md`)
  const idx = readIndex(root)
  const known = idx.days.find((x) => x.date === date)
  // 一条都没抄到时不覆盖已有内容（会话日志还没落盘 / DSH_HOME 指偏了都可能出现 0）
  if (!day.messages && fs.existsSync(file) && fs.statSync(file).size > 0) {
    return { ok: true, skipped: true, date, file, messages: 0, sessions: 0 }
  }
  // 只增不减：新抄到的比文件里已有的少（当天日志还没落盘），保留原文件。
  // 例外：减少的部分若能由「本次过滤掉的注入」解释，就允许写入（会记一条日志）。
  const explained = day.messages + (day.filtered || 0) >= (known ? known.messages : 0)
  if (!allowShrink && !explained && fs.existsSync(file) && known && day.messages < known.messages) {
    return { ok: true, skipped: true, date, file, messages: known.messages, sessions: known.sessions }
  }
  if (!force && !explained && fs.existsSync(file) && known && known.messages >= day.messages) {
    return { ok: true, skipped: true, date, file, messages: day.messages, sessions: day.sessions.length }
  }
  if (known && day.messages < known.messages) {
    try { console.log('[deep-memory] 日记 ' + date + '：' + known.messages + ' → ' + day.messages + ' 条（过滤掉 ' + (day.filtered || 0) + ' 条注入）') } catch {}
  }
  const md = renderDay(day)
  fs.writeFileSync(file, md, 'utf8')
  const entry = {
    date,
    file: path.relative(root, file).replace(/\\/g, '/'),
    sessions: day.sessions.length,
    messages: day.messages,
    bytes: Buffer.byteLength(md, 'utf8'),
    updatedAt: new Date().toISOString(),
  }
  idx.version = 1
  idx.days = (idx.days || []).filter((x) => x.date !== date).concat(entry).sort((a, b) => a.date.localeCompare(b.date))
  writeIndex(root, idx)
  return { ok: true, skipped: false, ...entry }
}

export function listDays(root) {
  const idx = readIndex(root)
  return (idx.days || []).slice().sort((a, b) => b.date.localeCompare(a.date))
}

export function readDay(root, date) {
  const file = path.join(root, DIARY_DIR_NAME, `${date}.md`)
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf8')
}

/** 从日记里抓一段原话（按锚点或关键词），给检索用。 */
export function searchDiary(root, query, { limit = 20 } = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  const out = []
  for (const d of listDays(root)) {
    const md = readDay(root, d.date)
    if (!md) continue
    const lines = md.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(q)) continue
      const anchor = (lines[i + 1] || '').match(/src:\s*(\S+)/)
      out.push({ date: d.date, line: lines[i].trim().slice(0, 400), src: anchor ? anchor[1] : '' })
      if (out.length >= limit) return out
    }
  }
  return out
}

/** 把某天的用户原话变成记忆节点（带 src 锚点），去重后追加。 */
export function diaryNodes(day, { onlyUser = true, max = 40, layer = 'L3', region = 'daily' } = {}) {
  const nodes = []
  for (const s of day.sessions) {
    for (const e of s.entries) {
      if (onlyUser && e.role !== 'user') continue
      const text = String(e.text || '').trim()
      if (text.length < 6) continue
      nodes.push({
        text: text.slice(0, 2000),
        title: `${day.date} ${e.clock} ${e.role === 'user' ? '她' : '我'}`,
        layer,
        region,
        tags: ['日记', day.date],
        source: `${DIARY_DIR_NAME}/${day.date}.md`,
        src: { session: s.id, seq: e.seq, at: e.at, role: e.role, diary: `${DIARY_DIR_NAME}/${day.date}.md` },
      })
      if (nodes.length >= max) return nodes
    }
  }
  return nodes
}
