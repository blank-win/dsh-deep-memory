import fs from 'node:fs'
import path from 'node:path'

const HOME = 'E:/DSH work/panel-build/home'

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webm': 'video/webm'
}

function localDate (d) {
  const x = d || new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

function readRoomLog (root) {
  try { return fs.readFileSync(path.join(root, '小屋', localDate() + '.md'), 'utf8') } catch { return '' }
}

function panelState (root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '小屋', 'panel-state.json'), 'utf8')) } catch { return {} }
}

function diaryCount (root) {
  try { return fs.readdirSync(path.join(root, '日记')).filter((f) => f.endsWith('.md')).length } catch { return 0 }
}

function memoryCount (root) {
  try { return fs.readFileSync(path.join(root, 'memory.jsonl'), 'utf8').split('\n').filter(Boolean).length } catch { return 0 }
}

function lastActivity (root) {
  const log = readRoomLog(root)
  const lines = log.split('\n').filter((l) => l.startsWith('- **'))
  const last = lines[lines.length - 1] || ''
  const m = last.match(/在(.+?)\s*·/)
  return m ? m[1].trim() : '待着'
}

export function roomState (root) {
  const st = panelState(root)
  const hour = new Date().getHours()
  let light = 'night'
  if (hour >= 5 && hour < 9) light = 'dawn'
  else if (hour >= 9 && hour < 16) light = 'noon'
  else if (hour >= 16 && hour < 19) light = 'dusk'
  return {
    ok: true,
    activity: lastActivity(root),
    diary: diaryCount(root),
    memory: memoryCount(root),
    weather: Number(st.weather ?? 0),
    lamp: Number(st.lamp ?? 1),
    light,
    now: new Date().toISOString()
  }
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小屋</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0b0d14; }
  body { display: flex; align-items: center; justify-content: center; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  #stage { position: relative; width: min(100vw, 1024px); height: min(100vh, 640px); overflow: hidden; border-radius: 14px; }
  #room { position: absolute; inset: 0; background-size: cover; background-position: center; transition: filter .8s, box-shadow .8s; }
  #kid { position: absolute; left: 50%; bottom: 12%; height: 46%; transform: translateX(-50%); }
  #pill { position: absolute; left: 14px; top: 14px; padding: 5px 12px; border-radius: 999px; font-size: 13px; color: #eaf0ff; background: rgba(12,16,26,.55); }
  #wpill { position: absolute; left: 14px; top: 48px; padding: 4px 12px; border-radius: 999px; font-size: 13px; color: #cfe0ff; background: rgba(12,16,26,.45); }
  #bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 14px; font-size: 12.5px; line-height: 1.7; color: #dfe7f5; background: linear-gradient(transparent, rgba(8,10,16,.82)); }
</style>
</head>
<body>
<div id="stage">
  <div id="room"></div>
  <img id="kid" alt="">
  <div id="pill">待着</div>
  <div id="wpill">晴</div>
  <div id="bar"></div>
</div>
<script>
const BASE = '/dsh-deep-memory/room';
const ROOM = BASE + '/img/room.png';
const KID = { 'kid': BASE + '/img/kid.png', 'kid-blink': BASE + '/img/kid-blink.png', 'kid-sit': BASE + '/img/kid-sit.png', 'kid-look': BASE + '/img/kid-look.png' };
const POSE_BY_ACT = { '在看书': 'kid-sit', '在床上歇一会儿': 'kid-sit', '在窗台上看星星': 'kid-look' };
const el = (id) => document.getElementById(id);
let st = { activity: '待着', diary: 0, memory: 0, weather: 0, light: 'night' };

function tint (light) {
  const r = el('room');
  if (light === 'dawn') r.style.filter = 'brightness(1.02) sepia(.10) hue-rotate(-8deg)';
  else if (light === 'noon') r.style.filter = 'brightness(1.14) saturate(1.02)';
  else if (light === 'dusk') r.style.filter = 'brightness(.92) sepia(.18) saturate(1.1) hue-rotate(-12deg)';
  else r.style.filter = 'brightness(.82) saturate(.95)';
}

function render () {
  el('pill').textContent = st.activity;
  el('wpill').textContent = ['晴', '阴', '雨'][st.weather] || '晴';
  el('bar').textContent = '今天写了 ' + st.diary + ' 篇日记 · 记忆 ' + st.memory + ' 条';
  tint(st.light);
  el('kid').src = KID[POSE_BY_ACT[st.activity] || 'kid'];
  const room = el('room');
  if (st.weather === 2) room.style.boxShadow = 'inset 0 0 220px 60px rgba(20,28,44,.55)';
  else if (st.weather === 1) room.style.boxShadow = 'inset 0 0 220px 60px rgba(24,30,44,.28)';
  else room.style.boxShadow = 'none';
}

async function pull () {
  try {
    const r = await fetch(BASE + '/state');
    st = await r.json();
    render();
  } catch (e) {}
}

el('room').style.backgroundImage = 'url(' + ROOM + ')';
el('kid').addEventListener('error', () => { el('kid').style.display = 'none'; });

setInterval(() => {
  const img = el('kid');
  if (!img.src.endsWith('/kid.png')) return;
  img.src = KID['kid-blink'];
  setTimeout(() => { if (img.src.endsWith('kid-blink.png')) img.src = KID['kid']; }, 130);
}, 4200 + Math.random() * 2000);

pull();
setInterval(pull, 30000);
</script>
</body>
</html>`

export function handleRoom (req, res, sub, root) {
  const s = sub || '/'
  if (s === '/' || s === '') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(PAGE)
    return true
  }
  if (s === '/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(JSON.stringify(roomState(root)))
    return true
  }
  if (s.startsWith('/img/')) {
    const name = s.slice(5).replace(/[^a-zA-Z0-9._-]/g, '')
    const file = path.join(HOME, name)
    try {
      const buf = fs.readFileSync(file)
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache'
      })
      res.end(buf)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
    return true
  }
  return false
}
