# 多席位助手（Seats）

一个总台，多个席位。每个席位有自己的目录、自己的规则、自己的记忆，干完活把结论报回总台。

这是把 pi 里「主 agent 用 `acp_delegate` 派 worker」的做法搬进 G-LLM。区别在于 G-LLM 的席位是持久实体：目录、规则、账本、记忆留在磁盘上，跨会话、跨天累积。

## 与 pi 的对应关系

| pi | G-LLM | 说明 |
| --- | --- | --- |
| `acp_delegate(agent: "worker", task)` | `delegate_assistant(assistantId, task)` | 派发入口 |
| worker 拿到干净 context | 席位只带自己的 AGENTS.md / MEMORY.md / 最近日志 | 不继承父会话内容 |
| worker 用同一套工具 | 席位有完整工作区工具集 | 读写文件、跑 Python/Shell、搜索 |
| 返回一段结论 | 返回结论 + 改动文件清单 | 总台知道席位干了什么 |
| 无持久身份 | `Assistant` 记录 + 磁盘目录 | 席位跨会话一致 |

## 数据模型

`Assistant` 上新增两个字段：

- `workspaceRoot?: string` —— 这个席位自己的目录。留空则跟随会话工作区。
- `parentAssistantId?: string` —— 上级总台，用于界面分组。

授权关系仍是 `delegateAssistantIds`：只有总台勾选过的助手才能被派发。

## 一次派发发生什么

总台调用 `delegate_assistant` 之后：

1. **权限检查** —— 目标必须在总台的 `delegateAssistantIds` 里、状态为 active、不在调用路径上、深度和次数未超限。
2. **切目录** —— 席位配了 `workspaceRoot`，这次运行的工作区就是那个目录；没配则沿用总台的。
3. **装上下文** —— 读席位的 `AGENTS.md`、`.workbuddy/memory/MEMORY.md`（或根目录 `MEMORY.md`）、`.workbuddy/memory/` 里最新一天的日志，拼成任务前置。
4. **跑完整循环** —— 席位走和主窗口一样的 Agent 循环：读写文件、跑 Python/Shell、搜索、自我验证。
5. **回报** —— 总台收到「文字结论 + 该席位本轮改动的文件清单」。

派发是串行的：总台在 `await` 里等席位跑完才继续。所以即使席位目录和总台目录相同，也不会同时写同一个文件。

## 配置一套席位

以 `C:\Users\jifeicmk\Desktop\vb\AI交易系统_五席位` 为例。

### 1. 建总台

助手设置里新建一个助手，例如「总台」。

- **系统提示词**：写它负责收发、分派、汇总，不自己下交易判断。
- **工作区目录**：填 `C:\Users\jifeicmk\Desktop\vb\AI交易系统_五席位`
- **允许调用的其他助手**：勾上所有席位

### 2. 建席位

每个席位一个助手，工作区目录填自己的子目录：

| 助手 | 工作区目录 |
| --- | --- |
| 大投机家利弗莫尔 | `...\AI交易系统_五席位\大投机家利弗莫尔` |
| 炒股养家_游资短线 | `...\AI交易系统_五席位\炒股养家_游资短线` |
| 德国股神科斯托拉尼 | `...\AI交易系统_五席位\德国股神科斯托拉尼` |
| 股神巴菲特A股交易 | `...\AI交易系统_五席位\股神巴菲特A股交易` |

席位的工作区目录**必填**。留空的话它会在总台目录里干活，找不到自己的账本和记忆。

### 3. 会话工作区权限

总台会话的工作区必须开到**读写**。只读权限下席位改不了账本。

### 4. 试派发

在总台会话里说：

> 让利弗莫尔看一眼今天的成交，把判断写进它自己的账本

总台会调 `delegate_assistant`，活动面板能看到席位的工具调用。

## 席位目录约定

派发时自动读取这三份内容，作为任务前置：

```
<席位目录>/
├─ AGENTS.md                    工作规则（最多 20000 字符）
├─ .workbuddy/memory/
│  ├─ MEMORY.md                 长期状态（最多 40000 字符）
│  └─ 2026-11-19.md             最新一天的日志（只取最新一份，最多 20000 字符）
└─ ...
```

没有 `.workbuddy` 的普通目录会退回读根目录的 `MEMORY.md`。席位不需要自己先去找这些文件。

## 开箱导入整个目录

不用一个个建。顶栏点导入按钮（文件夹图标），选一个根目录，例如 `C:\Users\jifeicmk\Desktop\vb\AI交易系统_五席位`：

1. 根目录变成总台 —— `workspaceRoot` 是根目录本身，`delegateAssistantIds` 自动填满所有席位。
2. 每个含 `AGENTS.md` / `MEMORY.md` / `data/` / `.workbuddy/` 的子目录变成一个席位 —— `workspaceRoot` 指向该子目录，系统提示词取它自己的 `AGENTS.md`（最多 6000 字符）。
3. 没有这些标记的子目录跳过，导入结果会告诉你是哪些。

导入后侧栏里席位缩进挂在总台下面（`.assistant-card-child`），点总台就能派活。

## 会议室

席位共用的 `AI会议室.txt` 有一个只读视图：顶栏打开会议室，按帖子分块显示全部帖子，带写入时间和正文。数据由 `src/main/meetingRoom.ts` 解析（按「署名 / 写入时间 / 64 个等号」三个特征切块，识别 `(YYYY-MM-DD HH:mm:ss)` 与 `（YYYY-MM-DD HH:mm:ss）` 两种时间写法），不依赖具体行数，日志再长也只读尾部。

发帖走 `meeting_post` 工具，必须存在 `data/append_room.ps1`：缺失时直接报错，不会退化成直接写文件。写入后不做回读校验，只回传脚本输出的时间戳与字节数。

定位房间时显式传 `-Room`，不用脚本的环境变量默认值。因为 `AI_ROOM_FILE` 一旦被设成别的路径，默认值会写到和读取不同的文件 —— 读 70 帖、写另一份，看起来“发帖成功但看不见”。

## 限制

诚实列出来。

- **派发预算**：一轮最多 12 次、最多 2 层，调用路径不能重复出现同一助手。六席位够用，要更多得改 `createDelegationContext`。
- **串行**：总台等一个席位跑完才派下一个。六个席位依次跑，不是并行。
- **子会话落库且实时可见**：席位的运行记录用 `<父会话 id>::<席位 id>` 作会话 id 写进 `saveConversation`，同时向渲染进程广播 `conversation:changed`（`src/main/workspaceAgent.ts` → `src/preload/index.ts` → `src/renderer/src/App.tsx` 的 `onConversationChanged`），侧栏不用重启就能看到席位会话。总台不另建汇总结论会话，席位结论直接回到总台这一轮的对话里。
- **席位模型已生效**：席位自己的 `modelProviderId` / `modelId` 优先，回退到会话模型。
- **审批文案不区分席位**：席位遇到需要审批的写操作会把请求转发到总台的审批界面，但界面上看不出是哪个席位在请求。
- **不支持席位间横向调用**：只设计成总台派席位。席位再派别的席位受 2 层深度限制，实际不建议用。

## 相关代码

| 位置 | 作用 |
| --- | --- |
| `src/shared/types.ts` `Assistant.workspaceRoot` | 席位目录字段 |
| `src/shared/assistantDelegation.ts` `createDelegationContext` | 派发预算（12 次 / 2 层） |
| `src/main/workspaceAgent.ts` `readSeatContextFiles` | 读席位规则、记忆、最新日志 |
| `src/main/workspaceAgent.ts` `executeAssistantDelegation` | 派发执行入口 |
| `src/main/assistantImport.ts` `importAssistantsFromDirectory` | 从目录批量建总台与席位（纯逻辑在 `assistantImportPlan.ts`） |
| `src/main/meetingRoom.ts` | 会议室读取与发帖 |
| `src/main/storage.ts` `sanitizeAssistant` | 字段落盘时的清洗 |
| `src/renderer/src/App.tsx` | 助手设置里的「工作区目录」输入框 |

## 验证记录

以下结果是实际跑出来的，不是设计设想。

1. **会议室解析**：对真实 `vb/AI交易系统_五席位/AI会议室.txt` 跑解析器，得到 70 帖 / 11 个署名 / `tailComplete=true` / 630746 字节；`scripts/meeting-smoke.mts` 在临时目录用真实 `append_room.ps1` 发帖，从 1 帖变 2 帖，署名、正文、时间一致。
2. **会话落库**：用 esbuild 把 `src/main/storage.ts` 打成 cjs，在 `app.setPath('userData', <临时目录>)` 下调用 `saveConversation({ id: 'parent-conv::seat-livermore', ... })`，再 `getConversations()` 与 `getConversationById()` 都能取到，`messages` 为 2，`assistantId` 为席位 id。说明 `父会话id::席位id` 这种 id 能被 storage 正常保存与列出。
3. **目录导入**：对真实 `vb/AI交易系统_五席位` 跑 `planAssistantImport`，识别出总台 + 7 个席位（`artifacts` / `Task` / `_archive` / `_research` / `__pycache__` / `_总台` 被跳过并给出原因）；再拿用户真实库里的 3 个助手当 `existing` 连续导入两次，第二次 id 全部复用，总数 3 + 1 + 7 = 11，没有重复。
4. **构建与测试**：`npx tsc --noEmit` 无错误；`npm run build`（i18n:check + licenses + tsc + electron-vite build + bundle:verify）通过；`npm run test:assistant-platform` 17 项通过（含 `src/main/assistantImport.test.ts` 的 3 项）；`i18n:check` 校验 1369 个键。
5. **打包**：`npm run package:win` 产出 `dist/G-LLM-Client-Setup-2.0.31-x64.exe`，211.8 MB。**未签名**（`Get-AuthenticodeSignature` 返回 `NotSigned`，仓库历史上也不签名），安装时会有 SmartScreen 提示，属预期。

没有覆盖到的：真机点开 app 手动派发一次。这条路径需要真实 API Key 和用户交互，自动化脚本只能验到 storage 与解析层。
