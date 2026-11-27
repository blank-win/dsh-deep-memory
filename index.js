import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listWorkspaces, setPolicy, makeHandoff, startWatcher, workspaceBySession } from './workspaces.js'
import { loadJsonl, buildIndex, retrieve, findDuplicates, makeNode, appendJsonl, VERSION as MEMORY_VERSION } from './lib/memory-core.mjs'
import { writeDay, listDays, readDay, searchDiary, collectDay, diaryNodes, todayKey, DIARY_DIR_NAME, diaryHealth } from './lib/diary.mjs'
import { loadSyncConfig, initSync, exportDelta, importIncoming, importBundleDir, syncStatus, CONFIG_FILE as SYNC_CONFIG } from './lib/memory-sync.mjs'
import { initLibrary, TEMPLATE_FILES } from './lib/library-template.mjs'
import { migrateLibrary } from './lib/library-migrate.mjs'
import { ensureWiki, listPages, readPage, writePage, rebuildIndex, makeMaterial, listMaterials, wikiHealth, WIKI_DIR, INDEX_NAME } from './lib/wiki.mjs'
// 小屋页面是可选模块：没有 lib/room.mjs 时插件照常工作，只是不注册 /room 路由。
let handleRoom = null
try { ({ handleRoom } = await import('./lib/room.mjs')) } catch {}

export const name = 'deep-memory'
export const inject = ['webServer', 'sessionController', 'workspaceRegistry', 'clientModules']

const execFileAsync = promisify(execFile)
let runtimeCtx = null
let clientLoaded = null
const clientEvents = []
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PREFIX = '/dsh-deep-memory/api'
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DEFAULT_MEMORY_ROOT = path.join(os.homedir(), 'DeepMemory')
const LIBRARY_CONFIG = path.join(DSH_HOME, 'deep-memory', 'library.json')
function memoryRoot() {
  try {
    const j = JSON.parse(fs.readFileSync(LIBRARY_CONFIG, 'utf8'))
    if (typeof j.root === 'string' && j.root.trim()) return j.root
  } catch {}
  return DEFAULT_MEMORY_ROOT
}
function readLibraryConfig() {
  try { return JSON.parse(fs.readFileSync(LIBRARY_CONFIG, 'utf8')) || {} } catch { return {} }
}
function setMemoryRoot(root) {
  const old = memoryRoot()
  const cfg = readLibraryConfig()
  const prev = new Set(Array.isArray(cfg.previousRoots) ? cfg.previousRoots : [])
  if (old && old !== root) prev.add(old)
  prev.delete(root)
  fs.mkdirSync(path.dirname(LIBRARY_CONFIG), { recursive: true })
  fs.writeFileSync(LIBRARY_CONFIG, JSON.stringify({
    version: 1, root, previousRoots: [...prev],
    workspaces: Array.isArray(cfg.workspaces) ? cfg.workspaces : [],
  }, null, 2) + '\n', 'utf8')
}
function previousLibraryRoots() {
  const cfg = readLibraryConfig()
  const current = memoryRoot()
  return (Array.isArray(cfg.previousRoots) ? cfg.previousRoots : [])
    .filter((p) => typeof p === 'string' && p && p !== current)
}
const LIBRARY_NAMES = new Set([
  ...Object.keys(TEMPLATE_FILES), 'memory.jsonl', 'views', 'migration-report.json',
])
function libraryCleanupPreview(target) {
  const current = memoryRoot()
  if (!target) throw new Error('缺少旧目录路径')
  if (path.resolve(target) === path.resolve(current)) throw new Error('不能清理当前正在使用的目录')
  if (!previousLibraryRoots().some((p) => path.resolve(p) === path.resolve(target))) throw new Error('这不是记录中的旧记忆库目录')
  if (!fs.existsSync(target)) return { target, exists: false, files: [], unknown: [], safe: false }
  const entries = fs.readdirSync(target, { withFileTypes: true })
  const files = entries.filter((x) => LIBRARY_NAMES.has(x.name)).map((x) => x.name)
  const unknown = entries.filter((x) => !LIBRARY_NAMES.has(x.name)).map((x) => x.name)
  const safe = files.length >= 2
  return { target: path.resolve(target), exists: true, files, unknown, safe }
}
function cleanupLibrary(target, apply = false) {
  const preview = libraryCleanupPreview(target)
  if (!apply || !preview.exists) return { ok: true, dry: !apply, ...preview }
  if (!preview.safe) throw new Error('旧目录不像记忆库（少于 2 个记忆库文件），拒绝清理')
  const quarantine = path.join(DSH_HOME, 'deep-memory', 'trash', `old-library-${Date.now()}`)
  fs.mkdirSync(quarantine, { recursive: true })
  const moved = [], failed = []
  for (const name of preview.files) {
    const src = path.join(preview.target, name)
    const dst = path.join(quarantine, name)
    try {
      fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false })
      fs.rmSync(src, { recursive: true, force: true })
      moved.push(name)
    } catch (e) { failed.push({ name, error: e.message }) }
  }
  let removedDir = false
  if (!preview.unknown.length && failed.length === 0) {
    try { fs.rmdirSync(preview.target); removedDir = true } catch {}
  }
  if (!failed.length) {
    const cfg = readLibraryConfig()
    cfg.previousRoots = (cfg.previousRoots || []).filter((p) => path.resolve(p) !== preview.target)
    fs.writeFileSync(LIBRARY_CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  }
  return { ok: true, dry: false, ...preview, quarantine, moved, failed, removedDir, oldKept: !removedDir }
}
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const LOCAL_SEND_PAGE = 'https://localsend.org/'
const LOCAL_SEND_CONFIG = path.join(DSH_HOME, 'deep-memory', 'local-send.json')
function readLocalSendConfig() {
  try { return JSON.parse(fs.readFileSync(LOCAL_SEND_CONFIG, 'utf8')) || {} } catch { return {} }
}
function selectedLocalSendPath() {
  const p = String(readLocalSendConfig().path || '').trim()
  return p && fs.existsSync(p) ? p : ''
}
function localSendKind(p) { return /cli/i.test(path.basename(String(p || ''))) ? 'cli' : 'gui' }

function localSendCandidates() {
  const out = { gui: [], cli: [] }
  const chosen = selectedLocalSendPath()
  if (chosen) (localSendKind(chosen) === 'cli' ? out.cli : out.gui).push(chosen)
  for (const p of [process.env.LOCALSEND_GUI, 'C:\\Program Files\\LocalSend\\localsend_app.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'LocalSend', 'localsend_app.exe')]) if (p) out.gui.push(p)
  for (const p of [process.env.LOCALSEND_CLI]) if (p) out.cli.push(p)
  return out
}
function firstExisting(list) { for (const p of list) { try { if (p && fs.existsSync(p)) return p } catch {} } return null }
async function findLocalSendCli() {
  const found = firstExisting(localSendCandidates().cli)
  if (found) return found
  try {
    const r = await execFileAsync('where.exe', ['localsend-cli.exe'], { windowsHide: true, encoding: 'utf8' })
    const first = String(r.stdout || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean)
    if (first && fs.existsSync(first)) return first
  } catch {}
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
    for (const d of fs.readdirSync(base)) {
      if (!/^LocalSend\.LocalSend\.CLI/i.test(d)) continue
      const pkg = path.join(base, d)
      const direct = path.join(pkg, 'localsend-cli.exe')
      if (fs.existsSync(direct)) return direct
      const hit = fs.readdirSync(pkg).map((x) => path.join(pkg, x, 'localsend-cli.exe')).find((x) => fs.existsSync(x))
      if (hit) return hit
    }
  } catch {}
  return null
}
function launchConsole(title, exe, args) {
  const line = ['/c', 'start', '', title, exe, ...args].map((x) => String(x))
  return execFileAsync('cmd.exe', line, { windowsHide: false, timeout: 15000 }).catch(() => null)
}


function json(res, status, obj) {
  const body = JSON.stringify(obj)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(body)
}

function isLoopback(req) {
  const a = String(req.socket?.remoteAddress || '')
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch { reject(new Error('JSON 格式错误')) }
    })
    req.on('error', reject)
  })
}

async function run(cmd, args, timeout = 180000) {
  const r = await execFileAsync(cmd, args, {
    cwd: DSH_HOME,
    timeout,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    encoding: 'utf8',
  })
  return String(r.stdout || '') + (r.stderr ? `\n${r.stderr}` : '')
}

async function openPath(target) {
  const p = path.resolve(String(target || ''))
  if (!fs.existsSync(p)) throw new Error('目录不存在：' + p)
  if (process.platform === 'win32') await execFileAsync('explorer.exe', [p], { windowsHide: true })
  else if (process.platform === 'darwin') await execFileAsync('open', [p])
  else await execFileAsync('xdg-open', [p])
  return p
}

// 桌面搬家包路径（和面板 ExportMoveBundle 的落点一致）
function moveBundlePath() {
  const home = process.env.USERPROFILE || os.homedir()
  return path.join(home, 'Desktop', '\u642c\u5bb6\u5305.zip')
}

function statusPayload() {
  return {
    ok: true,
    dshHome: DSH_HOME,
    clientLoaded,
    clientEvents: clientEvents.slice(-20),
  }
}

async function handoffAndRotate(sessionId) {
  let row = workspaceBySession(sessionId)
  if (!row) {
    try {
      const list = runtimeCtx?.workspaceRegistry?.list?.() || []
      const w = list.find((x) => Array.isArray(x.sessionIds) && x.sessionIds.includes(sessionId))
      if (w) row = { id: w.id, path: w.path, title: w.title, sessionId }
    } catch {}
  }
  if (!row) {
    // 新会话可能还没写进 workspace store；用插件进程工作目录做最后兜底。
    try {
      const cwd = path.resolve(process.cwd())
      const w = listWorkspaces().workspaces.find((x) => path.resolve(x.path) === cwd)
      if (w) row = { id: w.id, path: w.path, title: w.title, sessionId }
    } catch {}
  }
  if (!row) throw new Error('找不到这个 session 对应的工作区')
  const handoff = makeHandoff(row.path, { auto: false })
  if (!runtimeCtx) throw new Error('插件上下文还没准备好')
  const sc = runtimeCtx.sessionController || runtimeCtx.get?.('sessionController')
  if (!sc?.create) throw new Error('DSH sessionController 不可用')
  const created = await sc.create({ workspaceId: row.id })
  const newId = created?.sessionId || created?.id
  if (!newId) throw new Error('新会话已请求，但没有返回 sessionId')
  let archived = false
  const reg = runtimeCtx.workspaceRegistry || runtimeCtx.get?.('workspaceRegistry')
  if (reg?.archiveSession) {
    try {
      await reg.archiveSession(sessionId, { stopActivity: true })
      archived = true
    } catch (e) {
      return { ok: true, archived: false, warning: '新会话已建，但旧会话归档失败：' + e.message, newSessionId: newId, handoff: handoff.file, workspace: row.title }
    }
  }
  return { ok: true, archived, newSessionId: newId, handoff: handoff.file, workspace: row.title }
}

function memoryNodes() {
  return loadJsonl(path.join(memoryRoot(), 'memory.jsonl'))
}

async function handle(req, res) {
  if (!isLoopback(req)) return json(res, 403, { ok: false, error: '只接受本机回环访问' })
  const url = new URL(req.url, 'http://127.0.0.1')
  const p = url.pathname.slice(PREFIX.length) || '/'
  if (req.method === 'GET' && p === '/status') return json(res, 200, statusPayload())
  if (req.method === 'GET' && (p === '/room' || p === '/room/' || p.startsWith('/room/'))) {
    if (!handleRoom) return json(res, 404, { ok: false, error: 'room module not installed' })
    const sub = p.slice('/room'.length) || '/'
    if (handleRoom(req, res, sub, memoryRoot())) return
    return json(res, 404, { ok: false, error: 'no such room path' })
  }
  if (req.method === 'GET' && p === '/sync/status') {
    try {
      const cfg = loadSyncConfig(SYNC_CONFIG)
      if (!cfg) return json(res, 200, { ok: false, error: '还没有同步配置；先 POST /sync/init' })
      return json(res, 200, syncStatus({ root: memoryRoot(), config: cfg }))
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/library/status') {
    try {
      const root = memoryRoot()
      const exists = fs.existsSync(root)
      const files = exists ? fs.readdirSync(root, { withFileTypes: true }).filter((x) => x.isFile()).map((x) => x.name) : []
      const previous = previousLibraryRoots().map((p) => {
        try { return libraryCleanupPreview(p) } catch { return { target: p, exists: fs.existsSync(p), files: [], unknown: [], safe: false } }
      })
      const cfg = readLibraryConfig()
      const available = listWorkspaces().workspaces || []
      return json(res, 200, {
        ok: true, root, exists, files, previous,
        selected: Array.isArray(cfg.workspaces) ? cfg.workspaces : [],
        available,
        hasJsonl: fs.existsSync(path.join(root, 'memory.jsonl')),
      })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  // 搬家包：面板点「备份」后在桌面生成，这里能查、能下
  if (req.method === 'GET' && p === '/move/status') {
    try {
      const f = moveBundlePath()
      const st = fs.existsSync(f) ? fs.statSync(f) : null
      return json(res, 200, {
        ok: true, path: f, exists: !!st,
        size: st ? st.size : 0,
        at: st ? st.mtime.toISOString() : null,
        hint: st ? null : '还没有搬家包；先在控制面板「部署」页点一次「备份」。',
      })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/move/download') {
    try {
      const f = moveBundlePath()
      if (!fs.existsSync(f)) return json(res, 404, { ok: false, error: '还没有搬家包；先在控制面板「部署」页点一次「备份」。' })
      const st = fs.statSync(f)
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': String(st.size),
        'content-disposition': 'attachment; filename="xiaobai-move-bundle.zip"',
        'cache-control': 'no-store',
      })
      fs.createReadStream(f).pipe(res)
      return true
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/wiki/status') {
    try { return json(res, 200, { ok: true, root: memoryRoot(), dir: WIKI_DIR, index: INDEX_NAME, ...wikiHealth(memoryRoot()) }) }
    catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/wiki/list') {
    try { return json(res, 200, { ok: true, pages: listPages(memoryRoot()) }) }
    catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/wiki/read') {
    try {
      const name = url.searchParams.get('name') || ''
      const page = readPage(memoryRoot(), name)
      if (!page) return json(res, 404, { ok: false, error: '没有这一页：' + name })
      return json(res, 200, { ok: true, ...page })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/wiki/material') {
    try { return json(res, 200, { ok: true, materials: listMaterials(memoryRoot()) }) }
    catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/memory/status') {
    try {
      const nodes = memoryNodes()
      return json(res, 200, {
        ok: true,
        version: MEMORY_VERSION,
        root: memoryRoot(),
        nodes: nodes.length,
        cells: buildIndex(nodes).cells.size,
        duplicates: findDuplicates(nodes).length,
        hasJsonl: fs.existsSync(path.join(memoryRoot(), 'memory.jsonl')),
      })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/cards/status') {
    try {
      return json(res, 200, {
        ok: true,
        root: memoryRoot(),
        cards: cardList(),
        lock: fs.existsSync(LOCK_FILE),
        writers: readWriters(),
      })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/client-graph') {
    try {
      const svc = runtimeCtx?.clientModules || runtimeCtx?.get?.('clientModules')
      const graph = svc?.graph?.()
      return json(res, 200, {
        ok: true,
        hasService: Boolean(svc),
        hasGraph: Boolean(graph),
        entries: (graph?.entries || []).map((e) => e.id),
        rows: (graph?.entries || []).map((e) => ({ id: e.id, url: e.url, rev: e.rev })),
        batches: (graph?.batches || []).length,
      })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'POST' && p === '/client-loaded') {
    const ev = { at: new Date().toISOString(), body }
    clientEvents.push(ev)
    if (clientEvents.length > 50) clientEvents.shift()
    // 精简版客户端只上报 script/settings，没有 apply 阶段；任何真实上报都算在线。
    clientLoaded = ev
    return json(res, 200, { ok: true })
  }
  if (req.method === 'GET' && p === '/workspaces') {
    try { return json(res, 200, listWorkspaces()) }
    catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/diary/status') {
    try {
      const root = memoryRoot()
      const days = listDays(root)
      return json(res, 200, {
        ok: true,
        root,
        dir: path.join(root, DIARY_DIR_NAME),
        days: days.length,
        last: days[0] || null,
        recent: days.slice(0, 14),
        ...diaryHealth(),
      })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/diary/read') {
    try {
      const date = String(url.searchParams.get('date') || todayKey())
      const md = readDay(memoryRoot(), date)
      if (md == null) return json(res, 200, { ok: false, error: `没有 ${date} 的日记` })
      return json(res, 200, { ok: true, date, markdown: md })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method === 'GET' && p === '/diary/search') {
    try {
      const q = String(url.searchParams.get('q') || '')
      return json(res, 200, { ok: true, q, hits: searchDiary(memoryRoot(), q, { limit: 30 }) })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' })
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    return json(res, 415, { ok: false, error: '必须是 application/json' })
  }
  let body
  try { body = await readBody(req) } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
  if (p === '/wiki/write') {
    try {
      if (!body.name) return json(res, 400, { ok: false, error: '缺少 name' })
      const r = writePage(memoryRoot(), body.name, body.text ?? body.content ?? '')
      return json(res, 200, { ok: true, ...r })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/wiki/material') {
    try {
      const date = body.date || new Date().toISOString().slice(0, 10)
      const file = makeMaterial(memoryRoot(), date, body)
      return json(res, 200, { ok: true, date, path: file })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/wiki/reindex') {
    try { return json(res, 200, { ok: true, ...rebuildIndex(memoryRoot()) }) }
    catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/cards/rebuild') {
    try {
      const release = acquireWriteLock('rebuild')
      try {
        const node = process.env.DSH_NODE || process.execPath
        const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        for (const args of [[], ['--variant', 'work'], ['--variant', 'chat']]) {
          await execFileAsync(node, [CARD_SCRIPT, ...args], { timeout: 60000, windowsHide: true, env })
        }
        const dir = path.join(memoryRoot(), '记忆卡')
        for (const n of ['记忆卡.md', '记忆卡-工作.md', '记忆卡-聊天.md', '记忆卡-短卡.md']) {
          const f = path.join(dir, n)
          if (fs.existsSync(f)) recordWrite(f, 'api:/cards/rebuild')
        }
      } finally { release() }
      syncShortCardToAgents()
      return json(res, 200, { ok: true, cards: cardList() })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }

  if (p === '/memory/attest') {
    try {
      const release = acquireWriteLock('attest')
      try {
        const files = [path.join(memoryRoot(), 'memory.jsonl')]
        const dir = path.join(memoryRoot(), '记忆卡')
        for (const n of ['记忆卡.md', '记忆卡-prompt.md', '记忆卡-短卡.md', '记忆卡-工作.md', '记忆卡-聊天.md']) {
          files.push(path.join(dir, n))
        }
        const done = []
        for (const f of files) {
          if (!fs.existsSync(f)) continue
          recordWrite(f, 'api:/memory/attest')
          done.push({ file: path.basename(f), sha256: sha256File(f) })
        }
        return json(res, 200, { ok: true, attested: done })
      } finally { release() }
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }

  if (p === '/memory/add') {
    try {
      const input = body && body.node ? body.node : body
      const title = String(input.title || '').trim()
      const text = String(input.text || '').trim()
      if (!title || !text) return json(res, 400, { ok: false, error: 'title 和 text 必填' })
      const nodes = memoryNodes()
      const norm = (x) => String(x).replace(/\s+/g, '')
      if (nodes.some((n) => norm(n.title) === norm(title))) {
        return json(res, 200, { ok: true, skipped: 'same-title' })
      }
      // 近似重复：正文前 24 字被已有节点包含，或与某条高度重合
      const head24 = norm(text).slice(0, 24)
      if (head24.length >= 12 && nodes.some((n) => norm(n.text).includes(head24))) {
        return json(res, 200, { ok: true, skipped: 'similar-text' })
      }
      const node = makeNode({
        title, text,
        layer: input.layer || 'L2',
        region: input.region || 'daily',
        tags: Array.isArray(input.tags) ? input.tags : [],
        viewFile: input.viewFile || '08',
        source: input.source || 'api:/memory/add',
        src: input.src,
      })
      const release = acquireWriteLock('memory-add')
      try {
        const file = path.join(memoryRoot(), 'memory.jsonl')
        guardExternalChange(file)
        appendJsonl(file, [node])
        recordWrite(file, 'api:/memory/add')
      } finally { release() }
      return json(res, 200, { ok: true, id: node.id })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }

  if (p === '/memory/search') {
    try {
      const q = String(body.q || '').trim()
      const topK = Math.max(1, Math.min(20, Number(body.topK) || 8))
      const nodes = memoryNodes()
      const hits = retrieve(nodes, q, { topK }).map((h) => ({
        id: h.node.id, title: h.node.title, layer: h.node.layer,
        region: h.node.region, cell: h.node.cell, score: Number(h.score.toFixed(4)),
        text: h.node.text.slice(0, 500),
      }))
      return json(res, 200, { ok: true, q, nodes: nodes.length, hits })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/diary/build') {
    try {
      const date = String(body.date || todayKey())
      const r = await writeDay(memoryRoot(), date, { force: body.force === true, allowShrink: body.allowShrink === true })
      return json(res, 200, { ok: true, ...r })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/diary/ingest') {
    try {
      const date = String(body.date || todayKey())
      const day = await collectDay(date)
      const drafts = diaryNodes(day, {
        onlyUser: body.onlyUser !== false,
        max: Math.max(1, Math.min(200, Number(body.max) || 40)),
        layer: String(body.layer || 'L3'),
        region: String(body.region || 'daily'),
      })
      const file = path.join(memoryRoot(), 'memory.jsonl')
      const existing = new Set(memoryNodes().map((n) => n.id))
      const fresh = []
      for (const d of drafts) {
        const n = makeNode(d)
        if (existing.has(n.id)) continue
        existing.add(n.id)
        fresh.push(n)
      }
      if (fresh.length) appendJsonl(file, fresh)
      return json(res, 200, { ok: true, date, drafts: drafts.length, added: fresh.length })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/library/init') {
    try {
      const root = String(body.path || '').trim()
      if (!root) throw new Error('缺少记忆库路径')
      const oldRoot = memoryRoot()
      const migrated = oldRoot === root ? null : migrateLibrary(oldRoot, root)
      const result = initLibrary(root)
      setMemoryRoot(result.root)
      return json(res, 200, { ok: true, ...result, migrated })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/library/workspaces') {
    try {
      const paths = Array.isArray(body.paths) ? body.paths.filter((x) => typeof x === 'string' && x.trim()) : []
      const cfg = readLibraryConfig()
      cfg.version = 1
      cfg.workspaces = [...new Set(paths)]
      fs.mkdirSync(path.dirname(LIBRARY_CONFIG), { recursive: true })
      fs.writeFileSync(LIBRARY_CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
      return json(res, 200, { ok: true, selected: cfg.workspaces })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/library/import-old') {
    try {
      const target = String(body.path || '').trim()
      if (!target) throw new Error('缺少旧目录路径')
      const current = memoryRoot()
      if (path.resolve(target) === path.resolve(current)) throw new Error('不能把当前目录导入自己')
      if (!previousLibraryRoots().some((p) => path.resolve(p) === path.resolve(target))) throw new Error('这不是记录中的旧记忆库目录')
      const migrated = migrateLibrary(target, current)
      return json(res, 200, { ok: true, ...migrated })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/library/cleanup') {
    try {
      return json(res, 200, cleanupLibrary(String(body.path || '').trim(), body.apply === true))
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/init') {
    try {
      const cfg = initSync({
        sharedDir: String(body.sharedDir || '').trim() || undefined,
        name: String(body.name || '').trim() || undefined,
        root: memoryRoot(),
      })
      return json(res, 200, { ok: true, config: cfg })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/export') {
    try {
      const cfg = loadSyncConfig(SYNC_CONFIG)
      if (!cfg) throw new Error('还没有同步配置')
      const lib = readLibraryConfig()
      cfg.scope = { ...(cfg.scope || { global: true }), global: true, workspaces: lib.workspaces || [] }
      return json(res, 200, exportDelta({ root: memoryRoot(), config: cfg }))
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/import') {
    try {
      const cfg = loadSyncConfig(SYNC_CONFIG)
      if (!cfg) throw new Error('还没有同步配置')
      return json(res, 200, importIncoming({ root: memoryRoot(), config: cfg, apply: body.apply === true }))
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/transfer-export') {
    try {
      const cfg = loadSyncConfig(SYNC_CONFIG)
      if (!cfg) throw new Error('还没有同步配置')
      const lib = readLibraryConfig()
      cfg.scope = { ...(cfg.scope || { global: true }), global: true, workspaces: lib.workspaces || [] }
      const ex = exportDelta({ root: memoryRoot(), config: cfg })
      const dstRoot = path.join(os.homedir(), 'DeepMemoryTransfer')
      const dst = path.join(dstRoot, path.basename(ex.dir))
      fs.mkdirSync(dstRoot, { recursive: true })
      fs.cpSync(ex.dir, dst, { recursive: true, force: true })
      await openPath(dst)
      return json(res, 200, { ok: true, dir: dst, manifest: ex.manifest })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/transfer-import') {
    try {
      const cfg = loadSyncConfig(SYNC_CONFIG)
      if (!cfg) throw new Error('还没有同步配置')
      return json(res, 200, importBundleDir({ root: memoryRoot(), config: cfg, dir: String(body.path || '').trim(), apply: true }))
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/open-folder') {
    try {
      const cfg = loadSyncConfig(SYNC_CONFIG)
      const target = String(body.path || '').trim() || cfg?.sharedDir
      if (!target) throw new Error('还没有共享目录')
      await openPath(target)
      return json(res, 200, { ok: true, path: target })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/local-send/status') {
    try {
      const cli = await findLocalSendCli()
      const gui = firstExisting(localSendCandidates().gui)
      const chosen = selectedLocalSendPath()
      return json(res, 200, {
        ok: true, cli, gui, installed: Boolean(cli || gui),
        path: chosen || gui || cli || '', kind: chosen ? localSendKind(chosen) : '',
      })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/local-send/config') {
    try {
      const target = String(body.path || '').trim()
      if (!target) throw new Error('缺少 LocalSend 程序路径')
      if (!/\.exe$/i.test(target) || !fs.existsSync(target)) throw new Error('请选择存在的 .exe 文件')
      fs.mkdirSync(path.dirname(LOCAL_SEND_CONFIG), { recursive: true })
      fs.writeFileSync(LOCAL_SEND_CONFIG, JSON.stringify({ version: 1, path: target }, null, 2) + '\n', 'utf8')
      return json(res, 200, { ok: true, path: target, kind: localSendKind(target) })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/local-send/download') {
    try {
      await execFileAsync('cmd.exe', ['/c', 'start', '', LOCAL_SEND_PAGE], { windowsHide: true, timeout: 15000 }).catch(() => null)
      return json(res, 200, { ok: true, url: LOCAL_SEND_PAGE })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/local-send/send' || p === '/sync/local-send/receive') {
    try {
      const selected = selectedLocalSendPath()
      const selectedKind = selected ? localSendKind(selected) : ''
      const cli = selectedKind === 'cli' ? selected : (selectedKind ? null : await findLocalSendCli())
      const gui = selectedKind === 'gui' ? selected : (selected ? null : firstExisting(localSendCandidates().gui))
      if (!cli && !gui) throw new Error('没有找到 LocalSend；先点「选择程序」指定 localsend_app.exe 或 localsend-cli.exe')
      if (cli) {
        // GUI 和 CLI 默认都占 53317；只有走 CLI 时才收掉 GUI。
        await execFileAsync('taskkill.exe', ['/IM', 'localsend_app.exe', '/F'], { windowsHide: true }).catch(() => null)
      }
      if (p === '/sync/local-send/send') {
        let cfg = loadSyncConfig(SYNC_CONFIG)
        if (!cfg) cfg = initSync({ root: memoryRoot() })
        const lib = readLibraryConfig()
        cfg.scope = { ...(cfg.scope || { global: true }), global: true, workspaces: lib.workspaces || [] }
        const ex = exportDelta({ root: memoryRoot(), config: cfg })
        const dstRoot = path.join(os.homedir(), 'DeepMemoryTransfer')
        const dst = path.join(dstRoot, path.basename(ex.dir))
        fs.mkdirSync(dstRoot, { recursive: true })
        fs.cpSync(ex.dir, dst, { recursive: true, force: true })
        if (cli) await launchConsole('LocalSend 发送', cli, ['-f', dst])
        else await execFileAsync(gui, [], { windowsHide: false, timeout: 15000 }).catch(() => null)
        return json(res, 200, { ok: true, dir: dst, cli, gui, message: cli ? 'LocalSend 已启动，选中设备后发送' : 'GUI 版已启动；传输包已生成，请在 LocalSend 里选择发送' })
      }
      const destination = memoryRoot()
      fs.mkdirSync(destination, { recursive: true })
      if (cli) await launchConsole('LocalSend 接收', cli, ['--destination', destination])
      else await execFileAsync(gui, [], { windowsHide: false, timeout: 15000 }).catch(() => null)
      return json(res, 200, { ok: true, destination, cli, gui, message: cli ? 'LocalSend 已启动，接收的文件会保存到记忆库' : 'GUI 版已启动；请在 LocalSend 设置里把接收目录改为记忆库路径' })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/sync/local-send/open') {
    try {
      const cli = await findLocalSendCli()
      const gui = firstExisting(localSendCandidates().gui)
      if (cli) await launchConsole('LocalSend', cli, [])
      else if (gui) await execFileAsync(gui, [], { windowsHide: false, timeout: 15000 }).catch(() => null)
      else throw new Error('没有找到 LocalSend，先点「下载 LocalSend」')
      return json(res, 200, { ok: true })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/pick-exe') {
    try {
      if (!fs.existsSync(PS)) throw new Error('找不到 powershell.exe，无法打开文件选择器')
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$d = New-Object System.Windows.Forms.OpenFileDialog;',
        '$d.Title = "选择 LocalSend 程序";',
        '$d.Filter = "LocalSend|localsend*.exe|可执行文件|*.exe|所有文件|*.*";',
        '$d.CheckFileExists = $true;',
        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }',
      ].join(' ')
      const output = await run(PS, ['-NoProfile', '-STA', '-Command', script], 120000)
      const picked = String(output || '').trim()
      if (!picked) return json(res, 200, { ok: false, error: '没有选择文件' })
      return json(res, 200, { ok: true, path: picked })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/pick-folder') {
    try {
      if (!fs.existsSync(PS)) throw new Error('找不到 powershell.exe，无法打开目录选择器')
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
        '$d.Description = "选择深度记忆文件夹";',
        '$d.ShowNewFolderButton = $true;',
        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
      ].join(' ')
      const output = await run(PS, ['-NoProfile', '-STA', '-Command', script], 120000)
      const picked = String(output || '').trim()
      if (!picked) return json(res, 200, { ok: false, error: '没有选择文件夹' })
      return json(res, 200, { ok: true, path: picked })
    } catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/workspaces/policy') {
    try { return json(res, 200, setPolicy(body)) }
    catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/workspaces/handoff') {
    try { return json(res, 200, makeHandoff(String(body.path || '').trim(), { auto: false })) }
    catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  if (p === '/session/handoff') {
    try { return json(res, 200, await handoffAndRotate(String(body.sessionId || '').trim())) }
    catch (e) { return json(res, 200, { ok: false, error: e.message }) }
  }
  return json(res, 404, { ok: false, error: 'unknown api' })
}

// ── 记忆卡：从 memory.jsonl 生成 <记忆库>\记忆卡\记忆卡.md 与 记忆卡-prompt.md ──
const CARD_SCRIPT = path.join(HERE, 'scripts', 'make-memory-card.mjs')

// ── 单写者：写文件必须过锁 + 写前后比对 hash ──
const STATE_DIR = path.join(memoryRoot(), '_state')
const WRITERS_FILE = path.join(STATE_DIR, 'writers.json')
const LOCK_FILE = path.join(memoryRoot(), '.write.lock')
const LOCK_TTL_MS = 60000

function sha256File(file) {
  try {
    if (!fs.existsSync(file)) return null
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch { return null }
}

function readWriters() {
  try { return JSON.parse(fs.readFileSync(WRITERS_FILE, 'utf8')) } catch { return {} }
}

function writeWriters(map) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(WRITERS_FILE, JSON.stringify(map, null, 2), 'utf8')
  } catch { }
}

function acquireWriteLock(scope) {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const st = fs.statSync(LOCK_FILE)
      if (Date.now() - st.mtimeMs < LOCK_TTL_MS) throw new Error('busy：另一个写操作正在进行（' + scope + '）')
    }
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true })
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ scope, pid: process.pid, at: new Date().toISOString() }), 'utf8')
    return () => { try { fs.unlinkSync(LOCK_FILE) } catch { } }
  } catch (e) { throw e }
}

function guardExternalChange(file) {
  const map = readWriters()
  const rec = map[file]
  if (!rec) return
  const cur = sha256File(file)
  if (cur && rec.sha256 && cur !== rec.sha256) {
    throw new Error('外部改动：' + file + ' 的 hash 与上次写入不一致，拒绝覆盖（先人工确认）')
  }
}

function recordWrite(file, who) {
  const map = readWriters()
  map[file] = { who, at: new Date().toISOString(), sha256: sha256File(file) }
  writeWriters(map)
}

function cardList() {
  const dir = path.join(memoryRoot(), '记忆卡')
  const out = []
  for (const name of ['记忆卡.md', '记忆卡-prompt.md', '记忆卡-短卡.md', '记忆卡-工作.md', '记忆卡-聊天.md']) {
    const f = path.join(dir, name)
    if (!fs.existsSync(f)) continue
    const st = fs.statSync(f)
    out.push({ file: name, bytes: st.size, mtime: new Date(st.mtimeMs).toISOString(), sha256: sha256File(f) })
  }
  return out
}


async function buildMemoryCard() {
  try {
    if (!fs.existsSync(CARD_SCRIPT)) return
    const src = path.join(memoryRoot(), 'memory.jsonl')
    if (!fs.existsSync(src)) return
    const out = path.join(memoryRoot(), '记忆卡', '记忆卡.md')
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) return
    const node = process.env.DSH_NODE || process.execPath
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    const release = acquireWriteLock('cards')
    try {
      await execFileAsync(node, [CARD_SCRIPT], { timeout: 60000, windowsHide: true, env })
      for (const v of ['work', 'chat']) {
        await execFileAsync(node, [CARD_SCRIPT, '--variant', v], { timeout: 60000, windowsHide: true, env })
      }
      const dir = path.join(memoryRoot(), '记忆卡')
      for (const n of ['记忆卡.md', '记忆卡-工作.md', '记忆卡-聊天.md', '记忆卡-短卡.md']) {
        const f = path.join(dir, n)
        if (fs.existsSync(f)) recordWrite(f, 'plugin:buildMemoryCard')
      }
    } finally { release() }
  } catch (e) {
    try { console.log('[deep-memory] 记忆卡没生成：' + String(e?.message ?? e)) } catch {}
  }
}

// ── 短卡注入：把 记忆卡-短卡.md 同步进 <DSH_HOME>\AGENTS.md 的标记段 ──
const AGENTS_FILE = path.join(DSH_HOME, 'AGENTS.md')
const MEM_BEGIN = '<!-- XIAOBAI MEMORY CARD BEGIN -->'
const MEM_END = '<!-- XIAOBAI MEMORY CARD END -->'

function syncShortCardToAgents() {
  try {
    // 优先用“工作版”卡（core + work），没有再退回短卡
    const workCard = path.join(memoryRoot(), '记忆卡', '记忆卡-工作.md')
    const src = fs.existsSync(workCard) ? workCard : path.join(memoryRoot(), '记忆卡', '记忆卡-短卡.md')
    if (!fs.existsSync(src) || !fs.existsSync(AGENTS_FILE)) return
    const card = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n').trim()
    if (!card) return
    const block = [MEM_BEGIN, card, MEM_END].join('\n')
    let text = fs.readFileSync(AGENTS_FILE, 'utf8').replace(/\r\n/g, '\n')
    const i = text.indexOf(MEM_BEGIN)
    const j = text.indexOf(MEM_END)
    let next
    if (i >= 0 && j > i) {
      next = text.slice(0, i) + block + text.slice(j + MEM_END.length)
    } else {
      next = text.replace(/\s+$/, '') + '\n\n' + block + '\n'
    }
    if (next === text) return
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
    fs.copyFileSync(AGENTS_FILE, AGENTS_FILE + '.bak-' + stamp)
    fs.writeFileSync(AGENTS_FILE, next, 'utf8')
  } catch (e) {
    try { console.log('[deep-memory] 短卡没写进 AGENTS.md：' + String(e?.message ?? e)) } catch {}
  }
}

function startCardBuilder() {
  let stopped = false
  const kick = () => { if (!stopped) buildMemoryCard().then(() => { if (!stopped) syncShortCardToAgents() }) }
  const first = setTimeout(kick, 8000)
  const timer = setInterval(kick, 10 * 60 * 1000)
  return () => { stopped = true; clearTimeout(first); clearInterval(timer) }
}

function startDiaryBuilder() {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const root = memoryRoot()
      const today = todayKey()
      const y = new Date(); y.setDate(y.getDate() - 1)
      const yesterday = todayKey(y.getTime())
      await writeDay(root, yesterday, { force: false })
      await writeDay(root, today, { force: true })
    } catch (e) {
      try { console.log('[deep-memory] 日记没写成：' + String(e?.message ?? e)) } catch {}
    }
  }
  const first = setTimeout(() => { tick() }, 5000)
  const timer = setInterval(() => { tick() }, 15 * 60 * 1000)
  return () => { stopped = true; clearTimeout(first); clearInterval(timer) }
}

function startWikiMaterialBuilder() {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const now = new Date()
      if (now.getHours() < 22) return
      const root = memoryRoot()
      const date = todayKey()
      const dir = path.join(root, WIKI_DIR)
      const matFile = path.join(dir, '_今日素材-' + date + '.md')
      if (fs.existsSync(matFile)) return
      let diary = ''
      try { diary = String(readDay(root, date) || '') } catch {}
      let room = ''
      try {
        const p = path.join(root, '小屋', date + '.md')
        if (fs.existsSync(p)) {
          const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)
          room = lines.slice(-8).join('\n')
        }
      } catch {}
      let phone = ''
      try {
        const p = path.join(root, '手机', date + '.md')
        if (fs.existsSync(p)) phone = fs.readFileSync(p, 'utf8').slice(0, 3000)
      } catch {}
      if (!diary && !room && !phone) return
      makeMaterial(root, date, { diary, room, phone })
      try { console.log('[deep-memory] 认识素材已备好：' + date) } catch {}
    } catch (e) {
      try { console.log('[deep-memory] 认识素材没备成：' + String(e?.message ?? e)) } catch {}
    }
  }
  const first = setTimeout(() => { tick() }, 20000)
  const timer = setInterval(() => { tick() }, 30 * 60 * 1000)
  return () => { stopped = true; clearTimeout(first); clearInterval(timer) }
}

export function apply(ctx) {
  runtimeCtx = ctx
  const off = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      try { await handle(req, res)
      } catch (e) {
        try { json(res, 500, { ok: false, error: String(e?.message ?? e) }) } catch {}
      }
    },
  })
  // 上下文可能处于未激活状态（例如新建会话时的临时 ctx），
  // 此时 ctx.effect 会抛 "cannot create effect on inactive context" 并中断整个会话创建。
  // 所以这里逐个兜住：注册失败就手动停掉对应的定时器，绝不向上抛。
  const safeEffect = (stop, label) => {
    try { ctx.effect(stop, label) } catch (e) {
      try { console.log('[deep-memory] effect 注册失败（已忽略）：' + label + ' · ' + (e?.message ?? e)) } catch {}
      try { const f = stop(); if (typeof f === 'function') f() } catch {}
    }
  }
  if (typeof off === 'function') safeEffect(() => off, 'deep-memory: api')
  const stopWatch = startWatcher((msg) => { try { console.log(msg) } catch {} })
  safeEffect(() => stopWatch, 'deep-memory: workspace handoff watcher')
  const stopCards = startCardBuilder()
  safeEffect(() => stopCards, 'deep-memory: 记忆卡')
  const stopDiary = startDiaryBuilder()
  safeEffect(() => stopDiary, 'deep-memory: 日记')
  const stopWikiMat = startWikiMaterialBuilder()
  safeEffect(() => stopWikiMat, 'deep-memory: 认识素材')
  try { ensureWiki(memoryRoot()) } catch (e) {
    try { console.log('[deep-memory] 认识层初始化跳过：' + (e?.message ?? e)) } catch {}
  }
}

export default { name, inject, apply }
