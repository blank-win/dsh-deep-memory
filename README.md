# 深度记忆（dsh-deep-memory）

## 介绍

`深度记忆` 是给 DSH 用的可移植记忆库插件。

它解决的不是“模型参数里记住你”，而是：

- 记忆存在本地文件里
- 换会话、重启、换电脑后还能读回来
- 记忆和聊天记录分开保存
- 用户可以自己选择记忆库放在哪
- 可以只把选中的工作区纳入记忆库

它不包含 QQ、B站或其他角色插件的记忆卡，也不写死任何人的私人路径。

---

## 功能

### 1. 记忆库

- 选择一个文件夹
- 自动生成 00–09 记忆模板
- 生成 `AGENTS.md`
- 生成 `memory.jsonl`
- 生成 `views/`
- 只创建缺失文件，不覆盖已有记忆
- 更换文件夹时自动搬运旧记忆
- 旧目录可以导入，也可以清理到隔离区
- 可以勾选哪些工作区计入记忆库

默认记忆库位置：

```text
~/DeepMemory
```

实际路径保存在：

```text
~/.dsh/deep-memory/library.json
```

### 2. 记忆文件结构

```text
00-醒来先读我.md
01-用户档案.md
02-关系.md
03-日常.md
04-表达.md
05-对话摘要.md
06-偏好.md
07-会话脉络.md
08-长期记忆.md
09-索引.md
AGENTS.md
memory.jsonl
views/
日记/
  2026-11-13.md
  index.json
```

其中：

- `00–09` 是给人看的 Markdown
- `memory.jsonl` 是机器索引（每个 node 可带 `src` 指回原话）
- `views/` 是从索引生成的可读视图
- `日记/` 是**按天的原话留底**（见下节）
- `AGENTS.md` 告诉新会话先读哪些文件

### 3. 日记（原话留底）

摘要解决“记得住”，解决不了“回得去”。`memory.jsonl` 里的 node 是压缩后的文本，
换会话以后就再也翻不到原话；日记补的就是这一段。

- 每天一个 `日记/YYYY-MM-DD.md`，从 `<DSH_HOME>/sessions/` 的会话日志里抄录当日原话
- 每条后面带锚点：`<!-- src: session-<id>#seq=<seq> -->`，
  能直接定位到 `sessions/<工作区>/session-<id>/session.v4.jsonl.zstd` 里 `seq` 那一条
- 只抄不改：用户与助手的可见文本；跳过 reasoning、工具调用、以及
  `[记忆检索]`／`Current runtime context.`／`Time sampled while preparing turn`／
  角色卡模板等系统注入片段
- 同一天里反复注入的同一段话只留一条
- `日记/index.json` 记录每天的会话数、消息数、字节数
- 落地时机：插件启动 5 秒后补昨天+今天，之后每 15 分钟重写今天（历史日期不重写）

`memory.jsonl` 的 node 新增可选字段 `src`：

```json
{
  "source": "日记/2026-11-13.md",
  "src": { "session": "session-xxxx", "seq": 1234, "at": 1763000000000, "role": "user", "diary": "日记/2026-11-13.md" }
}
```

有了 `src`，记忆卡上的一条就能指出“这句话是哪天几点、哪个会话、第几条记录”，而不是只给一段空口摘要。

### 4. 工作区交接

- 每个工作区可以选：
  - 关闭
  - 只写摘要
  - 下次打开换新
- 可以立即写一份交接
- 可以在会话菜单里「归档并转交」
- 旧会话保留，不删除

### 5. 认识层（wiki）

「发生了什么」写在记忆库，「这个人是谁」写在这里。

- 目录：`<记忆库>/认识/`
- 一个主题一页，页名就是标题（比如「人」、「工作」、「日常」）
- 页里用 `[[另一个标题]]` 互相链接，`目录.md` 由插件自动重建，断链会标出来
- 接口：`GET /wiki/status`、`GET /wiki/list`、`GET /wiki/read?name=`、`POST /wiki/write`、`POST /wiki/reindex`
- 每晚 22 点后，如果当天还没素材文件，会自动生成 `认识/_今日素材-<日期>.md`
  （从当天的日记和手机回传里抽），供下一轮整理用

### 6. 搬家包

`GET /move/status` 看桌面有没有 `小白搬家包.zip`，`GET /move/download` 直接下载。

搬家包里带：记忆库、配置、面板程序、插件清单（哪些是 npm 装的、哪些是本地 link 的）。
换机器时按清单把 link 的目录放回原路径，再跑一次 `npm install` 就行。

### 7. 同步

支持两种方式。

#### 共享目录

适合：

- Syncthing
- 局域网共享文件夹
- 百度网盘同步盘

流程：

```text
A：选择共享目录 → 导出增量
传输
B：选择同一个共享目录 → 预演导入 → 应用导入
B：导出增量
A：应用导入
```

共享目录只负责搬运，不是插件自己开服务器。

#### LocalSend

适合一次性或临时传输。

插件可以：

- 下载 LocalSend
- 用文件选择框指定 `localsend_app.exe` 或 `localsend-cli.exe`
- 发送时自动导出传输包并启动 LocalSend
- 接收时启动 LocalSend，并把接收目录设为当前记忆库路径

注意：

- `localsend-cli.exe` 才能真正自动指定发送文件和接收目录
- `localsend_app.exe` 只能启动 GUI，仍需在 LocalSend 里手动选设备、手动设置接收目录

### 8. 百度网盘

目前**没有接入百度官方 API**。

当前只支持：

```text
共享目录 → 百度网盘同步盘 → 另一台电脑
```

记忆包是明文的，不建议直接放到公开网盘。更稳的是局域网共享、Syncthing 或 LocalSend。

---

## 安装

从 GitHub 直接安装（推荐）：

```powershell
dsh plugin --profile desktop add "github:blank-win/dsh-deep-memory"
# 或
dsh plugin --profile desktop add "https://github.com/blank-win/dsh-deep-memory"
```

也可以下载源码后本地安装：

```powershell
dsh plugin --profile desktop add "link:<插件目录>"
```

然后完全退出 DSH，再重新打开。

打开后：

```text
设置 → 深度记忆
```

如果 DSH 版本不支持 `plugin add`，也可以手动把插件目录挂到 desktop profile，参考 DSH 的插件安装方式。

---

## 使用说明

### 第一次使用

1. 打开 `设置 → 深度记忆`
2. 进入「记忆」
3. 点「选择并生成」
4. 选择一个空文件夹
5. 插件自动创建 00–09、`AGENTS.md`、`memory.jsonl`、`views/`
6. 重启 DSH
7. 新会话会按 `AGENTS.md` 读取记忆库

### 加入工作区

在「记忆」页：

- 勾选需要加入记忆库的工作区
- 点「保存选择」
- 不勾选表示只同步全局记忆

### 更换记忆库文件夹

1. 点「选择并生成」
2. 选择新文件夹
3. 插件会先把旧记忆库的内容复制/合并过去
4. 旧目录会显示在「旧目录」区域
5. 可以：
   - 导入旧目录
   - 清理旧目录

清理不是直接删除，而是移动到：

```text
~/.dsh/deep-memory/trash
```

确认没问题后，再手动清空隔离区。

### 工作区交接

进入「工作区交接」页：

- 选择策略
- 点「立即写交接」只写文件
- 点「归档并转交」会新建会话并归档旧会话

「归档并转交」需要 DSH 的 sessionController / workspaceRegistry 正常可用。

### 两台电脑同步

#### 共享目录方式

1. 两台电脑都安装插件
2. A 选择共享目录
3. A 导出增量
4. 用 Syncthing / 局域网共享 / 百度同步盘把目录同步到 B
5. B 选择同一个共享目录
6. B 预演导入
7. B 应用导入
8. B 导出增量
9. A 预演并应用

#### LocalSend 方式

1. 点「下载 LocalSend」并安装
2. 点「选择程序」，选择本机的 LocalSend exe
3. A 点「发送到另一台」
4. 传输包会生成到：

```text
~/DeepMemoryTransfer
```

5. LocalSend 启动后选择 B
6. B 点「接收文件（存到记忆库）」
7. B 接收后文件会落到 B 的记忆库路径

要自动接收，请选择 `localsend-cli.exe`。

---

## 隐私与安全

- 插件只监听本机回环地址
- 不会把记忆内容上传到插件自己的服务器
- 不会保存 QQ/B站 token
- 记忆库是明文文件，存放在本机，由使用者自行保管
- 本仓库不包含任何 token、cookies 或聊天记录
- 跨机器传输建议使用局域网或加密压缩包

---

## 已知限制

- LocalSend GUI 不能完全自动发送/接收
- 百度官方 API 未接入
- 没有自动加密
- 冲突不会自动合并，只会保留并报告
- 需要 DSH 的 `sessionController` / `workspaceRegistry` 才能归档转交
- 换电脑后如果记忆内容为空，先检查是否只复制了 `memory.jsonl`，没有复制 `views/` 或 00–09
- 日记只抄「用户和助手的可见文本」，工具调用、思考过程、系统注入片段不记录；因此日记不是完整审计日志
- 日记的锚点指向 `<DSH_HOME>/sessions/` 下的会话日志，日志被清理后锚点就失效了（原文仍在 `日记/*.md` 里）
- 每天日记的自动刷新依赖会话日志已落盘；当天日志还没写完时重写会被跳过（只增不减，避免把已有内容覆盖成空白）

---

## 常见问题

### 设置页显示「客户端未上报」

完全退出 DSH 再打开。新版客户端会在设置页打开时主动上报一次。

### 按钮或输入框看不清

新版已强制使用深色/蓝色控件样式。升级后需要重启 DSH。

### LocalSend 没识别到

点「选择程序」，手动选择：

```text
localsend_app.exe
```

或：

```text
localsend-cli.exe
```

### 归档并转交提示找不到工作区

确认 DSH 已经完全重启；插件会先按全部 sessionIds 匹配，再查运行中的 workspaceRegistry，最后用插件工作目录兜底。

### 换了记忆库后旧记忆没过去

进入「记忆」页，看「旧目录」区域：

- 先点「导入旧目录」
- 再点「清理旧目录」

---

## 目录说明

```text
index.js                      插件服务端
workspaces.js                 工作区、交接、会话匹配
client-simple.js              设置页客户端
lib/memory-core.mjs           记忆节点、检索、衰减、晋升
lib/memory-sync.mjs           共享目录双向同步
lib/library-template.mjs      记忆库模板
lib/library-migrate.mjs       旧库迁移
lib/diary.mjs                 日记：按天抄录原话 + src 锚点
scripts/make-memory-card.mjs  生成记忆卡（短卡会同步进 AGENTS.md）
scripts/migrate-memory-library.mjs
scripts/memory-sync.mjs
```

---

## 更新记录

### 0.4.0
- **认识层**：新增 `<记忆库>/认识/`，一个主题一页，`[[标题]]` 互链，目录自动重建，断链会标出来。
  每晚 22 点后自动生成当天素材（日记 + 手机回传），供整理用。
- **搬家包**：`/move/status` 和 `/move/download`，配合面板「备份」按钮生成 `小白搬家包.zip`，
  里面带插件清单（npm / 本地 link 分开记）。
- 去掉两处硬编码的本机路径。

### 0.3.1
- **修「多帧日志只解第一帧」**：会话日志是「一帧一条记录」的多帧 zstd，而宿主运行时 node 24.21 的 `zstdDecompressSync` 与 `createZstdDecompress` 都只解第一帧（9.7 MB 的日志只出 192 字节），24.22 才修好。现在自己扫帧头逐帧解，不依赖运行时版本。修之前 11-14、11-15 两天日记是空的（239 字节），修之后分别是 237 / 56 条。
- 解压或读取失败不再静默：`/diary/status` 多返回 `failures` 和 `failureCount`，能看出最近哪几个会话日志读不了。
- `collectDay` / `writeDay` 改成异步（配合逐帧解码）。

### 0.1.1
- 修复：工作区交接文档里的「记忆库」路径写死 `~/DeepMemory`（还重复写了两遍），
  忽略了 `library.json` 里配置的真实 root（比如把记忆库放在非默认盘符的某个目录），导致交接文档指向一个不存在的目录。
  现在按 `library.json.root` → `previousRoots` → `~/DeepMemory` 依次解析，取第一个真实存在的。
- 交接文档只列记忆库里**实际存在**的 `00/05/07/09`，缺哪个就在提示里说明。
- 投影缓存拿不到轮次摘要时，明确写「没有轮次摘要」，不再留空白让人误以为读完了。

---

## 许可

MIT License。
