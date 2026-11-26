#!/usr/bin/env node
/**
 * 共享目录双向同步 CLI。
 *
 *   node scripts/memory-sync.mjs init --shared "~/DeepMemorySync"
 *   node scripts/memory-sync.mjs status
 *   node scripts/memory-sync.mjs export
 *   node scripts/memory-sync.mjs import --apply
 *
 * 默认 root: ~/DeepMemory
 */

import path from 'node:path'
import os from 'node:os'
import { loadSyncConfig, initSync, exportDelta, importIncoming, syncStatus, DEFAULT_ROOT, CONFIG_FILE } from '../lib/memory-sync.mjs'

const argv = process.argv.slice(2)
const mode = argv[0] || 'status'
const opt = {}
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) continue
  const k = a.slice(2)
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) opt[k] = true
  else { opt[k] = v; i++ }
}

const root = opt.root ? path.resolve(String(opt.root)) : DEFAULT_ROOT
let config = loadSyncConfig(CONFIG_FILE)

if (mode === 'init') {
  config = initSync({
    sharedDir: opt.shared ? path.resolve(String(opt.shared)) : undefined,
    name: opt.name ? String(opt.name) : os.hostname(),
    root,
  })
  console.log(JSON.stringify(config, null, 2))
  process.exit(0)
}

if (!config) {
  console.error('还没有同步配置。先运行 init --shared <共享目录>')
  process.exit(1)
}
config.root = root

if (mode === 'status') {
  console.log(JSON.stringify(syncStatus({ root, config }), null, 2))
} else if (mode === 'export') {
  const r = exportDelta({ root, config })
  console.log(JSON.stringify(r.manifest, null, 2))
  console.log('bundle: ' + r.dir)
} else if (mode === 'import') {
  const apply = opt.apply === true
  const r = importIncoming({ root, config, apply })
  console.log(JSON.stringify(r, null, 2))
  if (!apply) console.log('dry-run；加 --apply 才写入。')
} else {
  console.error('unknown mode: ' + mode)
  process.exit(1)
}
