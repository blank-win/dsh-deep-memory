import fs from 'node:fs'
import path from 'node:path'

export const WIKI_DIR = '认识'
export const INDEX_NAME = '目录.md'
const MATERIAL_PREFIX = '_今日素材-'

function wikiPath(root) {
  return path.join(root, WIKI_DIR)
}

function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.md$/i, '')
    .trim()
}

export function ensureWiki(root) {
  const dir = wikiPath(root)
  fs.mkdirSync(dir, { recursive: true })
  const index = path.join(dir, INDEX_NAME)
  if (!fs.existsSync(index)) {
    fs.writeFileSync(
      index,
      '# 目录\n\n> 我对别的人、别的事现在怎么理解。一页一个主题，`[[标题]]` 互相链接。\n> 每天晚上翻一遍当天，改正、合并、开新页。\n'
    )
  }
  return dir
}

export function listPages(root) {
  const dir = wikiPath(root)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const full = path.join(dir, f)
      const text = fs.readFileSync(full, 'utf8')
      const st = fs.statSync(full)
      const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || ''
      const body = text.replace(/^#[^\n]*\n+/, '')
      const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1])
      return {
        name: f.replace(/\.md$/i, ''),
        fileName: f,
        title: firstLine.replace(/^#+\s*/, '').trim(),
        excerpt: body.replace(/\s+/g, ' ').slice(0, 120),
        links,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
        isIndex: f === INDEX_NAME
      }
    })
    .filter((p) => !p.isIndex)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function readPage(root, name) {
  const dir = wikiPath(root)
  const file = path.join(dir, safeName(name) + '.md')
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8')
  const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1])
  const known = new Set(listPages(root).map((p) => p.name))
  return {
    name: safeName(name),
    text,
    links,
    broken: links.filter((l) => !known.has(l))
  }
}

export function writePage(root, name, content) {
  ensureWiki(root)
  const dir = wikiPath(root)
  const clean = safeName(name)
  const file = path.join(dir, clean + '.md')
  const existed = fs.existsSync(file)
  fs.writeFileSync(file, String(content || ''), 'utf8')
  rebuildIndex(root)
  return { name: clean, created: !existed, path: file }
}

export function rebuildIndex(root) {
  const dir = wikiPath(root)
  const pages = listPages(root)
  const known = new Set(pages.map((p) => p.name))
  const lines = [
    '# 目录',
    '',
    '> 我对别的人、别的事现在怎么理解。一页一个主题，`[[标题]]` 互相链接。',
    '> 每天晚上翻一遍当天，改正、合并、开新页。',
    ''
  ]
  for (const p of pages) {
    const broken = p.links.filter((l) => !known.has(l))
    const tail = broken.length ? `（断了：${broken.join('、')}）` : ''
    lines.push(`- [[${p.name}]] — ${p.title || '（无标题）'}${tail}`)
  }
  if (!pages.length) lines.push('_还没有页。_')
  lines.push('')
  fs.writeFileSync(path.join(dir, INDEX_NAME), lines.join('\n'), 'utf8')
  return { count: pages.length }
}

export function makeMaterial(root, date, { diary = '', room = '', phone = '' } = {}) {
  ensureWiki(root)
  const file = path.join(wikiPath(root), MATERIAL_PREFIX + date + '.md')
  const parts = [
    `# 今日素材 · ${date}`,
    '',
    '> 这是给「认识」层准备的原料。看完写进对应的页，或者开新页。',
    '> 插件只准备素材，页由我自己写。',
    ''
  ]
  if (room) parts.push('## 屋里', '', room.trim(), '')
  if (diary) parts.push('## 日记', '', diary.trim(), '')
  if (phone) parts.push('## 手机/别处', '', phone.trim(), '')
  fs.writeFileSync(file, parts.join('\n'), 'utf8')
  return file
}

export function listMaterials(root) {
  const dir = wikiPath(root)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(MATERIAL_PREFIX) && f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => ({
      fileName: f,
      date: f.slice(MATERIAL_PREFIX.length, -3),
      updatedAt: fs.statSync(path.join(dir, f)).mtime.toISOString()
    }))
}

export function wikiHealth(root) {
  const dir = wikiPath(root)
  if (!fs.existsSync(dir)) return { ready: false, pages: 0, broken: 0 }
  const pages = listPages(root)
  const known = new Set(pages.map((p) => p.name))
  let broken = 0
  for (const p of pages) for (const l of p.links) if (!known.has(l)) broken++
  return { ready: true, pages: pages.length, broken }
}
