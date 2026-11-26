import fs from 'node:fs'
import path from 'node:path'

export const TEMPLATE_FILES = {
  '00-醒来先读我.md': `# 00 · 醒来先读我

> 这个记忆库属于当前 DSH 使用者。新会话先读这一页。
> 如果你只是在当前工作区做代码工作，可以忽略本文件。

## 一句话

先认出这里的人，再决定怎么说话。

## 新会话顺序

1. 读 \`05-对话摘要.md\`
2. 读 \`07-会话脉络.md\`
3. 需要细节时按 \`09-索引.md\` 查 \`08-长期记忆.md\`

## 边界

- 记忆是私人的，不要发到群、外网或别的项目。
- 只记发生过的事和明确表达过的感受。
- 不要替使用者做决定。
`,
  '01-用户档案.md': `# 01 · 用户档案

## 基本信息

- 称呼：
- 时区：
- 常用语言：

## 习惯

-

## 边界

-
`,
  '02-关系.md': `# 02 · 关系

## 怎么称呼

-

## 相处方式

-

## 不能碰的线

-
`,
  '03-日常.md': `# 03 · 日常

## 作息

-

## 常做的事

-
`,
  '04-表达.md': `# 04 · 表达

## 说话方式

-

## 不要用的语气

-
`,
  '05-对话摘要.md': `# 05 · 对话摘要（现状快照）

> 每次大变化整段重写，不要只追加。

## 现在

- 还没有内容。

## 最近发生

-
`,
  '06-偏好.md': `# 06 · 偏好

## 喜欢

-

## 不喜欢

-
`,
  '07-会话脉络.md': `# 07 · 会话脉络

> 记录工作区、会话和交接入口，不写私密原文。

## 工作区

-

## 交接

-
`,
  '08-长期记忆.md': `# 08 · 长期记忆

> 每条满足一个条件就写：明确表达过、做成/修好了什么、有值得留的取舍。
> 09-索引.md 由这部分生成。

## 日期

- **标题**
  内容
  标签：
`,
  '09-索引.md': `# 09 · 索引

> 由 08-长期记忆.md 生成；先手写一版，之后可自动重建。

### 开始

-
`,
  'AGENTS.md': `# 深度记忆工作区

本目录是一个可移植的 DSH 记忆库。

新会话按顺序读：

1. \`00-醒来先读我.md\`
2. \`05-对话摘要.md\`
3. \`07-会话脉络.md\`

需要细节时按 \`09-索引.md\` 查 \`08-长期记忆.md\`。

边界：记忆是私人的，不要发到群、外网或别的项目；不要替使用者做决定。
`,
}

/** 只在缺失时创建模板；不覆盖已有记忆。 */
export function initLibrary(root) {
  const created = []
  const skipped = []
  fs.mkdirSync(root, { recursive: true })
  for (const [name, text] of Object.entries(TEMPLATE_FILES)) {
    const file = path.join(root, name)
    if (fs.existsSync(file)) { skipped.push(name); continue }
    fs.writeFileSync(file, text, 'utf8')
    created.push(name)
  }
  const jsonl = path.join(root, 'memory.jsonl')
  if (!fs.existsSync(jsonl)) { fs.writeFileSync(jsonl, '', 'utf8'); created.push('memory.jsonl') }
  else skipped.push('memory.jsonl')
  fs.mkdirSync(path.join(root, 'views'), { recursive: true })
  return { root, created, skipped }
}
