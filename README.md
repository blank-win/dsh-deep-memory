[深度记忆-介绍与使用.md](https://github.com/user-attachments/files/34326078/-.md)
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
```

其中：

- `00–09` 是给人看的 Markdown
- `memory.jsonl` 是机器索引
- `views/` 是从索引生成的可读视图
- `AGENTS.md` 告诉新会话先读哪些文件

### 3. 工作区交接

- 每个工作区可以选：
  - 关闭
  - 只写摘要
  - 下次打开换新
- 可以立即写一份交接
- 可以在会话菜单里「归档并转交」
- 旧会话保留，不删除

### 4. 同步

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

### 5. 百度网盘

目前**没有接入百度官方 API**。

当前只支持：

```text
共享目录 → 百度网盘同步盘 → 另一台电脑
```

记忆包是明文的，不建议直接放到公开网盘。更稳的是局域网共享、Syncthing 或 LocalSend。

---

## 安装

从 GitHub 下载源码后：

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
- 记忆库是明文文件，请自行保护
- 不要把私人记忆放进公开仓库
- 不要把 `cookies.txt`、token、聊天记录提交到 GitHub
- 跨机器传输建议使用局域网或加密压缩包

---

## 已知限制

- LocalSend GUI 不能完全自动发送/接收
- 百度官方 API 未接入
- 没有自动加密
- 冲突不会自动合并，只会保留并报告
- 需要 DSH 的 `sessionController` / `workspaceRegistry` 才能归档转交
- 换电脑后如果记忆内容为空，先检查是否只复制了 `memory.jsonl`，没有复制 `views/` 或 00–09

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
scripts/migrate-memory-library.mjs
scripts/memory-sync.mjs
```

---

## 许可

MIT License。
