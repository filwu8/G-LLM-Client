# Agent execution

## 职责与使用

客户端提供通用工具、系统隔离、审批与本地变量存储。模型根据 `AGENTS.md` / `SKILL.md` 决定业务配置需求及认证步骤；客户端不内置 ERP 账号或业务 API 字段。

1. 绑定工作区，点击 **Agent 设置**，开启 Python / Shell。
2. 默认使用 **操作系统原生沙箱**，默认禁止联网。需要访问 ERP 等业务服务时，用户主动开启联网。
3. 模型调用 `request_environment_variables` 声明名称及用途，设置弹窗自动显示；也会从根目录 `.env.example` 提取变量名，绝不预填写其示例值。用户本地填写并勾选允许注入的变量，然后保存。
4. 在聊天上方选择 **请求批准 / 帮我批准 / 完全授权**。需要审批时展示完整代码、工作目录、执行模式、网络开关和注入名称。模型不能改变权限、启用网络或写入变量值。
5. 配置完成后重新发送任务。变量值在每轮开始时冻结，更新从下一轮生效。真实登录身份必须由业务工具认证结果确认。

未绑定工作区的普通会话不显示工作区审批和 Agent 执行设置，也不会继承其他草稿的目录授权。解绑会取消当前执行与待处理审批。目标设置在选定目录后才展示授权档位。

Agent 设置在启用 Python/Shell 时自动检查当前所选执行配置，也可点击“重新检查”。检查所选目录的读写权限，并在独立临时目录实际启动 Python、从 Shell 启动 Python、写入和回写测试文件、验证沙箱外测试文件不可读写。允许联网时以 `example.com` 检查 DNS 和 TCP；禁网模式不做联网探测，主机模式不宣称隔离通过。探测不读取业务文件或密钥，不调用 ERP 或其他业务 API。目录权限检查不等于整个工作区已通过 128 MiB 快照限额，也不验证第三方 Python 包或业务身份。

Python 工具和 Shell 的 PATH 优先使用同一套已发现的 Python 安装，避免 macOS Shell 命中 `/usr/bin/python3` 的 Xcode 启动器而直接 Python 工具使用 Homebrew 的不一致。macOS 开启联网时只额外放行 DNS 所需的目录服务查询及 `/private/var/run/mDNSResponder` 套接字，不放开任意 Unix socket；禁网配置不包含这些授权。此次故障已由本机沙箱拒绝日志和修复前后执行结果复现。相关平台参考：[Gemini CLI 的 macOS DNS 服务说明](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/utils/sandbox-macos-permissive-open.sb)；本实现未采用其中的宽泛网络授权。

权限按会话保存；加密变量按规范化的工作区路径隔离。同一目录的多个助手/会话可复用变量，但各会话仍需单独允许注入。不同工作区不共享值。删除变量会删除该工作区的加密副本；不删除用户已有的 `.env`。

## 三档授权

| 操作 | 请求批准 | 帮我批准 | 完全授权 |
| --- | --- | --- | --- |
| 工作区读取、搜索、日志查询、替换预演 | 直接执行 | 直接执行 | 直接执行 |
| 工作区写入、批量替换提交、受限 JavaScript | 逐次询问 | 自动执行 | 自动执行 |
| 已配置沙箱内 Python/Shell，含后台任务 | 逐次询问 | 自动执行 | 自动执行 |
| 已启用的主机执行或扩展 HTTP 工具 | 逐次询问 | 逐次询问 | 自动执行 |

“帮我批准”按实际执行边界决策，不通过猜测脚本文本判定只读，也不额外调用模型做审批。已允许的沙箱联网及变量注入不再单独弹窗。授权档位不改变沙箱、网络、只读/读写、工具启用和变量白名单；完全授权也不会让不可用沙箱自动退回主机。批量替换始终保留预演、版本检查和一次性计划，只有人工弹窗随档位变化。自动批准写入和脚本会记录在活动日志中。

默认或未知档位按“请求批准”处理；原有会话保留已选档位，修正后的语义从下一次请求开始生效。切换档位不会代答已经弹出的批准请求。

## 三个平台

| 平台 | 执行后端 | 依赖与边界 |
| --- | --- | --- |
| macOS | 系统 `sandbox-exec` / Seatbelt，默认拒绝策略 | 读取必要的系统及 Python 运行库、写入临时工作区；阻止其他用户目录、Unix socket、Apple Events 及非允许的 Mach 服务。接口已弃用，需持续兼容性测试。 |
| Linux | `/usr/bin/bwrap` + seccomp | x64/arm64；需 Bubblewrap 和系统允许的非特权用户命名空间。独立 PID/挂载等命名空间、丢弃 capabilities；seccomp 阻止 Unix socket、ptrace、setns 等操作。Python 使用 `/usr` 下系统安装。 |
| Windows | AppContainer + Job Object | Windows 10/11、Windows PowerShell/.NET Framework。受信 C# 启动器创建临时 AppContainer，检查进程 token 后才恢复执行；只对临时副本授予目录 ACL。Job 限制 64 个进程、1 GiB 总内存并在关闭时终止子进程。Python 安装须可被 AppContainer 读取，客户端不会修改其安装目录 ACL。 |

缺少后端、系统策略不允许或启动失败时明确报错，**不退回宿主执行**。设置中的“后端已找到”是依赖检查，不表示通过了当前系统的执行验证。

网络是明确的二选一权限：默认关闭；开启后允许互联网及局域网访问，**不是域名白名单**。Windows 不创建回环豁免，不修改机器防火墙。无法靠这个开关限制某个 ERP 账号可修改哪些业务对象。系统自身可读取的公共运行库/Windows AppContainer 公共资源仍然可见。

## 临时工作区与回写

每条沙箱命令使用独立临时副本，排除 `.env`、`.ssh`、`.aws`、`.gnupg`、`.git` 等已知凭据/元数据路径以及符号链接。不读取硬链接、设备文件、套接字等特殊输入。工作区上限 128 MiB / 10000 项；这是副本大小限制，不是跨平台进程内存限额。

成功退出后按内容哈希检查文件差异并回写；运行期间发生的用户并发编辑会阻止覆盖。失败或在执行完成前取消不会回写。产物中的链接和特殊文件被拒绝。回写是逐文件操作，不是跨文件事务；磁盘故障可能导致部分回写。当前同步普通文件的创建、修改与删除，不同步目录权限、所有者或空目录变化。

系统隔离约束被启动的 Python/Shell 及其子进程。macOS 停止采用进程组，刻意脱离进程组的后台进程不能保证立即清理，但仍受其继承的 Seatbelt 权限限制；Linux PID 命名空间和 Windows Job 提供更强的子进程收尾。所有平台都不能撤销已完成的远程业务写入。POSIX 后端没有额外内存/CPU配额；单次执行限制 120 秒、128 KB 输出。

用户可明确选择 **完全授权本机执行**。该模式没有 OS 沙箱，可访问用户本机文件、凭据及网络；默认和旧会话未指定模式时均采用沙箱。原 JavaScript 工具继续使用已有受限 runner，不应把其 VM 当作此处的 OS 原生隔离。

## 密钥存储

变量值由主进程的 Electron `safeStorage` 加密，存于用户数据目录的 `agent-credentials/`，不进入会话状态、助手模板、聊天或 `.env`。渲染层只能获取名称、用途和配置状态，不能读取已保存的明文。macOS 使用系统钥匙串支持的加密，Windows 使用 DPAPI，Linux 使用系统 secret store；Linux `basic_text` 后端和没有系统加密能力的环境被拒绝，不使用固定密钥或明文降级。

这是静态存储保护，不是对已控制当前系统账号的攻击者的防护。执行时，仅解密该会话允许注入的名字；每个命令再次申请其中的子集。已注入的密钥在脚本内存中可用。输出只对已加载凭据的原文脱敏，无法保证拦截编码、拆分、产物或网络外传。

兼容读取根目录 `.env`，仅解析数据、不 source、不展开命令；加密存储中的同名已授权值优先。运行时控制变量（PATH、BASH_ENV、PYTHONPATH 等）不能注入；不继承客户端完整环境。专用文件工具禁止读取真实 `.env`，但允许检查元数据及原子创建不存在的空值模板，禁止覆盖现有凭据文件。

## 验证

`pnpm test:sandbox` 覆盖真实 Python/Shell、越界文件访问、凭据副本排除、子进程越界、网络开关、回写冲突和加密存储协议。macOS 已在本机运行；Linux/Windows 加入独立 CI job，未在这台 macOS 上实测，须观察 CI 结果后再认定发布就绪。完整检查为 `pnpm test` 与 `pnpm build`。

参考：[Apple sandbox-exec 手册](https://man.freebsd.org/cgi/man.cgi?manpath=macOS+26.4&query=sandbox-exec&sektion=1)、[Bubblewrap](https://github.com/containers/bubblewrap)、[Microsoft AppContainer 启动属性](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)、[Electron safeStorage](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md)。

## English

The client supplies generic execution, permissions and local credentials; the model uses AGENTS.md/SKILL.md for business onboarding. Enable Python/Shell in Agent settings. OS sandboxing is the default, including older conversations without an explicit mode. Networking defaults to off; enabling it permits general Internet/LAN access, not a domain allowlist. Host execution is a separate explicit opt-in, never an automatic fallback.

Unbound conversations do not show workspace approval/execution settings or inherit a draft folder grant. Unbinding cancels execution and pending approvals. Agent settings automatically exercise the selected runtime configuration using isolated temporary fixtures: folder access, Python, Python from Shell, file writeback, outside-file isolation, and (when enabled) example.com DNS/TCP. Checks never use business files, credentials or business APIs; passing does not validate authentication, optional packages or the full workspace snapshot size. Shell PATH prioritizes the same discovered Python as the Python tool. macOS network-enabled profiles permit only the additional DNS service/socket access required by the system resolver; network-disabled profiles do not include it.

Approval modes are conversation-scoped and take effect on the next request. Ask for approval prompts for writes, scripts and HTTP extensions; reads run directly. Approve for me automatically allows workspace tools, restricted JavaScript and configured sandbox Python/Shell, including background jobs and already-enabled networking/variables; host execution and HTTP extensions still prompt. Full authorization runs all enabled tools without per-operation prompts. These modes never expand workspace, network, variable or execution permissions. Batch replacements always require a preview and version checks. Automatic approval is based on enforced boundaries, not script-text heuristics or an additional model call, and is recorded in activity logs. Missing/unknown modes ask; existing selections are preserved. A mode change does not answer an already pending approval dialog.

Backends: macOS Seatbelt (deprecated system interface); Linux Bubblewrap plus seccomp on x64/arm64 with user namespaces; Windows AppContainer plus a kill-on-close Job Object (64 processes, 1 GiB). Windows requires an AppContainer-readable Python installation; the client never grants runtime-installation ACLs or loopback exemptions. Backend presence does not guarantee successful launch. macOS cleanup cannot guarantee immediate termination of deliberately detached descendants, though they retain sandbox restrictions. External side effects cannot be rolled back.

Each command runs in a filtered snapshot excluding known credential paths and links, bounded to 128 MiB / 10000 entries. Successful regular-file changes are checked against concurrent edits before writeback. Failure/cancellation before completion discards changes. Writeback is not a multi-file transaction and does not synchronize empty directories or file ownership. POSIX memory/CPU quotas are not supplied. Foreground execution is bounded to 120 seconds and 128 KB output. Approved background execution defaults to 120 seconds and accepts an explicit limit up to 600 seconds, subject to the overall Agent deadline. Background logs retain at most 1 MiB; overflow is reported and drained without killing the job. Jobs are scoped to the active run, with one active job at a time, incremental redacted stdout/stderr, and cancellation on run exit. See `fastctx-integration.md` for completion collection, tail reads, and batch replacement previews.

The model declares variable names/purposes; users enter values locally and choose which may be injected. Values are encrypted through Electron safeStorage, scoped to a canonical workspace path, and never returned to the renderer, chat or templates. Plaintext/basic_text fallback is refused. Existing .env remains supported; encrypted values take precedence. Encryption protects stored data, not approved code that receives credentials or an attacker controlling the OS account. Literal output redaction cannot prevent encoded or network exfiltration. JavaScript retains its existing runner and does not acquire these Python/Shell OS isolation guarantees.

Validation: `pnpm test:sandbox`, `pnpm test`, `pnpm build`. macOS has been exercised locally; Linux and Windows have CI jobs and still need native execution results before being considered release-ready.
