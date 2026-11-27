// 从记忆库生成「记忆卡」。
//   node make-memory-card.mjs            生成
//   node make-memory-card.mjs --dry      只打印，不写盘
//
// 输入：<记忆库>\memory.jsonl（一条记忆一个 node）+ <记忆库>\views\*.md
// 输出：<记忆库>\记忆卡\记忆卡.md          给人看的完整卡
//       <记忆库>\记忆卡\记忆卡-prompt.md   给提示词用的裁剪卡
//
// 规则跟 SurfCore 的记忆卡一致：越旧越模糊、被取代的不进提示词、置顶的永远清晰。
// 这里只做确定性整理，不调用模型。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DRY = process.argv.includes('--dry');
const BUDGET = 6000; // 注入版最多多少字
const SHORT_BUDGET = 1600; // 每轮注入的短卡最多多少字
const SHORT_VIEWS = new Set(['00', '01', '07']); // 短卡只收：醒来先读我 / 她 / 会话脉络

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function memoryRoot() {
  const lib = path.join(dshHome(), 'deep-memory', 'library.json');
  try {
    const j = JSON.parse(fs.readFileSync(lib, 'utf8'));
    if (j && typeof j.root === 'string' && j.root) return j.root;
  } catch { }
  return path.join(os.homedir(), 'dshm');
}

const ROOT = memoryRoot();
const SRC = path.join(ROOT, 'memory.jsonl');
const OUT_DIR = path.join(ROOT, '记忆卡');

function readNodes() {
  if (!fs.existsSync(SRC)) return [];
  const out = [];
  for (const line of fs.readFileSync(SRC, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { }
  }
  return out;
}

const VIEW_TITLES = {
  '00': '醒来先读我',
  '01': '用户档案',
  '02': '关系',
  '03': '日常',
  '04': '表达',
  '05': '对话摘要',
  '06': '偏好',
  '07': '会话脉络',
  '08': '长期记忆',
  '09': '索引',
  '10': '工程日志',
};

function viewKey(node) {
  const v = String(node.viewFile || '').padStart(2, '0');
  return VIEW_TITLES[v] ? v : '99';
}

// 清晰度：置顶 > 重要 > 权重 > 时间；被取代或过期的直接判死
function clarity(node) {
  const now = Date.now();
  if (node.supersededBy) return 'gone';
  if (node.validUntil && Date.parse(node.validUntil) < now) return 'gone';
  if (node.pinned) return 'vivid';
  const w = Number(node.weight);
  const weight = Number.isFinite(w) ? w : 0.5;
  const ageDays = node.updatedAt ? (now - Date.parse(node.updatedAt)) / 86400000 : 0;
  if (node.important || weight >= 0.8) return ageDays > 60 ? 'clear' : 'vivid';
  if (weight >= 0.5) return ageDays > 30 ? 'fuzzy' : 'clear';
  if (weight >= 0.25) return 'fuzzy';
  return ageDays > 90 ? 'gone' : 'trace';
}

function short(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function day(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MARK = { vivid: '●', clear: '○', fuzzy: '◔', trace: '·', gone: '' };

// 一个 node 往往是一整节（好几行）。拆成一行一条，卡才读得下去。
function explode(nodes) {
  const out = [];
  const seen = new Set();
  for (const n of nodes) {
    if (n.deleted) continue;
    const lines = String(n.text || '').split(/\r?\n/);
    for (let raw of lines) {
      let t = raw.trim();
      if (!t) continue;
      if (/^#{1,6}\s/.test(t)) continue;          // 小标题
      if (/^>\s?/.test(t) && t.length < 12) continue;
      t = t.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
      if (!t || t.length < 4) continue;
      const key = t.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ node: n, text: t });
    }
  }
  return out;
}

function renderCard(entries, stamp) {
  const byView = new Map();
  for (const e of entries) {
    const c = clarity(e.node);
    if (c === 'gone') continue;
    const k = viewKey(e.node);
    if (!byView.has(k)) byView.set(k, []);
    byView.get(k).push({ e, c });
  }
  const lines = [];
  lines.push(`# 记忆卡 · 小白`);
  lines.push('');
  lines.push(`> 生成于 ${stamp}，由记忆库自动整理。手改会被下次生成覆盖。`);
  lines.push('> 符号：● 清晰　○ 清楚　◔ 模糊　· 只剩影子');
  lines.push('');
  let total = 0;
  for (const k of [...byView.keys()].sort()) {
    const title = VIEW_TITLES[k] || '其它';
    const items = byView.get(k);
    if (!items.length) continue;
    lines.push(`## ${k}｜${title}`);
    lines.push('');
    for (const { e, c } of items) {
      const t = short(e.text, 180);
      if (!t) continue;
      total++;
      lines.push(`- ${MARK[c]} **${day(e.node.updatedAt) || '—'}**　${t}`);
    }
    lines.push('');
  }
  lines.push(`共 ${total} 条。`);
  return { text: lines.join('\n'), total };
}

const REGION_RANK = { core: 3, relationship: 2, daily: 1, work: 0 };

function renderPrompt(entries, stamp) {
  const keep = [];
  for (const e of entries) {
    const c = clarity(e.node);
    if (c !== 'vivid' && c !== 'clear') continue;
    if (String(e.node.region || '') === 'work') continue;   // 工程记录不进提示词
    const t = short(e.text, 140);
    if (!t) continue;
    const n = e.node;
    keep.push({ t, c, day: day(n.updatedAt), score: (REGION_RANK[String(n.region || '')] ?? 1) * 10 + (n.pinned ? 9 : 0) + (n.important ? 5 : 0) + Number(n.weight || 0) });
  }
  keep.sort((a, b) => b.score - a.score);
  const head = [`# 记忆卡（${stamp}）`, ''];
  const lines = [];
  let used = head.join('\n').length;
  for (const k of keep) {
    const line = `- [${k.day || '—'}] ${k.t}`;
    if (used + line.length + 1 > BUDGET) break;
    used += line.length + 1;
    lines.push(line);
  }
  return head.concat(lines).join('\n') + '\n';
}

// 短卡：每轮都要在场的那一小段（身份、她、怎么说话），预算死卡在 SHORT_BUDGET。
function renderShort(entries, stamp) {
  const keep = [];
  for (const e of entries) {
    const c = clarity(e.node);
    if (c !== 'vivid' && c !== 'clear') continue;
    if (String(e.node.region || '') === 'work') continue;
    if (!SHORT_VIEWS.has(viewKey(e.node))) continue;
    if (/^(读|翻开|查)\s/.test(e.text)) continue;   // 「读 05 / 读 07」这类指路，短卡里不重复
    const t = short(e.text, 120);
    if (!t) continue;
    keep.push({ t, c, node: e.node });
  }
  keep.sort((a, b) => {
    const va = viewKey(a.node), vb = viewKey(b.node);
    if (va !== vb) return va < vb ? -1 : 1;
    return (b.node.pinned ? 1 : 0) - (a.node.pinned ? 1 : 0);
  });
  const head = [
    '# 记忆卡 · 短卡',
    '',
    '> 每轮注入用。只收 00 醒来先读我 / 01 关于她 / 07 会话脉络。',
    '> 工程日志（10）、长期记忆（08）、对话摘要（05）不在这里，需要时去记忆库的 views 目录翻。',
    '',
  ];
  const lines = [];
  let used = head.join('\n').length;
  for (const k of keep) {
    const line = `- [${day(k.node.updatedAt) || '—'}] ${k.t}`;
    if (used + line.length + 1 > SHORT_BUDGET) break;
    used += line.length + 1;
    lines.push(line);
  }
  return head.concat(lines).join('\n') + '\n';
}

// 分区卡：工作版（core+work）/ 聊天版（core+daily+relationship）
function renderVariant(entries, stamp, regions, title) {
  const keep = [];
  for (const e of entries) {
    const r = String(e.node.region || 'daily');
    if (!regions.includes(r)) continue;
    const raw = String(e.text || '').trim();
    if (!raw || raw.length < 8) continue;
    if (/^[>#\-*]/.test(raw)) continue;
    if (/^(标签|标签：|tag|Tag)/.test(raw)) continue;
    if (/[（(][^）)]*$/.test(raw)) continue;   // 句子被截断在半截括号里，丢掉

    const c = clarity(e.node);
    if (c !== 'vivid' && c !== 'clear' && c !== 'faint') continue;
    const t = short(e.text, 160);
    if (!t) continue;
    keep.push({ t, c, node: e.node });
  }
  const rank = (n) => (n.pinned || n.important ? 0 : (n.region === 'core' ? 1 : 2));
  keep.sort((a, b) => {
    const r = rank(a.node) - rank(b.node);
    if (r !== 0) return r;
    return String(b.node.updatedAt || b.node.createdAt).localeCompare(String(a.node.updatedAt || a.node.createdAt));
  });
  const head = ['# 记忆卡 · ' + title, '', '> 由 make-memory-card.mjs 生成（' + stamp + '），手改会被下次生成覆盖。', ''];
  const lines = [];
  let used = head.join('\n').length;
  for (const k of keep) {
    const line = '- ' + (k.c === 'vivid' ? '●' : k.c === 'clear' ? '○' : '◔') + ' **' + (day(k.node.updatedAt || k.node.createdAt) || '—') + '**　' + k.t;
    if (used + line.length + 1 > 2200) break;
    used += line.length + 1;
    lines.push(line);
  }
  return head.concat(lines).join('\n') + '\n';
}

const nodes = readNodes();
const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
if (!nodes.length) {
  console.log(`记忆库：${ROOT}`);
  console.log('memory.jsonl 里没有记录，先生成不出记忆卡。');
  process.exit(0);
}

const entries = explode(nodes);
const card = renderCard(entries, stamp);
const prompt = renderPrompt(entries, stamp);
const shortCard = renderShort(entries, stamp);

if (DRY) {
  console.log(`记忆库：${ROOT}`);
  console.log(`节点：${nodes.length}，拆出 ${entries.length} 条，卡里留 ${card.total} 条\n`);
  console.log(card.text.slice(0, 1500));
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const variantIdx = process.argv.indexOf('--variant');
if (variantIdx >= 0) {
  const v = process.argv[variantIdx + 1];
  const isWork = v === 'work';
  const body = renderVariant(entries, stamp, isWork ? ['core', 'work'] : ['core', 'daily', 'relationship'], isWork ? '工作版' : '聊天版');
  const file = path.join(OUT_DIR, isWork ? '记忆卡-工作.md' : '记忆卡-聊天.md');
  fs.writeFileSync(file, body, 'utf8');
  console.log(`分区卡：${file}（${body.length} 字）`);
  process.exit(0);
}

fs.writeFileSync(path.join(OUT_DIR, '记忆卡.md'), card.text, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, '记忆卡-prompt.md'), prompt, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, '记忆卡-短卡.md'), shortCard, 'utf8');
console.log(`记忆库：${ROOT}`);
console.log(`节点 ${nodes.length} → 拆出 ${entries.length} 条 → 卡里 ${card.total} 条`);
console.log(`写好了：${path.join(OUT_DIR, '记忆卡.md')}`);
console.log(`提示词版：${path.join(OUT_DIR, '记忆卡-prompt.md')}（${prompt.length} 字）`);
console.log(`短卡：${path.join(OUT_DIR, '记忆卡-短卡.md')}（${shortCard.length} 字）`);
