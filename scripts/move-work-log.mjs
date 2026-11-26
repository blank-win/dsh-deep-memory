// 把「工程记录」从 08-长期记忆 挪到 10-工程日志。
//   node scripts/move-work-log.mjs --dry   只看会挪哪些
//   node scripts/move-work-log.mjs         真挪（先备份 memory.jsonl 和 views）
//
// 08 留下来的是「跟她有关的日常」，10 放「项目开发留下的结论」。
// 记忆卡完整版会带上 10，注入版不带（10 的 region 都改成 work）。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadJsonl, writeJsonl, renderViews } from '../lib/memory-core.mjs'

const DRY = process.argv.includes('--dry')

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function memoryRoot() {
  const lib = path.join(dshHome(), 'deep-memory', 'library.json')
  try {
    const j = JSON.parse(fs.readFileSync(lib, 'utf8'))
    if (j && typeof j.root === 'string' && j.root) return j.root
  } catch { }
  return path.join(os.homedir(), 'dshm')
}

// 这些标题是工程/插件/SurfCore 的开发记录，不是「她」的事
const WORK_TITLES = new Set([
  '记忆库第一版',
  '推理强度改成 low',
  '记忆库第一次通过测试',
  '恢复记忆集成到 EXE',
  '峰值省电模式',
  'B站夜间挪出峰值',
  'B站三个兼容补丁',
  'B站专用备份命令',
  '备份插件 MVP',
  '工作区交接策略',
  '会话菜单：归档并转交',
  '记忆库迁移到 memory-node@1',
  '会话轮换测量',
  '交接：她准备重写省 token 策略',
])

const root = memoryRoot()
const jsonl = path.join(root, 'memory.jsonl')
const nodes = loadJsonl(jsonl)
if (!nodes.length) {
  console.log(`记忆库：${root}`)
  console.log('没有节点。')
  process.exit(0)
}

const moving = nodes.filter((n) => n.viewFile === '08' && WORK_TITLES.has(String(n.title || '').trim()))
console.log(`记忆库：${root}`)
console.log(`08 节点 ${nodes.filter((n) => n.viewFile === '08').length} 个，要挪 ${moving.length} 个：`)
for (const n of moving) console.log('  - ' + n.title)

if (DRY) process.exit(0)
if (!moving.length) {
  console.log('没有要挪的，什么都不改。')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
if (fs.existsSync(jsonl)) fs.copyFileSync(jsonl, `${jsonl}.bak-${stamp}`)

for (const n of moving) {
  n.viewFile = '10'
  n.region = 'work'
  n.tags = [...new Set([...(n.tags || []), '工程'])]
  n.updatedAt = new Date().toISOString()
}
writeJsonl(jsonl, nodes)

const viewsDir = path.join(root, 'views')
fs.mkdirSync(viewsDir, { recursive: true })
for (const [file, text] of Object.entries(renderViews(nodes))) {
  const dst = path.join(viewsDir, file)
  if (fs.existsSync(dst)) fs.copyFileSync(dst, `${dst}.bak-${stamp}`)
  fs.writeFileSync(dst, text, 'utf8')
}

console.log(`挪好了 ${moving.length} 个 → 10-工程日志`)
console.log(`备份：memory.jsonl.bak-${stamp} / views\\*.bak-${stamp}`)
