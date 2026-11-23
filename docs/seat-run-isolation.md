# 席位执行隔离：让活落在席位自己那边

> 本文是席位执行隔璃的交接说明。目标读者：后续接手开发的会话。
> 状态：**已实现**（2026-11-20）。四步按 §五 落地，验收见 §六。
> 注：§二 保留的是动手**前**的行为，现已不再成立，留作对照。

---

## 一句话

总台派活给席位后，席位的执行过程和产出全部记在**总台**那边。打开被派的席位，它自己的会话里什么都看不到——活是它在干，账却记在别人头上。

---

## 一、这套东西的模型（读代码前先看）

G-LLM 里的「席位」= 一个独立助手 + 一个专属工作目录。

```
<席位目录>/
├─ AGENTS.md      它是谁（角色、职责边界、风格约束）
├─ MEMORY.md      它记得什么（决定、坑、待办）
└─ <工作产物>     账本、代码、文档……
```

- **总台**（orchestrator）：工作区是父目录，负责拆分、派发、汇总，不写具体产物
- **子席位**：工作区是自己的子目录，负责自己那摊

授权链路：总台的 `delegateAssistantIds` → `authorizeAssistantDelegation(source, target, ...)`（`src/shared/assistantDelegation.ts`），当前 `maxDepth: 2`、`remainingCalls: 12`。

---

## 二、动手前的实际行为

> 以下为改动前的状态，已不再成立，留作对照。

### 2.1 运行中：进度全部流向总台

总台调 `delegate_assistant` 后，主进程内部起的是一次 **workspace agent run**。这个 run 用的是**总台那份 `WorkspaceAgentRequest`**——`conversationId` 是总台的，`workspace` 也是总台的。

于是：

- `seatProgressForwarder`（`src/main/workspaceAgent.ts`）把席位内部的每一步（`tool_started` / `tool_completed` / 步数）**转发到总台的 activity 流**
- checkpoint 也按总台的 `conversationId + workspace + taskId` 存

结果：打开被派的席位 → 它自己的会话里没有任何执行动作。用户只能回到总台看。「这个活到底是谁在干」在 UI 上是不可见的。

### 2.2 事后：调用记录只存在总台侧

`delegate_assistant` 的调用（入参、耗时、结果）只落在总台会话的消息流里。

被派的席位会话列表里没有「我被总台派过这次活」这一条，无法回溯：

- 当时被要求做什么
- 席位产出了什么
- 最终成没成

### 2.3 附带问题：`delegate_assistant` 会重复调用

实测日志（`%APPDATA%\G-LLM\logs\agent-runs.jsonl`）：**一个任务内 `delegate_assistant` 被调用 142 次，只有 20 次返回**，末条停在 `tool_started` 没有 `tool_completed`。

初步判断是模型在没拿到返回时反复重试，但**根因未定位**。可能方向：

1. 席位 run 失败但错误没有作为 tool result 回给总台（总台以为没发出去，重试）
2. 工具结果被输出预算裁掉，模型看不到成功标记
3. 并发/超时导致的悬挂

> 注意：上一版把 `remainingCalls` 4 → 12 只是放宽上限，**没有修这个 bug**。

---

## 三、目标行为

### 3.1 席位有自己的会话记录

每次 `delegate_assistant` 派发，在**席位侧**生成一条可打开的会话记录：

```
席位「后端」的会话列表
├─ [总台] 修复订单接口分页           ← 本次派活，可点开
│    ├─ 第 1 步 read_file src/order.ts
│    ├─ 第 2 步 edit_file ...
│    └─ 结论：改了 3 个文件
└─ （席位自己主动发起的会话）
```

点开能看到：任务原文、每一步工具调用与输出、最终结论、耗时。

### 3.2 总台只留摘要

总台侧不再塞席位内部的每一步，只保留一行状态：

```
→ 后端席位：第 7 步 · edit_file
✓ 后端席位：完成，改动 3 个文件（4 分 12 秒）
```

点这行 → 跳转到席位侧那条会话记录。

### 3.3 `delegate_assistant` 的返回要确定

成功、失败、超时都必须有明确的 tool result，且不能被输出预算裁掉。失败信息要能让模型知道「已经发过了，别再发了」。

---

## 四、涉及代码

| 位置 | 现状 | 需要改 |
|---|---|---|
| `src/main/workspaceAgent.ts` | `delegate_assistant` 工具实现；`seatProgressForwarder` | 派发时为席位构造独立 request / checkpoint 命名空间；进度分流 |
| `src/main/workspaceAgent.ts` | `runWorkspaceAgentUnlocked` 的 checkpoint 键 = `conversationId + workspace + taskId` | 增加「由谁发起、归属谁」维度 |
| `src/main/workspaceCheckpoint.ts` | checkpoint 存取 | 支持按席位会话独立存取 |
| `src/shared/types.ts` | `Assistant`、`WorkspaceAgentRequest`、activity 类型 | 增加派活来源字段（`delegatedFrom` / `originConversationId`） |
| `src/renderer/src/App.tsx` | 会话列表渲染 | 席位的派活会话要出现在席位自己的列表里 |
| `src/renderer/src/WorkspaceBar.tsx` | `WorkspaceActivityLog` | 总台侧只渲染摘要行，点击跳到席位会话 |
| `src/shared/assistantDelegation.ts` | `authorizeAssistantDelegation` | 可能需要把「会话归属」纳入授权上下文 |

---

## 五、建议的实现顺序

分四步，每步都能独立验证，不必一次做完。

### 第 1 步：让派发有归属（后端）

1. `delegate_assistant` 实现里，为本次派发生成一个 `seatConversationId`（归属被派席位）
2. 构造席位专用 request：`conversationId = seatConversationId`，保留 `delegatedFrom = { assistantId: 总台, conversationId: 总台会话 }`
3. checkpoint 用席位这个 id 存，和总台完全隔离
4. **验证**：派一次活，检查 `%APPDATA%\G-LLM\logs\agent-runs.jsonl` 里这次 run 的 `conversationId` 是席位的，不是总台的

### 第 2 步：进度分流（后端）

1. `seatProgressForwarder` 改成两路：
   - 席位自己的 activity 流：记**全量**步骤
   - 总台的 activity 流：只记**摘要**（第几步 + 工具名，或最终结果）
2. **验证**：派活后，席位会话能看到每步；总台只看到 1–2 行

### 第 3 步：席位侧会话记录可见（渲染层）

1. 派活发生时，在席位的会话列表里插入一条记录（标题用任务原文截断）
2. 点开能加载那次 run 的完整消息与工具步骤
3. **验证**：总台派活 → 切到席位 → 列表里有这条 → 点开看到全部步骤

### 第 4 步：总台摘要行可跳转

1. 总台活动流里那一行加点击跳转
2. **验证**：点总台那行 → 直接落在席位那条会话上

---

## 六、验收标准

做完后应该满足：

- [x] 总台派活，席位会话列表出现一条对应记录，标题是任务内容 —— `persistSeatRun` 在派发时建记录
- [x] 打开那条记录，能看到每一步的工具调用、完整命令、完整输出 —— `workspaceActivitySanitize` 保留 `input`/`output`
- [x] 总台侧只看到派发给谁、第几步、成没成，不刷屏 —— `createSeatProgressForwarder` 两路分流
- [x] 关掉应用重开，席位那条记录还在，内容完整 —— `saveConversation` 落库 + `delegatedFrom`
- [x] 一个任务里 `delegate_assistant` 的调用次数 = 实际派发次数（不再 142 次）—— `delegatedStep` + `shouldBookParentRun`
- [x] 派活失败时，席位会话里能看到失败原因，总台能收到明确的失败 result —— `catch` 里 `persistSeatRun` + 错误预算保底

以上均有单测覆盖（`seatConversationRecord.test.ts`、`seatProgressForward.test.ts`、`seatRunLedger.test.ts`、`workspaceActivitySanitize.test.ts`）；**真机 GUI 复验仍待跑**（派活 → 点摘要行跳转 → 重启复查）。

---

## 七、风险与注意

1. **checkpoint 兼容**：老 checkpoint 没有「归属」字段。要么迁移，要么按 `conversationId` 存在即兼容（推荐后者，旧数据当总台归属处理）。
2. **会话数量爆炸**：一个总台任务可能派 5 次活 → 席位列表多 5 条。需要清理策略（比如按 `delegatedFrom.conversationId` 聚合，或只保留最近 N 条）。
3. **不要动 `runWorkspaceAgentUnlocked` 的锁**：它是全局串行锁，改成按席位并行会让两个席位同时写同一目录。并行是另一个独立议题。
4. **`delegate_assistant` 重复调用可能是另一个 bug**：如果第 1 步做完后 142 次的现象还在，说明是工具结果回传问题，单独排查（见 §2.3）。

---

## 八、复现与取证

```powershell
# 所有 run 的流水，每行一个事件
Get-Content "$env:APPDATA\G-LLM\logs\agent-runs.jsonl" -Tail 50

# 主进程日志
Get-Content "$env:APPDATA\G-LLM\logs\main.log" -Tail 100
```

关注字段：`conversationId`、`assistantId`、`tool`、`event`（`tool_started` / `tool_completed`）。

判断是否重复调用的最快方式：数同一个 `conversationId` 下 `delegate_assistant` 的 `tool_started` 条数，和 `tool_completed` 条数对比。
