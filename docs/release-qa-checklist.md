# G-LLM Release QA Checklist

本清单用于每次发布前做人工验收，重点覆盖用户最容易感知的问题：安装、启动、托盘、悬浮窗、截图、复制、单进程和三端基础可用性。

## 构建检查

- 对照 [多端开发规范](./multi-platform-development-guidelines.md)，确认共享 UI/业务改动没有被做成平台分叉。
- 确认 `package.json` 版本号与发布版本一致。
- 执行 `git status -sb`，正式发布包必须来自干净工作区中的已提交 commit。
- 执行 `pnpm test && pnpm build`，确保单元测试、TypeScript 和前端构建通过。
- 执行 `pnpm licenses:generate`，确认 `THIRD_PARTY_NOTICES.md` 与锁定的生产依赖一致，且没有无法识别的许可证。
- 确认 `LICENSE` 中的 Licensed Work 版本、Change Date 和 Change License 与本次发布一致；不得沿用上一版本参数而不复核。
- 确认 `README.md`、`README.en-US.md`、`NOTICE`、安装协议和应用“关于本系统”中的许可说明一致。
- 确认第一方源码保留版权、`SPDX-License-Identifier: BUSL-1.1` 和 Change Date 文件头。
- 检查安装包资源目录包含 `legal/LICENSE.txt`、`legal/NOTICE.txt`、`legal/LICENSE_POLICY.md`、`legal/COMMERCIAL_LICENSE.md`、`legal/TRADEMARKS.md` 和 `legal/THIRD_PARTY_NOTICES.md`。
- 从“关于本系统”逐一打开源码许可证、第三方声明、商业授权和商标政策，确认三端路径有效。
- 对新依赖、复制代码、字体、图标、截图和其他资产做来源及许可证复核；不得发布来源不明或许可不兼容的内容。
- 对拟公开的提交执行凭据、客户数据、私有提示词和内部资产扫描；仓库从私有改为公开前必须单独审批。
- Windows 执行 `pnpm package:win`，确认生成 `dist/G-LLM-Client-Setup-<version>-x64.exe`。
- macOS 执行 `pnpm package:mac`，确认生成 macOS 产物。
- Linux 执行 `pnpm package:linux`，确认生成 AppImage 和 deb 产物。
- 发布前记录 Windows 安装包 SHA256，便于排查不同机器下载到的是否是同一个文件。
- 确认 Release 同时包含 `latest.yml`、`latest-mac.yml`、对应安装包/ZIP 和 `SHA256SUMS-*.txt`，并通过 `gh attestation verify`。
- 确认 GitHub 已启用 Release immutability，`production-release` Environment 需要他人审批且禁止自审；无证书过渡发布必须在更新说明中明确平台警告与能力限制。

## Windows 验收

- 首次安装后可以正常启动，主窗口出现在任务栏。
- 再次双击桌面快捷方式不会创建第二个进程，只会唤起已有窗口。
- 退出客户端后从浏览器打开 `gllm://open?source=g-llm`，客户端冷启动并显示主窗口。
- 客户端已运行、最小化或隐藏时再次打开 `gllm://open?source=g-llm`，只恢复并聚焦已有主窗口。
- 登录 G-LLM Web 后点击首个“聊天”工具，自动创建或选择对应 Key；客户端通过一次性 handoff 配置 G-LLM 供应商，URL 和日志中均不出现明文 Key。
- 同一个 handoff code 第二次兑换失败，超过 90 秒后也不能兑换。
- `gllm://open?token=test`、未知 path/参数和重复参数不会触发深链接动作。
- 点击主窗口关闭按钮后应用不退出，进入系统托盘。
- 从托盘右键菜单可以打开快速对话、打开主窗口、显示/隐藏悬浮窗、退出 G-LLM。
- 最小化主窗口后桌面显示悬浮 G-LLM logo。
- 悬浮 logo 背景透明，不出现方形底色或残留阴影。
- 悬浮 logo 可以拖动，松开后吸附到屏幕边缘。
- 悬浮 logo 右键菜单与托盘右键菜单功能一致。
- 快速对话窗口透明无边框、置顶，不显示设置齿轮。
- 点击截图按钮时当前 G-LLM 窗口先隐藏，然后进入 Windows 截图。
- 截图完成后图片进入待发送附件。
- 截图或图片附件右键可以复制图片，并能粘贴到微信、浏览器输入框或其他程序。
- 自己发送过的历史消息可以选择、复制和引用。
- 固定任务栏后再次启动可以复用已有进程，不闪退。
- 从上一自动更新版本检查更新，可以发现本次版本并自动后台下载；下载完成后“重启并安装”和“退出时安装”均可升级且保留用户数据。
- 篡改下载文件或使其与 `latest.yml` 摘要不匹配时，客户端拒绝安装。
- 如果用户反馈闪退，先收集 `%APPDATA%/G-LLM/logs/main.log`。

## macOS 验收

- 应用可以启动主窗口。
- 基础聊天、供应商设置、模型拉取可用。
- 文件/图片附件可添加。
- 关闭窗口、Dock 图标和菜单栏行为符合 macOS 常规习惯。
- 从浏览器打开 `gllm://open?source=g-llm`，冷启动和已运行状态都能显示并聚焦主窗口。
- 非白名单 `gllm` 链接不会触发深链接动作。
- 无证书过渡版确认系统安全提示与发布说明一致，并验证手动覆盖安装后用户数据保持不变。
- “关于本系统”显示 macOS 仅支持检查版本和手动下载，不尝试自动执行未签名更新。

## Linux 验收

- AppImage 可以启动。
- deb 安装后可以从应用菜单启动。
- 基础聊天、供应商设置、模型拉取可用。
- 文件/图片附件可添加。
- 桌面图标和应用名称显示为 G-LLM。
- 安装 deb（或完成 AppImage 桌面集成）后，从浏览器打开 `gllm://open?source=g-llm`，冷启动和已运行状态都能显示并聚焦主窗口。
- 非白名单 `gllm` 链接不会触发深链接动作。

## 分发状态记录

- Windows 未签名构建：过渡期允许发布，必须明确未知发布者风险，并记录安装包 SHA256 与 provenance。
- Windows 签名构建：发布者必须为 `GPROPHET LIMITED`，并记录证书主体、签名时间戳和安装包 SHA256。
- Microsoft Store/MSIX：账号、包名、发布状态单独记录。
- macOS 未签名或未 notarize 构建：过渡期允许手动下载发布，必须保持自动安装禁用并明确 Gatekeeper 风险。
- Linux 正式发布：至少保留 AppImage 和 deb 两种产物，后续可补 apt 仓库。
