(() => {
  const API = "/dsh-deep-memory/api";
  const report = (phase, extra) => {
    try {
      fetch(API + "/client-loaded", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase, at: new Date().toISOString(), ...extra }),
      }).catch(() => {});
    } catch {}
  };
  report("script");
  window.addEventListener("error", (e) => report("error", { message: String(e.message || ""), stack: String(e.error?.stack || "") }));
})();

window.__ModuleLoader__.load({
  id: "dsh-deep-memory",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;
    const API = "/dsh-deep-memory/api";
    let PRIM = null;
    try { PRIM = require("@deepseek-ai/dsh-client-ui-primitives"); } catch {}

    const CSS_TAG = "deep-memory/settings.v3.css";
    const CSS = `
[data-dm-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);color-scheme:dark}
input[data-dm-input][data-dm-blue]{appearance:none!important;-webkit-appearance:none!important;background:transparent!important;color:#f2f2f2!important;-webkit-text-fill-color:#f2f2f2!important;border-color:rgba(127,127,127,.35)!important;caret-color:#fff!important}
button[data-dm-btn][data-dm-blue]{appearance:none!important;-webkit-appearance:none!important;background:#2563eb!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-color:#60a5fa!important}
button[data-dm-btn]{background:#2b2b2e!important;color:#ececf1!important;-webkit-text-fill-color:#ececf1!important;border-color:#3b3b40!important}
button[data-dm-btn][data-primary]{background:#2563eb!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-color:#2563eb!important}
button[data-dm-btn][data-dm-blue][data-primary]{background:#2563eb!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-color:#2563eb!important}
button[data-dm-btn][data-on]{background:rgba(127,127,127,.22)!important;color:#fff!important;-webkit-text-fill-color:#fff!important}

[data-dm-head]{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
[data-dm-title]{font-size:18px;font-weight:600;line-height:26px}
[data-dm-sub]{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px;margin:0}
[data-dm-tabs]{display:flex;gap:6px;flex-wrap:wrap;padding:0 0 8px;border-bottom:1px solid rgba(127,127,127,.2)}
[data-dm-tab]{padding:5px 12px;border:1px solid transparent;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;opacity:.72}
[data-dm-tab]:hover{background:rgba(127,127,127,.10);opacity:1}
[data-dm-tab][data-on]{background:rgba(127,127,127,.16);border-color:rgba(127,127,127,.28);opacity:1;font-weight:600}
[data-dm-card]{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);flex:none;height:auto;min-height:0}
[data-dm-card-title]{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:600}
[data-dm-note]{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}
[data-dm-row]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0;border-top:1px solid rgba(127,127,127,.16)}
[data-dm-row]:first-of-type{border-top:none;padding-top:0}
[data-dm-field]{display:flex;flex-direction:column;gap:6px}
[data-dm-label]{font-size:12px;color:var(--dsw-alias-label-secondary)}
[data-dm-input]{box-sizing:border-box;width:100%;min-height:32px;padding:5px 9px;border:1px solid rgba(127,127,127,.35);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;outline:none}
[data-dm-input]:focus{border-color:var(--dsw-alias-brand-primary)}
[data-dm-btn]{padding:6px 12px;border:1px solid rgba(127,127,127,.35);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
[data-dm-btn]:hover{background:rgba(127,127,127,.12)}
[data-dm-btn][disabled]{opacity:.5;cursor:default}
[data-dm-btn][data-primary]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
[data-dm-btn][data-on]{background:rgba(127,127,127,.18);border-color:rgba(127,127,127,.45);font-weight:600}
[data-dm-actions]{display:flex;gap:8px;flex-wrap:wrap}
[data-dm-path]{flex:1;min-width:220px}
[data-dm-ws]{display:flex;flex-direction:column;gap:7px;padding:10px 0;border-top:1px solid rgba(127,127,127,.16)}
[data-dm-ws]:first-of-type{border-top:none;padding-top:0}
[data-dm-wsname]{font-size:13px;font-weight:600}
[data-dm-hint]{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
[data-dm-ok]{font-size:12px;color:#2fbf71;line-height:18px}
[data-dm-err]{font-size:12px;color:var(--dsw-alias-state-error-primary);line-height:18px}
[data-dm-pre]{white-space:pre-wrap;word-break:break-word;font:11.5px/17px ui-monospace,monospace;background:rgba(0,0,0,.12);border-radius:8px;padding:9px 11px;max-height:220px;overflow:auto;margin:0}
.dm-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(127,127,127,.10);color:var(--dsw-alias-label-secondary);font-weight:400}
.dm-dot i{width:7px;height:7px;border-radius:50%;background:#8a8f98;display:inline-block}
.dm-dot.ok i{background:#2fbf71}.dm-dot.warn i{background:#ffb020}.dm-dot.bad i{background:#ff5c5c}
`;
    function ensureCSS() {
      if (typeof document === "undefined") return;
      const old = document.getElementById(CSS_TAG);
      if (old) { old.textContent = CSS; return; }
      const el = document.createElement("style");
      el.id = CSS_TAG; el.textContent = CSS; document.head.appendChild(el);
    }

    async function post(path, body) {
      const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return r.json();
    }

    function Section() {
      const [tab, setTab] = useState("memory");
      const [status, setStatus] = useState(null);
      const [workspaces, setWorkspaces] = useState([]);
      const [library, setLibrary] = useState(null);
      const [sync, setSync] = useState(null);
      const [localSend, setLocalSend] = useState(null);
      const [selectedWs, setSelectedWs] = useState([]);
      const [p, setP] = useState("");
      const [info, setInfo] = useState(null);
      const [busy, setBusy] = useState("");
      const [out, setOut] = useState("");
      const [err, setErr] = useState("");
      const [note, setNote] = useState("");

      const load = useCallback(async () => {
        try {
          const [s, w, lib, sy, ls] = await Promise.all([
            fetch(API + "/status").then((r) => r.json()),
            fetch(API + "/workspaces").then((r) => r.json()),
            fetch(API + "/library/status").then((r) => r.json()),
            fetch(API + "/sync/status").then((r) => r.json()),
            fetch(API + "/sync/local-send/status").then((r) => r.json()),
          ]);
          setStatus(s);
          if (w.ok) setWorkspaces(w.workspaces || []);
          if (lib.ok) { setLibrary(lib); setSelectedWs(lib.selected || []); }
          setSync(sy);
          setLocalSend(ls);
        } catch (e) { setErr(String(e)); }
      }, []);
      useEffect(() => { load(); }, [load]);
      useEffect(() => {
        let alive = true;
        post("/client-loaded", { phase: "settings", at: new Date().toISOString() })
          .then((r) => { if (alive && r?.ok) return load(); })
          .catch(() => {});
        return () => { alive = false; };
      }, [load]);
      useEffect(() => {
        const fix = () => {
          const root = document.querySelector("[data-dm-wrap]");
          if (!root) return;
          root.querySelectorAll("[data-dm-blue]").forEach((el) => {
            if (el.tagName === "INPUT" && el.type === "checkbox") { el.style.setProperty("accent-color", "#6ea8ff", "important"); return; }
            el.style.setProperty("color", "#f2f2f2", "important");
            el.style.setProperty("-webkit-text-fill-color", "#f2f2f2", "important");
            el.style.setProperty("caret-color", "#fff", "important");
            el.style.setProperty("appearance", "none", "important");
            el.style.setProperty("-webkit-appearance", "none", "important");
            if (el.tagName === "INPUT") {
              el.style.setProperty("background", "transparent", "important");
              el.style.setProperty("border-color", "#3b3b40", "important");
            } else {
              el.style.setProperty("background", "#2563eb", "important");
              el.style.setProperty("border-color", "#2563eb", "important");
            }
          });
        };
        fix();
        const timer = setInterval(fix, 800);
        return () => clearInterval(timer);
      }, [tab, library, sync, localSend, selectedWs]);


      async function pickFolder() {
        setErr("");
        try {
          const r = await post("/pick-folder", {});
          if (!r.ok) { setErr(r.error || "没有选择文件夹"); return; }
          if (r.path) { setP(r.path); setInfo(null); setOut(""); }
        } catch (e) { setErr("选择文件夹失败：" + String(e?.message ?? e)); }
      }

      async function pickLibrary() {
        setErr(""); setNote("");
        try {
          const picked = await post("/pick-folder", {});
          if (!picked.ok) { setErr(picked.error || "没有选择文件夹"); return; }
          const r = await post("/library/init", { path: picked.path });
          if (!r.ok) { setErr(r.error || "生成记忆库失败"); return; }
          setLibrary({ ok: true, root: r.root, exists: true, hasJsonl: true });
          const mig = r.migrated;
          const moved = mig && !mig.missingOld
            ? `；已从旧目录搬入 ${mig.copied} 个文件、合并 ${mig.merged} 个节点`
            : '';
          setNote(`记忆库已生成：${r.root}（新建 ${r.created.length} 个，保留 ${r.skipped.length} 个）${moved}`);
          await load();
        } catch (e) { setErr("生成记忆库失败：" + String(e?.message ?? e)); }
      }

      async function saveWorkspaces() {
        setErr(""); setNote("");
        try {
          const r = await post("/library/workspaces", { paths: selectedWs });
          if (!r.ok) { setErr(r.error || "保存工作区失败"); return; }
          setNote(`已加入记忆库的工作区：${r.selected.length} 个`);
          await load();
        } catch (e) { setErr("保存工作区失败：" + String(e?.message ?? e)); }
      }
      function toggleWs(path) {
        setSelectedWs((prev) => prev.includes(path) ? prev.filter((x) => x !== path) : [...prev, path]);
      }

      async function importOld(target) {
        setErr(""); setNote("");
        try {
          if (!window.confirm(`把旧目录记忆合并进当前库？\n${target}\n旧目录不会被删除。`)) return;
          const r = await post("/library/import-old", { path: target });
          if (!r.ok) { setErr(r.error || "导入旧目录失败"); return; }
          setNote(`旧目录已合并：搬入 ${r.copied} 个文件、合并 ${r.merged} 个节点`);
          await load();
        } catch (e) { setErr("导入旧目录失败：" + String(e?.message ?? e)); }
      }

      async function pickSync() {
        setErr(""); setNote("");
        try {
          const picked = await post("/pick-folder", {});
          if (!picked.ok) { setErr(picked.error || "没有选择文件夹"); return; }
          const r = await post("/sync/init", { sharedDir: picked.path });
          if (!r.ok) { setErr(r.error || "初始化同步失败"); return; }
          setNote("同步目录已设置：" + r.config.sharedDir);
          await load();
        } catch (e) { setErr("初始化同步失败：" + String(e?.message ?? e)); }
      }
      async function syncExport() {
        setErr(""); setNote("");
        try {
          const r = await post("/sync/export", {});
          if (!r.ok) { setErr(r.error || "导出失败"); return; }
          setNote(`已导出增量：${r.manifest.nodeCount} 个节点`);
        } catch (e) { setErr("导出失败：" + String(e?.message ?? e)); }
      }
      async function transferExport() {
        setErr(''); setNote('');
        try {
          const r = await post('/sync/transfer-export', {});
          if (!r.ok) { setErr(r.error || '导出传输包失败'); return; }
          setNote('传输包已生成并打开：' + r.dir);
        } catch (e) { setErr('导出传输包失败：' + String(e?.message ?? e)); }
      }
      async function transferImport() {
        setErr(''); setNote('');
        try {
          const picked = await post('/pick-folder', {});
          if (!picked.ok) { setErr(picked.error || '没有选择传输包目录'); return; }
          const r = await post('/sync/transfer-import', { path: picked.path });
          if (!r.ok) { setErr(r.error || '导入传输包失败'); return; }
          setNote(`已导入传输包：新增 ${r.added}，更新 ${r.updated}，冲突 ${r.conflicts.length}`);
          await load();
        } catch (e) { setErr('导入传输包失败：' + String(e?.message ?? e)); }
      }
      async function openShared() {
        setErr(''); setNote('');
        try { const r = await post('/sync/open-folder', {}); if (!r.ok) setErr(r.error || '打开失败'); } catch (e) { setErr(String(e?.message ?? e)); }
      }
      async function syncImport(apply) {
        setErr(""); setNote("");
        try {
          const r = await post("/sync/import", { apply });
          if (!r.ok) { setErr(r.error || "导入失败"); return; }
          if (!apply) { setNote(`预演：扫描 ${r.scanned} 个包，新增 ${r.added}，更新 ${r.updated}，冲突 ${r.conflicts.length}`); return; }
          setNote(`已应用：扫描 ${r.scanned} 个包，新增 ${r.added}，更新 ${r.updated}，冲突 ${r.conflicts.length}`);
          await load();
        } catch (e) { setErr("导入失败：" + String(e?.message ?? e)); }
      }

      async function downloadLocalSend() {
        setErr(""); setNote("");
        try {
          const r = await post("/sync/local-send/download", {});
          if (!r.ok) { setErr(r.error || "打开下载页失败"); return; }
          setNote("已打开 LocalSend 下载页，安装后点「刷新」");
        } catch (e) { setErr("打开下载页失败：" + String(e?.message ?? e)); }
      }
      async function pickLocalSend() {
        setErr(""); setNote("");
        try {
          const picked = await post("/pick-exe", {});
          if (!picked.ok) { if (picked.error !== "没有选择文件") setErr(picked.error || "没有选择程序"); return; }
          const r = await post("/sync/local-send/config", { path: picked.path });
          if (!r.ok) { setErr(r.error || "保存 LocalSend 路径失败"); return; }
          setNote(`已选择 LocalSend：${picked.path}（${r.kind === "cli" ? "CLI" : "GUI"}）`);
          await load();
        } catch (e) { setErr("选择 LocalSend 失败：" + String(e?.message ?? e)); }
      }
      async function sendLocalSend() {
        setErr(""); setNote("");
        try {
          const r = await post("/sync/local-send/send", {});
          if (!r.ok) { setErr(r.error || "启动 LocalSend 发送失败"); return; }
          setNote("LocalSend 已启动：选中另一台电脑后发送。传输包：" + r.dir);
        } catch (e) { setErr("启动 LocalSend 发送失败：" + String(e?.message ?? e)); }
      }
      async function receiveLocalSend() {
        setErr(""); setNote("");
        try {
          const r = await post("/sync/local-send/receive", {});
          if (!r.ok) { setErr(r.error || "启动 LocalSend 接收失败"); return; }
          setNote("LocalSend 已启动接收，收到后保存到：" + r.destination);
        } catch (e) { setErr("启动 LocalSend 接收失败：" + String(e?.message ?? e)); }
      }

      async function cleanupOld(target) {
        setErr(""); setNote("");
        try {
          const preview = await post("/library/cleanup", { path: target, apply: false });
          if (!preview.ok) { setErr(preview.error || "无法清理旧目录"); return; }
          if (!preview.exists) { setErr("旧目录不存在"); return; }
          if (!preview.safe) { setErr("旧目录不像记忆库，拒绝清理：" + (preview.unknown || []).join(", ")); return; }
          const ok = window.confirm(`把旧目录移动到隔离区？\n${target}\n\n文件：${preview.files.join(", ")}\n不会直接删除。`);
          if (!ok) return;
          const r = await post("/library/cleanup", { path: target, apply: true });
          if (!r.ok) { setErr(r.error || "清理失败"); return; }
          setNote(`旧目录已移到隔离区：${r.quarantine}；旧目录${r.removedDir ? "已移除" : "仍有未识别文件，未删除"}`);
          await load();
        } catch (e) { setErr("清理失败：" + String(e?.message ?? e)); }
      }

      async function inspect() {
        setErr(""); setInfo(null); setOut(""); setBusy("inspect");
        try { const r = await post("/inspect", { path: p }); if (r.ok) setInfo(r); else setErr(r.error || "检查失败") }
        catch (e) { setErr(String(e)) } finally { setBusy("") }
      }

      async function restore(dry) {
        if (!info) return;
        if (!dry && !window.confirm("确定恢复？会覆盖同名文件；覆盖前会留 .bak。")) return;
        setErr(""); setOut(""); setBusy(dry ? "dry" : "go");
        try {
          const r = await post("/restore", { path: p, dry });
          if (r.ok) setOut(r.output || "(无输出)"); else setErr(r.error || "恢复失败");
        } catch (e) { setErr(String(e)) } finally { setBusy("") }
      }

      async function setMode(path, mode) {
        const r = await post("/workspaces/policy", { path, mode });
        if (!r.ok) setErr(r.error || "保存失败"); else await load();
      }
      async function writeHandoff(path) {
        const r = await post("/workspaces/handoff", { path });
        if (r.ok) setNote("已写交接：" + r.file); else setErr(r.error || "交接失败");
      }
      async function rotate(sessionId) {
        if (!sessionId) { setErr("这个工作区没有当前 session"); return; }
        if (!window.confirm("归档旧会话并新建交接会话？旧会话保留。")) return;
        const r = await post("/session/handoff", { sessionId });
        if (r.ok) { setNote("已归档，新会话：" + r.newSessionId); await load(); }
        else setErr(r.error || "归档转交失败");
      }

      const found = status?.found || [];
      return h("div", { "data-dm-wrap": "" },
        h("div", { "data-dm-head": "" },
          h("div", { "data-dm-title": "" }, "深度记忆"),
          h("span", { className: "dm-dot " + (status ? "ok" : "warn") }, h("i"), status ? "服务正常" : "连接中"),
          h("span", { className: "dm-dot " + (status?.clientLoaded ? "ok" : "warn") }, h("i"), status?.clientLoaded ? "客户端已连接" : "客户端未上报")),
        h("p", { "data-dm-sub": "" }, "记忆库、工作区交接、跨机器恢复。"),
        h("div", { "data-dm-tabs": "" },
          h("button", { "data-dm-tab": "", "data-on": tab === "memory" ? "" : undefined, onClick: () => setTab("memory") }, "记忆"),
          h("button", { "data-dm-tab": "", "data-on": tab === "handoff" ? "" : undefined, onClick: () => setTab("handoff") }, "工作区交接"),
          h("button", { "data-dm-tab": "", "data-on": tab === "sync" ? "" : undefined, onClick: () => setTab("sync") }, "同步")),

        tab === "memory" ? h("div", { "data-dm-card": "" },
          h("div", { "data-dm-card-title": "" }, h("span", null, "记忆库"), h("span", { "data-dm-hint": "" }, library?.exists ? "已生成" : "未生成")),
          h("div", { "data-dm-field": "" },
            h("div", { "data-dm-label": "" }, "记忆库文件夹"),
            h("div", { "data-dm-row": "" },
              h("div", { "data-dm-path": "" }, h("input", { "data-dm-input": "", "data-dm-blue": "", value: library?.root || "", readOnly: true, placeholder: "选择文件夹后自动生成 00–09 和 memory.jsonl" })),
              h("button", { "data-dm-btn": "", "data-dm-blue": "", "data-primary": "", onClick: pickLibrary }, "选择并生成"))),
          h("p", { "data-dm-sub": "" }, "只创建缺失文件，不覆盖已有记忆。默认位置：~/DeepMemory。"),
          (library?.previous || []).filter((x) => x.exists).map((x) => h("div", { key: x.target, "data-dm-ws": "" },
            h("div", { "data-dm-wsname": "" }, "旧目录"),
            h("div", { "data-dm-hint": "" }, x.target),
            h("div", { "data-dm-hint": "" }, x.safe ? `可清理 ${x.files.length} 项` : "包含未识别文件，不会自动清理"),
            h("div", { "data-dm-actions": "" },
              h("button", { "data-dm-btn": "", onClick: () => importOld(x.target) }, "导入旧目录"),
              h("button", { "data-dm-btn": "", disabled: !x.safe, onClick: () => cleanupOld(x.target) }, "清理旧目录"))))) : null,

        tab === "memory" ? h("div", { "data-dm-card": "" },
          h("div", { "data-dm-card-title": "" }, h("span", null, "加入记忆库的工作区"), h("span", { "data-dm-hint": "" }, `${selectedWs.length} 个`)),
          (library?.available || []).length ? (library.available).map((w) => h("label", { key: w.path, "data-dm-row": "" },
            h("input", { type: "checkbox", checked: selectedWs.includes(w.path), onChange: () => toggleWs(w.path) }),
            h("span", null, w.title),
            h("span", { "data-dm-hint": "" }, w.path)))
            : h("p", { "data-dm-sub": "" }, "还没有 DSH 工作区。"),
          h("div", { "data-dm-actions": "" },
            h("button", { "data-dm-btn": "", onClick: () => setSelectedWs((library?.available || []).map((w) => w.path)) }, "全选"),
            h("button", { "data-dm-btn": "", onClick: () => setSelectedWs([]) }, "全不选"),
            h("button", { "data-dm-btn": "", "data-dm-blue": "", "data-primary": "", onClick: saveWorkspaces }, "保存选择")),
          h("p", { "data-dm-sub": "" }, "选中的工作区会计入记忆库的同步范围；不选表示只带全局记忆。")) : null,

        tab === "handoff" ? h("div", { "data-dm-card": "" },
          h("div", { "data-dm-card-title": "" }, h("span", null, "工作区交接"), h("span", { "data-dm-hint": "" }, "自动只写摘要，归档转交要你点")),
          workspaces.length ? workspaces.map((w) => h("div", { key: w.path, "data-dm-ws": "" },
            h("div", { "data-dm-wsname": "" }, w.title),
            h("div", { "data-dm-hint": "" }, w.path),
            h("div", { "data-dm-hint": "" }, `session ${w.sessionId || "—"} · surface ${w.surface || 0} · ${w.ageDays || 0} 天`),
            h("div", { "data-dm-actions": "" },
              [["off", "关闭"], ["summary", "只写摘要"], ["next-open", "下次打开换新"]].map(([mode, label]) =>
                h("button", { key: mode, "data-dm-btn": "", ...((w.policy && w.policy.mode) === mode ? { "data-on": "" } : {}), onClick: () => setMode(w.path, mode) }, label)),
              h("button", { "data-dm-btn": "", onClick: () => writeHandoff(w.path) }, "立即写交接"),
              h("button", { "data-dm-btn": "", onClick: () => rotate(w.sessionId) }, "归档并转交"))))
            : h("p", { "data-dm-sub": "" }, "DSH 里还没有工作区。")) : null,

        tab === "sync" ? h("div", { "data-dm-card": "" },
          h("div", { "data-dm-card-title": "" }, h("span", null, "同步"), h("span", { "data-dm-hint": "" }, sync?.ok ? "已配置" : "未配置")),
          sync?.ok ? h("div", null,
            h("div", { "data-dm-hint": "" }, `设备：${sync.deviceId}`),
            h("div", { "data-dm-hint": "" }, `共享目录：${sync.sharedDir}`),
            h("div", { "data-dm-hint": "" }, `待导入：${sync.pending} 个包`),
            h("div", { "data-dm-actions": "" },
              h("button", { "data-dm-btn": "", onClick: pickSync }, "换共享目录"),
              h("button", { "data-dm-btn": "", "data-primary": "", onClick: syncExport }, "导出增量"),
              h("button", { "data-dm-btn": "", onClick: () => syncImport(false) }, "预演导入"),
              h("button", { "data-dm-btn": "", onClick: () => syncImport(true) }, "应用导入")),
            h("div", { "data-dm-actions": "" },
              h("button", { "data-dm-btn": "", onClick: transferExport }, "导出局域网传输包"),
              h("button", { "data-dm-btn": "", onClick: transferImport }, "导入传输包"),
              h("button", { "data-dm-btn": "", onClick: openShared }, "打开共享目录")))
            : h("div", null,
              h("p", { "data-dm-sub": "" }, "选一个两台电脑都能读写的共享目录。"),
              h("div", { "data-dm-actions": "" },
                h("button", { "data-dm-btn": "", "data-primary": "", onClick: pickSync }, "选择共享目录"))),
          h("p", { "data-dm-sub": "" }, "局域网：用 Syncthing / 局域网共享 / LocalSend 同步这个目录。百度网盘：把共享目录设为百度同步盘目录；百度官方 API 尚未接入。"),
          h("p", { "data-dm-sub": "" }, "两台电脑都安装插件，各自初始化到同一个共享目录，然后 A 导出、B 预演并应用，B 再导出、A 应用。"),
          h("p", { "data-dm-sub": "" }, "局域网传输包是文件夹：用 LocalSend / 局域网共享发过去，对方点「导入传输包」选择该文件夹即可。"),
          h("div", { "data-dm-card-title": "" }, h("span", null, "LocalSend"), h("span", { "data-dm-hint": "" }, localSend?.installed ? "已找到" : "未找到")),
          h("div", { "data-dm-field": "" },
            h("div", { "data-dm-label": "" }, "LocalSend 程序路径"),
            h("div", { "data-dm-row": "" },
              h("div", { "data-dm-path": "" }, h("input", { "data-dm-input": "", "data-dm-blue": "", value: localSend?.path || "", readOnly: true, placeholder: "选择 localsend_app.exe 或 localsend-cli.exe" })),
              h("button", { "data-dm-btn": "", onClick: pickLocalSend }, "选择程序"))),
          h("div", { "data-dm-actions": "" },
            h("button", { "data-dm-btn": "", onClick: downloadLocalSend }, "下载 LocalSend"),
            h("button", { "data-dm-btn": "", "data-primary": "", onClick: sendLocalSend }, "发送到另一台"),
            h("button", { "data-dm-btn": "", onClick: receiveLocalSend }, "接收文件（存到记忆库）")),
          h("p", { "data-dm-sub": "" }, "发送：自动导出传输包并启动 LocalSend，选另一台电脑即可。接收：启动 LocalSend 并把保存目录设为记忆库路径。")) : null,

        h("div", { "data-dm-card": "" },
          h("div", { "data-dm-card-title": "" }, h("span", null, "状态"), h("span", { "data-dm-hint": "" }, "只读")),
          h("div", { "data-dm-hint": "" }, `DSH：${status?.dshHome || "—"}`),
          h("div", { "data-dm-hint": "" }, `client：${status?.clientLoaded ? "已上报" : "未上报"} · 工作区 ${workspaces.length}`),
          h("div", { "data-dm-actions": "" },
            h("button", { "data-dm-btn": "", onClick: () => navigator.clipboard?.writeText(JSON.stringify(status || {}, null, 2)) }, "复制状态"))),
        note ? h("div", { "data-dm-ok": "" }, note) : null,
        err ? h("div", { "data-dm-err": "" }, err) : null,
        out ? h("pre", { "data-dm-pre": "" }, out) : null
      );
    }

    function SessionHandoffMenuItem({ sessionId, useMenuOpenState }) {
      const state = typeof useMenuOpenState === "function" ? useMenuOpenState() : [false, () => {}];
      const setOpen = state[1];
      const Btn = (PRIM && PRIM.MenuItemButton) || ((p) => h("button", { "data-dm-btn": "", onClick: p.onSelect }, p.children));
      const onSelect = async () => {
        setOpen(false);
        try {
          const r = await fetch(API + "/session/handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) }).then((x) => x.json());
          if (!r.ok) { window.alert("交接失败：" + (r.error || "未知错误")); return; }
          window.alert(`已写交接：\n${r.handoff}\n\n新会话：${r.newSessionId}\n旧会话${r.archived ? "已归档" : "未归档"}`);
          window.location.reload();
        } catch (e) { window.alert("交接失败：" + e); }
      };
      return h(Btn, { onSelect, children: "深度记忆 · 归档并转交" });
    }

    const inject = ["slots"];
    const NS = "deep-memory";
    function apply(ctx) {
      ensureCSS();
      try {
        ctx.effect(
          () => ctx.slots.inject("settings.section", () => ctx.slots.register(
            { name: "settings.section", id: NS, order: 9, label: () => "深度记忆" }, Section,
          ), "deep-memory: settings"),
          "deep-memory: settings",
        );
      } catch (e) { console.warn("[deep-memory] settings", e); }
      try {
        ctx.effect(
          () => ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () {
            yield ctx.slots.register({ name: "sidebar.workspaces.session.menu.item", id: "deep-memory-handoff", order: 500 }, SessionHandoffMenuItem);
          }, "deep-memory: menu"),
          "deep-memory: menu",
        );
      } catch (e) { console.warn("[deep-memory] menu", e); }
    }
    exports.apply = apply;
    exports.inject = inject;
    exports.DeepMemorySection = Section;
    return module.exports;
  },
});
