/**
 * 深度记忆 · 共享目录双向同步
 *
 * 传输方式：A、B 各自把 delta 写到共享目录的 outgoing/<device>/<timestamp>/，
 * 对方扫描所有其他设备的 outgoing 并合并。Syncthing / 局域网共享负责搬运。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { loadJsonl, writeJsonl, renderViews, makeNode } from './memory-core.mjs'

export const DEFAULT_ROOT = path.join(os.homedir(), 'DeepMemory')
export const DEFAULT_SYNC_DIR = path.join(os.homedir(), '.dsh', 'deep-memory')
export const DEFAULT_SHARED = path.join(os.homedir(), 'DeepMemorySync')
export const CONFIG_FILE = path.join(DEFAULT_SYNC_DIR, 'sync.json')

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}
function shaFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function shortId() {
  return 'device-' + crypto.randomBytes(4).toString('hex')
}
function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
}

export function loadSyncConfig(file = CONFIG_FILE) {
  return readJson(file, null)
}

export function initSync({ sharedDir = DEFAULT_SHARED, name = os.hostname(), root = DEFAULT_ROOT, file = CONFIG_FILE } = {}) {
  const old = loadSyncConfig(file)
  const deviceId = old?.deviceId || shortId()
  const cfg = {
    version: 1,
    deviceId,
    name,
    root,
    sharedDir: path.resolve(sharedDir),
    scope: old?.scope || { global: true, workspaces: [] },
    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  fs.mkdirSync(cfg.sharedDir, { recursive: true })
  for (const d of ['outgoing', 'applied', 'conflicts']) fs.mkdirSync(path.join(cfg.sharedDir, d), { recursive: true })
  writeJson(file, cfg)
  return cfg
}

function normalizedNodes(root, deviceId) {
  const file = path.join(root, 'memory.jsonl')
  if (!fs.existsSync(file)) return []
  return loadJsonl(file).map((n) => ({
    ...n,
    workspaceKey: n.workspaceKey || 'global',
    device: n.device || deviceId,
    rev: Number(n.rev) || 1,
    deleted: n.deleted === true,
    isNew: false,
  }))
}

function inScope(node, scope) {
  if (node.workspaceKey === 'global') return scope.global !== false
  return Array.isArray(scope.workspaces) && scope.workspaces.includes(node.workspaceKey)
}

export function exportDelta({ root = DEFAULT_ROOT, config, now = new Date() } = {}) {
  if (!config?.deviceId || !config?.sharedDir) throw new Error('同步配置不完整：先 initSync')
  const nodes = normalizedNodes(root, config.deviceId).filter((n) => inScope(n, config.scope || { global: true, workspaces: [] }))
  const dir = path.join(config.sharedDir, 'outgoing', config.deviceId, stamp())
  fs.mkdirSync(dir, { recursive: true })
  const nodesFile = path.join(dir, 'nodes.jsonl')
  fs.writeFileSync(nodesFile, nodes.map((n) => JSON.stringify(n)).join('\n') + (nodes.length ? '\n' : ''), 'utf8')
  const manifest = {
    schema: 1,
    device: config.deviceId,
    name: config.name,
    scope: config.scope,
    createdAt: now.toISOString(),
    nodeCount: nodes.length,
    sha256: shaFile(nodesFile),
  }
  writeJson(path.join(dir, 'manifest.json'), manifest)
  writeJson(path.join(dir, 'workspaces.json'), { scope: config.scope, root })
  return { ok: true, dir, manifest }
}

function appliedFile(config, bundleDir) {
  return path.join(config.sharedDir, 'applied', `${config.deviceId}.json`)
}
function bundleKey(config, bundleDir) {
  return path.relative(path.join(config.sharedDir, 'outgoing'), bundleDir).replace(/\\/g, '/')
}
function isApplied(config, bundleDir) {
  const j = readJson(appliedFile(config, bundleDir), { bundles: [] })
  return j.bundles.includes(bundleKey(config, bundleDir))
}
function markApplied(config, bundleDir) {
  const file = appliedFile(config, bundleDir)
  const j = readJson(file, { bundles: [] })
  const key = bundleKey(config, bundleDir)
  if (!j.bundles.includes(key)) j.bundles.push(key)
  writeJson(file, j)
}

function mergeNodes(local, remote, { root, config, conflictDir, apply }) {
  const byId = new Map(local.map((n) => [n.id, n]))
  const conflicts = []
  let added = 0, updated = 0, skipped = 0, deleted = 0

  for (const r of remote) {
    if (!r || typeof r.id !== 'string') continue
    const l = byId.get(r.id)
    if (!l) {
      byId.set(r.id, { ...r, isNew: true })
      added++
      continue
    }
    const lr = Number(l.rev) || 0
    const rr = Number(r.rev) || 0
    if (r.deleted) {
      if (rr >= lr) { byId.set(r.id, { ...l, deleted: true, rev: rr, updatedAt: r.updatedAt, isNew: true }); deleted++ }
      else skipped++
      continue
    }
    if (r.device === l.device) { skipped++; continue }
    if (rr > lr) {
      byId.set(r.id, { ...r, isNew: true })
      updated++
    } else if (rr === lr && String(r.text) !== String(l.text)) {
      conflicts.push({ id: r.id, localRev: lr, remoteRev: rr, remoteDevice: r.device, localText: l.text, remoteText: r.text })
      skipped++
    } else {
      skipped++
    }
  }

  if (apply) {
    writeJsonl(path.join(root, 'memory.jsonl'), [...byId.values()])
    fs.mkdirSync(path.join(root, 'views'), { recursive: true })
    for (const [file, text] of Object.entries(renderViews([...byId.values()]))) {
      fs.writeFileSync(path.join(root, 'views', file), text, 'utf8')
    }
    if (conflicts.length) {
      fs.mkdirSync(conflictDir, { recursive: true })
      writeJson(path.join(conflictDir, `conflict-${stamp()}.json`), { createdAt: new Date().toISOString(), conflicts })
    }
  }
  return { nodes: [...byId.values()], added, updated, skipped, deleted, conflicts }
}

export function importIncoming({ root = DEFAULT_ROOT, config, apply = false } = {}) {
  if (!config?.deviceId || !config?.sharedDir) throw new Error('同步配置不完整：先 initSync')
  const outgoing = path.join(config.sharedDir, 'outgoing')
  const result = { ok: true, scanned: 0, applied: 0, added: 0, updated: 0, skipped: 0, deleted: 0, conflicts: [], bundles: [] }
  if (!fs.existsSync(outgoing)) return result
  let nodes = normalizedNodes(root, config.deviceId)
  for (const dev of fs.readdirSync(outgoing, { withFileTypes: true })) {
    if (!dev.isDirectory() || dev.name === config.deviceId) continue
    const devDir = path.join(outgoing, dev.name)
    for (const bundle of fs.readdirSync(devDir, { withFileTypes: true })) {
      if (!bundle.isDirectory()) continue
      const dir = path.join(devDir, bundle.name)
      const manifestFile = path.join(dir, 'manifest.json')
      const nodesFile = path.join(dir, 'nodes.jsonl')
      if (!fs.existsSync(manifestFile) || !fs.existsSync(nodesFile)) continue
      result.scanned++
      if (isApplied(config, dir)) continue
      const manifest = readJson(manifestFile, null)
      if (!manifest) continue
      if (manifest.sha256 && shaFile(nodesFile) !== manifest.sha256) {
        result.bundles.push({ dir, error: 'sha256 mismatch' })
        continue
      }
      const remote = loadJsonl(nodesFile)
      const merged = mergeNodes(nodes, remote, { root, config, conflictDir: path.join(config.sharedDir, 'conflicts'), apply })
      nodes = merged.nodes
      result.added += merged.added
      result.updated += merged.updated
      result.skipped += merged.skipped
      result.deleted += merged.deleted
      result.conflicts.push(...merged.conflicts)
      result.bundles.push({ dir, device: manifest.device, added: merged.added, updated: merged.updated, skipped: merged.skipped })
      if (apply) { markApplied(config, dir); result.applied++ }
    }
  }
  return result
}

export function importBundleDir({ root = DEFAULT_ROOT, config, dir, apply = false } = {}) {
  if (!config?.deviceId) throw new Error('同步配置不完整：先 initSync')
  const manifestFile = path.join(dir, 'manifest.json')
  const nodesFile = path.join(dir, 'nodes.jsonl')
  if (!fs.existsSync(manifestFile) || !fs.existsSync(nodesFile)) throw new Error('传输包缺少 manifest.json 或 nodes.jsonl')
  const manifest = readJson(manifestFile, null)
  if (!manifest) throw new Error('manifest.json 无法读取')
  if (manifest.sha256 && shaFile(nodesFile) !== manifest.sha256) throw new Error('传输包校验失败（sha256 不匹配）')
  const local = normalizedNodes(root, config.deviceId)
  const remote = loadJsonl(nodesFile)
  const merged = mergeNodes(local, remote, {
    root, config, conflictDir: path.join(config.sharedDir, 'conflicts'), apply,
  })
  return {
    ok: true, dir, device: manifest.device, nodeCount: remote.length,
    added: merged.added, updated: merged.updated, skipped: merged.skipped,
    deleted: merged.deleted, conflicts: merged.conflicts,
  }
}

export function syncStatus({ root = DEFAULT_ROOT, config } = {}) {
  if (!config?.deviceId) return { ok: false, error: '未配置同步' }
  const outgoing = path.join(config.sharedDir, 'outgoing')
  let pending = 0
  if (fs.existsSync(outgoing)) {
    for (const dev of fs.readdirSync(outgoing, { withFileTypes: true })) {
      if (!dev.isDirectory() || dev.name === config.deviceId) continue
      const dir = path.join(outgoing, dev.name)
      for (const bundle of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!bundle.isDirectory()) continue
        if (!isApplied(config, path.join(dir, bundle.name))) pending++
      }
    }
  }
  return { ok: true, deviceId: config.deviceId, sharedDir: config.sharedDir, pending, root }
}
