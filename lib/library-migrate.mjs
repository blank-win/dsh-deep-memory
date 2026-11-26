import fs from 'node:fs'
import path from 'node:path'
import { TEMPLATE_FILES } from './library-template.mjs'
import { loadJsonl, writeJsonl, renderViews } from './memory-core.mjs'

function copyMissing(src, dst) {
  if (!fs.existsSync(src)) return false
  if (fs.existsSync(dst)) return false
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  return true
}

function newer(a, b) {
  const ar = Number(a?.rev) || 0, br = Number(b?.rev) || 0
  if (ar !== br) return ar > br ? a : b
  return String(a?.updatedAt || '') >= String(b?.updatedAt || '') ? a : b
}

/**
 * 把旧记忆库的文件搬到新目录。
 * 不删除旧目录；目标已有文件不覆盖，memory.jsonl 按 id 合并。
 */
export function migrateLibrary(oldRoot, newRoot) {
  const old = path.resolve(oldRoot)
  const next = path.resolve(newRoot)
  if (old === next) return { oldRoot: old, newRoot: next, copied: 0, merged: 0, skipped: 0, conflicts: [], oldKept: true }
  if (!fs.existsSync(old)) return { oldRoot: old, newRoot: next, copied: 0, merged: 0, skipped: 0, conflicts: [], oldKept: true, missingOld: true }
  fs.mkdirSync(next, { recursive: true })
  let copied = 0, merged = 0, skipped = 0
  const conflicts = []

  for (const name of [...Object.keys(TEMPLATE_FILES), 'memory.jsonl']) {
    const src = path.join(old, name)
    const dst = path.join(next, name)
    if (!fs.existsSync(src)) continue
    if (name === 'memory.jsonl' && fs.existsSync(dst)) {
      const a = loadJsonl(src), b = loadJsonl(dst)
      const map = new Map(b.map((n) => [n.id, n]))
      for (const n of a) {
        const prev = map.get(n.id)
        if (!prev) { map.set(n.id, n); merged++ }
        else {
          const win = newer(prev, n)
          if (win === prev) {
            if (Number(prev.rev) === Number(n.rev) && String(prev.text) !== String(n.text)) {
              conflicts.push({ id: n.id, reason: 'same-rev-different-text', local: prev.text.slice(0, 200), migrated: n.text.slice(0, 200) })
            }
            skipped++
          } else { map.set(n.id, n); merged++ }
        }
      }
      writeJsonl(dst, [...map.values()])
      continue
    }
    if (copyMissing(src, dst)) copied++
    else skipped++
  }

  const oldViews = path.join(old, 'views')
  const newViews = path.join(next, 'views')
  if (fs.existsSync(oldViews)) {
    fs.mkdirSync(newViews, { recursive: true })
    for (const ent of fs.readdirSync(oldViews, { withFileTypes: true })) {
      if (!ent.isFile()) continue
      if (copyMissing(path.join(oldViews, ent.name), path.join(newViews, ent.name))) copied++
    }
  }

  // 合并后重建视图，避免旧视图覆盖新节点。
  const nodes = loadJsonl(path.join(next, 'memory.jsonl'))
  if (nodes.length) {
    fs.mkdirSync(newViews, { recursive: true })
    for (const [name, text] of Object.entries(renderViews(nodes))) {
      fs.writeFileSync(path.join(newViews, name), text, 'utf8')
    }
  }

  fs.writeFileSync(path.join(next, 'migration-report.json'), JSON.stringify({
    schema: 1,
    oldRoot: old,
    newRoot: next,
    copied,
    merged,
    skipped,
    conflicts,
    oldKept: true,
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf8')

  return { oldRoot: old, newRoot: next, copied, merged, skipped, conflicts, oldKept: true }
}
