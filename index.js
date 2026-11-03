import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listWorkspaces, setPolicy, makeHandoff, startWatcher, workspaceBySession } from './workspaces.js'
import { loadJsonl, buildIndex, retrieve, findDuplicates, VERSION as MEMORY_VERSION } from './lib/memory-core.mjs'
import { loadSyncConfig, initSync, exportDelta, importIncoming, importBundleDir, syncStatus, CONFIG_FILE as SYNC_CONFIG } from './lib/memory-sync.mjs'
import { initLibrary, TEMPLATE_FILES } from './lib/library-template.mjs'
import { migrateLibrary } from './lib/library-migrate.mjs'

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
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' })
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    return json(res, 415, { ok: false, error: '必须是 application/json' })
  }
  let body
  try { body = await readBody(req) } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
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
  if (typeof off === 'function') ctx.effect(() => off, 'deep-memory: api')
  const stopWatch = startWatcher((msg) => { try { console.log(msg) } catch {} })
  ctx.effect(() => stopWatch, 'deep-memory: workspace handoff watcher')
}

export default { name, inject, apply }
