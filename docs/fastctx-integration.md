# FastCtx research and G-LLM Client integration

研究对象：[yc-duan/fastctx](https://github.com/yc-duan/fastctx)，审阅固定提交 [`ccaa157790d02328a60786eb94ee5ad698995a5f`](https://github.com/yc-duan/fastctx/tree/ccaa157790d02328a60786eb94ee5ad698995a5f)。本轮研究的是源码及工具协议，没有使用上游宣传数字作为本项目效果。

## 核心发现

FastCtx 主要通过减少模型为查找信息而付出的工具交互开销、缩小工具输出，降低上下文占用。它不是通用的语义摘要压缩器，也不意味着换上 Rust 进程就自动减少计费 token。

- `src/read_tool/batch.rs`：多个文件范围共享一个预算，按请求顺序返回，单个失败不吞掉其他文件；返回可直接使用的续读参数。
- `src/grep_tool.rs`：路径、命中片段、计数、汇总分别输出；匹配窗口保留真正命中处；文件变化及无法读取的目标都有明示，避免把不完整结果说成“没有找到”。
- `src/budget.rs`：以 `o200k_base` 做精确的参考 token 计数，提前为终止状态/续读提示保留预算。
- `src/context_guard.rs`：同一批调用共享输出上限，避免单工具都不过量、合计却挤爆上下文。
- `src/shell/output.rs`：长输出显示首尾及状态，明确指出中间省略。完整内容的获取必须与命令执行分离。
- 常驻 runtime、共享搜索执行器和编码管线主要解决速度、资源复用与可靠性。自动更新、登录 Shell 环境恢复、脱离会话的后台任务不适合直接替换本项目刚建立的权限与沙箱机制。

## 已应用的部分

客户端独立实现 TypeScript 版本的通用机制，不引入 FastCtx Rust 二进制、MCP 守护服务或上游源码片段。

| 部分 | G-LLM Client 行为 |
| --- | --- |
| 批量范围读取 | 新增 `read_files`，一次 1–32 个 UTF-8 文件范围，1 起始行号，共享正文预算；长行支持精确 `column` 续读，内容哈希阻止跨版本拼接。 |
| 定点搜索 | 新增 `search_text` 的 `files/content/count/summary/paths` 模式，支持简单 glob、忽略文件、上下文行及稳定分页；仅单行字面量查询，不在主进程运行模型提供的正则。 |
| 输出预算 | 已知 OpenAI 模型按 `o200k_base` / `cl100k_base` 离线分词，单工具 3000、同轮 6000 参考 token；未知模型明确使用 12000 / 24000 UTF-8 字节预算。同时保留 12000 / 24000 字符上限，包含截断及恢复提示。 |
| 可恢复输出 | 新增 `read_tool_output`。较长结果先脱敏，再进入当前运行独立的内存存储（8 MiB / 128 项）；首尾预览保留退出状态，分页可恢复仍在存储中的完整内容。到期/淘汰明确报错，不重跑有副作用的操作。 |
| 历史处理 | 旧工具结果压缩后附真实恢复引用；最新结果批次保留所发送页面的原文；尚未执行的工具参数不压缩。 |
| 现有读取 | `read_file/read_document` 默认从 36000 降至 12000 字符，允许显式小范围读取；保留原工具供兼容使用。 |

工具描述和 Agent 系统提示引导模型“定位 → 片段 → 批量范围”，而非强制套用某个业务流程。工具选择最终仍由模型完成。普通聊天及用户最新消息不经过这套工具输出裁剪。

运行时按需加载 `js-tiktoken 1.0.21` 的离线词表并复用分词器；模型映射参考 [OpenAI tiktoken model.py](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py)。不把同一个词表套用到全部供应商，也不把纯文本分词结果当成包含消息封装的计费数量。界面的上下文节省仍是字符口径；API 返回的 usage 才是实际用量依据。

## 后台任务与替换预演

- `start_background` / `job_output` / `job_list` / `job_stop`：在当前 Agent 运行内管理 Python/Shell，遵循当前三档授权；需要审批时展示代码、注入变量名、沙箱/主机边界和最长时间。默认 120 秒，可明确指定到 600 秒，总 Agent 时间限制仍生效。每轮最多 16 个任务，最多一个活跃任务；结果尚未收取时阻止其他写入、脚本和委派，避免并发快照覆盖。运行结束或取消时清理进程，任务不跨重启持久化。
- stdout/stderr 分别增量解码、脱敏和分页，跨数据块的密钥前缀暂不输出。每个任务最多保留 1 MiB 原始日志于本轮内存，超量继续排空并明确标记截断；超出部分不能恢复。完成状态和文件变更只收取一次，不要求读完整份日志。`tail=true` 可明确跳到末尾并返回跳过字符数；大页面仍可通过 `read_tool_output` 恢复其保留的脱敏内容。字面量脱敏不拦截编码、变形后的秘密。
- `preview_text_replacements` / `commit_text_replacements`：最多 32 个显式字面量编辑、1000 个命中、8 MiB 文件内容；匹配次数必须与预期一致（默认 1）。预演不写文件，返回每个文件、版本、完整替换对及次数；请求批准模式提交时展示预演弹窗，其他两档按工作区授权自动提交。只有最新预演有效，计划只能提交一次且限本轮工作区；提交前检查全部文件哈希，写入各文件前再次检查。保留 UTF-8 BOM、CRLF、尾换行和文件权限位。每个文件原子替换，多文件不是事务，部分失败明确列出已修改文件。操作系统 ACL/扩展属性不保证保留。

## 真实性与安全

`complete` 对批量读取表示请求的行范围已经完成，正文还会注明文件是否存在后续行。`search_text` 同时返回 `scanComplete`、跳过原因、范围上限及 `next`；有跳过或扫描未完就不宣称完整。搜到过长行时返回命中附近片段和原行号，需原文时再读取该行。

搜索最多遍历 10000 项、扫描 64 MiB UTF-8 内容，遍历及内容扫描各有 10 秒软期限。单文件最多 20 MiB / 500000 行。二进制、非 UTF-8、不可读文件明确跳过；这轮没有复制 FastCtx 的多编码/PDFium/并行 Rust 搜索能力。结果过多应缩小 path/glob。

继承既有的工作区路径、凭据保护和不跟随链接限制；输出存储不跨运行共享、不落盘。存储只接收已经脱敏的结果。脱敏和上下文节省都不能替代 OS 沙箱，也不保证拦截编码后的秘密。

## 测量与局限

运行 `pnpm benchmark:context` 生成可检查的前后工具 payload。基准源码见 `scripts/benchmark-workspace-context.mjs`；统计存于 `docs/benchmarks/workspace-context.json`。

定点源码案例使用本仓库 `workspaceNative.ts` 和 `workspaceProcess.ts`：旧方式读取两个文件，新方式定位两个具体实现位置并批量读所需范围。仅对序列化的工具参数和响应计数，**不包括工具 schema、系统提示、模型推理或完整会话的重复输入**。测试确认目标语句被保留，但不是跨模型的任务成功率评估。这个案例旧流程 2 次工具调用，新流程 3 次，不能据此宣传减少轮次。

长命令输出案例只比较首屏；新版仍可取回完整中间内容。若实际任务需要所有页面，额外页和元数据会增加 token，不能将首屏降幅当成整项任务的账单降幅。任何额外工具 schema 都有固定成本；小任务可能不划算。

复核数字时可使用项目内已安装的 tokenizer：

```sh
pnpm benchmark:context
node --experimental-strip-types scripts/benchmark-workspace-context.mjs /tmp/gllm-context-benchmark.json .
```

对生成 JSON 中各 case 的 `baseline` / `optimized` 字符串，分别使用 `getEncoding('o200k_base')` 和 `getEncoding('cl100k_base')` 的 `encode(text, [], []).length`。日志预览的 UUID 在基准中固定，便于复现；它不影响实际随机 ID 的隔离行为。

## 许可证与出处

审阅了上游 `LICENSE-APACHE` 与 `NOTICE`。本轮不分发上游代码或二进制；上面的来源用于说明设计参考，并不表示 FastCtx 作者支持或背书本实现。如果以后决定直接移植或打包上游组件，需要同时处理其 Apache-2.0 许可证、NOTICE 及修改声明。新增直接依赖 `ignore@7.0.8` 和 `js-tiktoken@1.0.21`，许可证由项目现有生成器纳入 `THIRD_PARTY_NOTICES.md`。

验证覆盖：批量读取局部失败、Unicode/长行完整续读、文件变更检测、忽略规则继承、稳定分页、命中窗口、凭据和链接拒绝、总输出预算、跨运行隔离、淘汰错误、旧结果恢复及待执行参数保留。
