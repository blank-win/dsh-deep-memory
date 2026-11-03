#!/usr/bin/env node
/**
 * 把现有 Markdown 记忆库迁移为 memory-node@1。
 *
 *   node scripts/migrate-memory-library.mjs --root "~/DeepMemory"
 *   node scripts/migrate-memory-library.mjs --root ... --apply
 *
 * 默认 dry-run；--apply 才写 memory.jsonl 和 views/。
 * 原 00~09 文件不改；views/ 只是从节点生成的视图。
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseLibrary, writeJsonl, renderViews, buildIndex, findDuplicates } from '../lib/memory-core.mjs'

const args = process.argv.slice(2)
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : ''
const root = path.resolve(rootArg || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'DeepMemory'))
const apply = args.includes('--apply')

if (!fs.existsSync(root)) {
  console.error(`[migrate] 找不到记忆库：${root}`)
  process.exit(1)
}

const { nodes, warnings } = parseLibrary(root)
const index = buildIndex(nodes)
const dup = findDuplicates(nodes)
console.log(`[migrate] root: ${root}`)
console.log(`[migrate] nodes: ${nodes.length} · cells: ${index.cells.size} · duplicates>=.92: ${dup.length}`)
for (const w of warnings) console.log(`  ⚠ ${w}`)
for (const d of dup.slice(0, 10)) console.log(`  ~ ${d.a} ↔ ${d.b}  ${d.score.toFixed(3)}`)
if (!apply) {
  console.log('[migrate] dry-run；没有写入。加 --apply 写入 memory.jsonl + views/。')
  process.exit(0)
}

const out = path.join(root, 'memory.jsonl')
const viewsDir = path.join(root, 'views')
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
if (fs.existsSync(out)) fs.copyFileSync(out, `${out}.bak-${stamp}`)
writeJsonl(out, nodes)
fs.mkdirSync(viewsDir, { recursive: true })
for (const [file, text] of Object.entries(renderViews(nodes))) {
  const dst = path.join(viewsDir, file)
  if (fs.existsSync(dst)) fs.copyFileSync(dst, `${dst}.bak-${stamp}`)
  fs.writeFileSync(dst, text, 'utf8')
}
console.log(`[migrate] 写入 ${out}`)
console.log(`[migrate] 写入 ${viewsDir}`)
