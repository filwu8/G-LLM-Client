# Agent 工具内化设计（todo + goal + codemode + search_tools）

> 实施状态：四步全部落地并通过 `tsc --noEmit` / 单测 / `i18n:check`。
> `todo`（`workspaceAgent.ts` 的 `todo` 工具）、`goal`（`action=propose`，幂等更新验收标准）、
> `codemode`（`node:vm` 沙箱，白名单 7 个只读工具）、`search_tools`（`DEFERRED_TOOL_NAMES` 折叠 12 个低频工具）。

本文评估把 pi 的工具能力内化到 G-LLM-Client，并给出实施顺序、改动清单和风险。

## 结论

核心判断：**`todo` 和 `goal` 是两个独立工具，不合并**。`goal` 是目标（why，跨会话），`todo` 是拆分（how，单次 run）。两者共用一套不变式：goal 的 `acceptanceCriteria` 可被模型提议、只收紧不放宽；todo 挂在 `executionPlan` 上存 checkpoint。

| 能力 | 现状 | 结论 | 主要收益 |
|---|---|---|---|
| `todo` 工具（新增） | `AgentExecutionPlan` 是硬编码 5 阶段，模型看不见也改不了 | 新增独立工具 | 模型可拆步、报告进度，checkpoint 秒级恢复 |
| `goal` 工具（新增） | `GoalTask` 只能用户手动启动 | 新增 `propose` 动作 | 模型可提议目标，用户仍拥有最终决定权 |
| `codemode` | 工具串行执行，N 次工具调用 = N 次模型往返 | 加 | 把批量读写压成 1 次往返 |
| `tool-search` | 31 个工具定义全量注入，约 8–12K tokens/请求 | 加，但只折叠低频工具 | 省 5–7K tokens/请求 |

自动任务的**执行侧**不需要内化（continuous 模式、checkpoint、停滞检测、结构化验收已经比 pi 强）。要补的是**规划侧**：模型目前无法主动建清单，也无法主动升级成 goal。

---

## 一、现有架构（调研结论）

| 位置 | 机制 | 对内化的意义 |
|---|---|---|
| `src/main/workspaceAgent.ts:240-317` `getWorkspaceToolDefinitions` | 工具定义用 `...(condition ? [...] : [])` 条件注入 | tool-search 的天然接入点 |
| `src/main/workspaceAgent.ts:790-1087` `executeTool` | if-else 链，30+ 个 `if (name === 'x') return` 分支 | 新工具的插入点，不需要重构 |
| `src/main/workspaceAgent.ts:1257-2248` `runWorkspaceAgentUnlocked` | 主循环，约 1000 行 | todo 状态和验收逻辑都在这里 |
| `src/main/workspaceAgent.ts:1647` | `for (let turn = 0; turn < maxTurns;)` | 轮次上限 |
| `src/main/workspaceAgent.ts:2172-2174` | 每次只 `await` 一个工具，**串行** | codemode 的核心价值依据 |
| `src/main/workspaceAgent.ts:697-757` `runWorkspaceJavascript` | 写脚本到 `.gllm/runs/`，用 `process.execPath --permission` 跑子进程，30s 超时 | codemode 可参考，但不能直接复用（见三） |
| `src/shared/agentPlanning.ts:9-22` `createWorkspacePlan` | 固定 5 步：understand / inspect / execute / verify / deliver | todo 的改造对象 |
| `src/main/workspaceAgent.ts:1306` | `let executionPlan = createWorkspacePlan(latestUserRequest)` | todo 状态的载体候选 |
| `src/main/workspaceAgent.ts:1559-1563` | 结构化验收提示，要求模型返回 `{workspaceStatus, verification, final}` | todo 要接进这里 |
| `src/main/workspaceAgent.ts:1311-1314` | `checkpointStore.save({turns, summary, activities, changedFiles, evidence, stalledTurns})` | todo 要写进 checkpoint 才能跨轮恢复 |
| `src/shared/types.ts:480-503` `GoalTask` | 含 `goal` / `acceptanceCriteria` / `status` / `lastPlan` / `assumptions` / `runCount` | 模型可调整的字段入口 |
| `src/shared/types.ts:387-404` `GoalDraft` | `clarifying` → `ready` → 转 `GoalTask`，由 LLM 澄清并收敛目标 | **已有模型参与的 goal 创建链路，只缺「模型主动发起」** |
| `src/renderer/src/App.tsx:3323-3345` `launchGoalFromDraft` | UI 侧完成 draft → GoalTask 的转换 | 模型要能触发这条路径 |
| `src/shared/goalContext.ts:39` `resolveGoalContextMode` | goal 的上下文隔离策略 | goal 升级时复用 |

### 自动任务现状（执行侧已具备，不需要内化）

```ts
// workspaceAgent.ts:1272-1273
const { maxTurns, maxDurationMs } = normalizeGoalExecutionLimits(request.executionLimits)
const continuous = !request.executionLimits       // 无限制时进入连续模式
```

- `continuous` 模式下自动压缩历史并继续（`workspaceAgent.ts:1649-1652`，阈值 `WORKSPACE_TURN_CHECKPOINT = 14` 轮 或 50K 字符）
- 停滞检测：`MAX_STALLED_WORKSPACE_TURNS = 6`（`workspaceAgent.ts:338`）
- checkpoint 持久化 + 恢复（`workspaceAgent.ts:1311`）
- 证据去重：sha256 指纹（`workspaceAgent.ts:2185`）
- 结构化验收，`completed` / `blocked` 二选一（`workspaceAgent.ts:1559-1563`）

pi 没有这些东西。所以执行侧不动。

---

## 二、todo 与 goal：两个独立工具

两者不共享存储、不共享生命周期：`todo` 挂在 `executionPlan` 上存 checkpoint（单次 run），`goal` 存 conversation（跨会话）。连接方式是单向的——有 goal 时，模型可依据 `acceptanceCriteria` 拆 todo；没有 goal 时 todo 独立存在。

### 2.1 现状：两套互不相通的机制

**GoalTask（`types.ts:480-503`）** —— 长期目标，跨会话，可暂停恢复。

```
用户点 goal 按钮（App.tsx:4674）→ GoalDraft 进入 clarifying
  → LLM 澄清收敛（types.ts:387-404）
  → launchGoalFromDraft（App.tsx:3323）→ GoalTask 落库（storage.ts:1874）
  → 每轮带 goalId 跑 agent（App.tsx:2766）
```

问题：**入口只有 UI 按钮**。模型看见用户实际在做一个 20 步重构，也只能一轮轮硬做，没法说「这个该开 goal」。

**AgentExecutionPlan（`agentPlanning.ts:9-22`）** —— 单次 run 的 5 个固定阶段，运行时自动推进。模型看不见也改不了。

问题：**execute 阶段是黑盒**。8 步任务的进度只存在于对话历史里，compacting 一触发就只剩 checkpoint 的自然语言摘要。

### 2.2 设计：三层结构

| 层 | 载体 | 生命周期 | 谁创建 | 模型可改 |
|---|---|---|---|---|
| L1 计划骨架 | `AgentExecutionPlan` 5 阶段 | 单次 run | 运行时 | ❌ 保留不动 |
| L2 步骤清单 | 新增 `todo` steps，挂在 `executionPlan` | 单次 run，存 checkpoint | **模型自动** | ✅ 完全可改 |
| L3 目标 | `GoalTask` | 跨会话 | 用户启动 **或模型提议** | ✅ 只能收紧验收标准 |

三者关系：**L3 是 why，L2 是 how，L1 是 when**。有 goal 时 todo 从 `acceptanceCriteria` 拆解；没有 goal 时 todo 独立存在。

融合的关键是**不合并对象**：todo 存 checkpoint（单次 run 级），goal 存 conversation（跨会话级）。融合靠「goal 创建时生成 todo」和「todo 完成时驱动 goal 验收」，而不是塞进同一个结构。

### 2.3 todo 工具

```ts
{ type: 'function', function: {
  name: 'todo',
  description: '管理本次任务的步骤清单。预计 3 步以上就先拆清单再动手，不要边猜边做。步骤是给用户看的进度，不是备忘录。固定阶段（understand/inspect/execute/verify/deliver）由运行时维护，不要在此重复。执行中发现步骤要变，直接改清单，不要口头说明。',
  parameters: { type: 'object', required: ['action'], properties: {
    action: { type: 'string', enum: ['create', 'update', 'list'], description: 'create 建清单会替换旧清单；update 改单项；list 读当前状态' },
    tasks: { type: 'array', maxItems: 20, description: 'action=create 时必填', items: {
      type: 'object', required: ['subject'], properties: {
        subject: { type: 'string', description: '简短祈使句，如「迁移 auth 中间件」' },
        activeForm: { type: 'string', description: '进行时标签，如「正在迁移 auth 中间件」' }
      }
    }},
    id: { type: 'string', description: 'action=update 时必填' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'] }
  }}
}}
```

**约束**：同一时刻只能有一个 `in_progress`（`agentPlanning.ts` 里强制，和 pi 行为对齐）。违反时把前一个自动置为 `pending`，不报错——报错会让模型浪费一轮。

### 2.4 goal 工具（新增：模型可创建/提议/调整）

现在模型完全无法操作 GoalTask。加一个工具，但**创建必须经用户确认**——这是授权边界，不能模型自己开长期任务烧 token。

```ts
{ type: 'function', function: {
  name: 'goal',
  description: '管理长期目标。action=propose 会在界面上展示目标卡片给用户确认，用户同意后才创建（这一步不算完成，本轮继续做指派的子任务）。当任务满足全部三条时提议：① 无法本轮完成 ② 有可验证的完成标准 ③ 用户表达了持续意图（「做完整个 X」「把所有 Y 改一遍」）。三个参数：goal、acceptanceCriteria、reason。action=update_criteria 只能在原标准基础上补充或收紧，不能放宽。',
  parameters: { type: 'object', required: ['action'], properties: {
    action: { type: 'string', enum: ['propose', 'update_criteria', 'complete', 'block'] },
    goal: { type: 'string' },
    acceptanceCriteria: { type: 'string', description: '可逐条核对的完成标准，不是「做好」这类描述' },
    reason: { type: 'string', description: 'action=propose 时说明为什么需要开 goal' },
    blockedReason: { type: 'string', description: 'action=block 时说明阻塞原因' }
  }}
}}
```

**`update_criteria` 的防作弊约束**：只允许追加或收紧（新标准必须是旧标准的超集 + 更严格），由 `shared/goalMode.ts` 里一个纯函数判定。放宽一律拒绝并返回原因。否则模型会把验收标准改松来「通过」自己。

### 2.5 自动识别规则（写进系统提示）

规则给模型，不引入额外模型调用（成本考虑）。位置在 `workspaceAgent.ts:1559-1563` 的验收提示前面：

```
[任务规模判定]
动手前先判断规模：
- 预计 1–2 步 → 直接做，不要建 todo。
- 预计 3 步以上 → 立刻 todo create 建清单，不要询问用户。
- 满足全部三条 → goal propose：无法本轮完成、有可验证完成标准、用户表达了持续意图。
- 已有 goal → todo 从 acceptanceCriteria 逐条拆解，不要凭空另建目标。

执行中清单和现实不符时，直接 todo update 或重建，不要停下来解释。
```

**为什么不用单独的 classifier 调用**：每次 run 多一次模型请求的成本（延迟 + token）大于规则误判的代价。规则误判可恢复（模型建了 2 步的清单也无害），额外调用不可恢复（每轮都付）。

### 2.6 改动点

| 文件 | 改动 | 行数 |
|---|---|---|
| `src/shared/types.ts:745-750` | `AgentPlanStep` 加 `managedBy?: 'model'` / `activeForm?: string` | +4 |
| `src/shared/agentPlanning.ts` | `setModelSteps` / `updateModelStep`，强制单 `in_progress` | +55 |
| `src/shared/goalMode.ts` | `isCriteriaTightened(before, after)` 纯函数 | +35 |
| `src/main/workspaceAgent.ts:186-215` | `todo` + `goal` 工具定义 | +40 |
| `src/main/workspaceAgent.ts:790-1087` | 两个工具的 if 分支 | +70 |
| `src/main/workspaceAgent.ts:1559-1563` | 任务规模判定规则 | +12 |
| `src/main/workspaceAgent.ts:1293-1298` | restored 分支恢复 model steps | +6 |
| `src/main/workspaceAgent.ts:1311-1314` | checkpoint 存 model steps | +4 |
| `src/main/workspaceAgent.ts:1602` | `finishPlan` 带上 model steps | +2 |
| `src/main/index.ts` | `goal propose` 的 IPC 通道（转发到 renderer 弹确认卡片） | +40 |
| `src/renderer/src/App.tsx` | 接收 propose → 复用 `GoalDraft` 卡片 → 用户确认后走 `launchGoalFromDraft` | +60 |
| `src/renderer/` 里消费 `plan` 的组件 | 渲染 `managedBy: 'model'` 的步骤 | +30 |

**约 360 行。**

### 2.7 风险

1. **模型过度建清单**。1 步任务也建 todo，用户看到噪音。缓解：提示词明确「1–2 步不建」，且在 UI 上把 ≤2 项的清单折叠。
2. **goal propose 骚扰**。模型看到「帮我改一下这个函数」也提议开 goal。缓解：三条判据是 AND，缺一条不提议；`reason` 字段强制说明，用户能一眼看出是否合理。
3. **checkpoint 恢复遗漏**（原文档已标注）。`workspaceAgent.ts:1293-1298` 的 `restored` 分支必须一并恢复 model steps，否则压缩后清单丢失。这是最容易漏的一行。
4. **验收与清单脱节**。有 pending 步骤却返回 `completed`。缓解：验收提示加硬约束——「若 todo 中仍有 pending 项，workspaceStatus 只能是 blocked」。

---

## 三、codemode —— JS 里批量调工具

### 问题

`workspaceAgent.ts:2172-2174` 每次只 await 一个工具。读 8 个文件 = 8 次模型往返，每次带 8–12K 工具定义。延迟和成本都翻倍。

现有 `run_javascript`（`workspaceAgent.ts:697-757`）只能操作文件（`list` / `readText` / `writeText` / `mkdir` / `move`），**不能调工具**。

### 方案对比

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A. 父进程 `node:vm` | 在 `runWorkspaceAgentUnlocked` 内建 vm 上下文，注入白名单工具函数 | 简单，工具直接可用 | 失去 `--permission` 进程隔离 |
| B. 子进程 + stdio RPC | 复用 `runWorkspaceJavascript`，子进程通过 stdout 发工具请求，父进程执行后写回 stdin | 保留进程沙箱 | 要设计协议、处理并发和超时，复杂 |

**选 A**。理由是白名单工具本身就带权限校验：

- `read_file` → `repositoryText` → `resolveExisting` + `assertWorkspacePathAllowed`
- `search_text` → `searchRepository`，已尊重 `.gitignore` 和凭据边界
- `list_directory` / `inspect_file` / `git_read` 同理

vm 里不提供 `require` / `process` / `fs`，被绕过也只能调到这些已校验的函数。`--permission` 保护的是「脚本直接 `fs.readFile('.env')`」，方案 A 通过**根本不给 fs 入口**达到同样效果。

### 工具形态

```ts
{ type: 'function', function: {
  name: 'codemode',
  description: '在沙箱里跑 JavaScript，直接调用只读工具完成批量操作。适合一次读多个文件、跨文件搜索汇总、结构化提取。可用：await tools.read_file({path})、tools.search_text({query})、tools.list_directory({path})、tools.inspect_file({path})、tools.git_read({operation})。Promise.all 并行。无 require / process / fs / 网络。写操作必须用普通工具。',
  parameters: { type: 'object', required: ['purpose', 'code'], properties: {
    purpose: { type: 'string' },
    code: { type: 'string' }
  }}
}}
```

### 改动点

| 文件 | 改动 | 行数 |
|---|---|---|
| `src/main/workspaceAgent.ts:186-215` | 工具定义 | +6 |
| `src/main/workspaceAgent.ts` 新增 `runCodemode` | vm 上下文 + 白名单 + 30s 超时 + 输出截断 | +120 |
| `src/main/workspaceAgent.ts:790-1087` | `if (name === 'codemode')` 分支 | +8 |
| 工具使用说明 | 何时用 codemode 而非逐个调工具 | +5 |
| 测试 | 白名单越界、超时、异常传播 | +80 |

**约 220 行。**

### 白名单（第一版只给只读）

```ts
const CODEMODE_TOOLS = ['read_file', 'read_files', 'read_document',
  'search_text', 'list_directory', 'inspect_file', 'git_read'] as const
```

写操作（`write_file` / `replace_text` / `run_shell`）**排除**：这些要审批回调（`onApproval`），vm 里没法弹窗。

### 风险

1. **输出爆炸**。脚本 `console.log` 大量内容会撑爆上下文。截断到 12K 字符（和 `read_file` 对齐）。
2. **vm 不是安全边界**。`node:vm` 可被逃逸（原型链、`constructor.constructor`）。缓解：只注入 `(args) => Promise<string>` 形式的纯函数，`contextObject` 用 `Object.create(null)`。
3. **和 `run_javascript` 混淆**。两个都叫「跑 JS」。描述里明确分工：`run_javascript` 处理文件内容，`codemode` 批量调工具。

---

## 四、tool-search —— 按需发现

### 问题量化

工具定义源码约 25K 字符（`workspaceAgent.ts:186-317`），发出去是 JSON，中英文混排，粗估 **8–12K tokens/请求**。一次 10 轮对话，工具定义重复发 10 次。

### 方案

不全部折叠，只折叠低频工具。

| 常驻 | 折叠 |
|---|---|
| `read_file` `read_files` `read_document` `write_file` `replace_text` `search_text` `list_directory` `inspect_file` `run_javascript` `codemode` `todo` `goal` `ask_user` | `create_docx` `create_pdf` `set_docx_header_image` `compress_image` `compress_pdf` `generate_image` `git_read` `git_write` `run_shell` `run_python` `run_project_check` `start_background` `job_output` `job_list` `job_stop` `delegate_to_harness` `request_environment_variables` `get_application_configuration` + 桌面控制工具 |

```ts
{ type: 'function', function: {
  name: 'search_tools',
  description: '按关键词查找未加载的工具。命中后该工具在下一轮可用。可发现类别：Office 文档（docx/pdf 创建与转换）、图片（压缩/生成）、Git 写操作（fetch/pull/reset/checkout/stash）、Shell/Python 执行、项目检查、后台任务、Harness 委派、环境变量声明、桌面窗口控制。',
  parameters: { type: 'object', required: ['query'], properties: {
    query: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 10 }
  }}
}}
```

### 改动点

| 文件 | 改动 | 行数 |
|---|---|---|
| `src/main/workspaceAgent.ts:240-317` | `getWorkspaceToolDefinitions` 拆成 `core` + `deferred` | +30 |
| 新增检索函数 | 关键词匹配（工具名 + 描述分词），不需要向量检索 | +50 |
| `runWorkspaceAgentUnlocked` | 维护 `unlockedTools: Set<string>`，每轮合并 | +15 |
| `workspaceAgent.ts:186-215` | `search_tools` 定义 | +6 |
| 测试 | 检索命中率、折叠后工具仍可调用 | +60 |

**约 160 行。**

### 风险

**「模型忘记调用 `search_tools`」是真实风险。** 缓解：描述里直接点名可发现类别（见上），不让模型猜。如果实测仍失效，退一步——把 `create_docx` / `create_pdf` 也放常驻（它们是高频交付物），只折叠 git 写 / 后台任务 / 桌面控制。

---

## 五、实施顺序

| 步 | 内容 | 规模 | 依赖 |
|---|---|---|---|
| 1 | `todo` 工具 + `agentPlanning` 扩展 + checkpoint 恢复 + 验收联动 | ~150 行 | 无 |
| 2 | `goal` 工具 + propose IPC + goal 面板接 propose | ~210 行 | 1（todo 是 goal 的执行分解） |
| 3 | `codemode`（父进程 vm + 只读白名单） | ~220 行 | 无 |
| 4 | `tool-search` 折叠低频工具 | ~160 行 | 1、2（先把工具数固定） |

合计约 **740 行 + 测试**。估：todo 半天，goal 一天（含 IPC 和 UI），codemode 一天，tool-search 半天 —— **三天到三天半**。

步 1 先做的理由：改动面最小、不碰执行沙箱、能立刻验证「模型自建清单」这个假设是否成立。如果模型建了清单却不用，后面三步都白做。

---

## 六、待确认

1. **goal propose 的确认方式**：复用现有 `GoalDraft` 卡片（`App.tsx:4473`），还是新做一个更轻的内联确认条？复用能省一半 UI 工作量，但 `GoalDraft` 带澄清轮次逻辑，propose 可能不需要那么多轮。
2. **`goal` 工具命名**：和现有 UI 概念「目标模式」重名，模型可能理解成「切换模式」。是否叫 `task_goal` 或 `long_term_goal`？
3. **跨会话 todo 是否有必要**：现在 todo 只活在单次 run + checkpoint 里。如果用户关掉应用第二天继续，goal 能恢复（`resumeGoalTask`，`App.tsx:3278`），todo 不能。要不要把 todo 也落进 `GoalTask`？
4. **tool-search 的 8–12K 估算要实测**：用一次真实请求的 `usage.prompt_tokens` 对比工具定义占比。若实际只有 3K，收益不够覆盖「模型忘记搜」的风险。
