# 自动更新与发布

G-LLM Client 使用公开的 GitHub Releases 作为版本与更新源。V2.0.6 延续此前无商业代码签名证书的发布方式，并作为 Windows 自动更新的桥接版本：用户需手动安装 V2.0.6 一次，此后 Windows 客户端会在后台下载更高版本，并在重启或正常退出时安装。

macOS 无签名安装包可以继续手动下载安装使用，但 Electron 的 Squirrel.Mac 要求应用必须签名才能自动更新，因此 macOS 当前只检查版本并打开手动下载入口。Linux 同样保留版本检查和手动下载。

## 当前平台行为

- Windows 正式安装包使用 NSIS。客户端启动 30 秒后检查更新，之后每 12 小时检查一次；发现稳定版后自动后台下载。
- macOS 生成 DMG 与 ZIP，保留 `latest-mac.yml`，但在取得 Developer ID Application 证书前不会自动下载或执行更新。
- Linux 生成 AppImage 与 deb，只提供版本检查和手动下载。
- 开发环境与未打包应用不会自动执行安装包。

## 当前信任边界

- 更新源由打包时生成的 `app-update.yml` 固定为 `filwu8/G-LLM-Client`，渲染进程不能修改 feed URL。
- 稳定客户端拒绝预发布版本和版本降级，并禁用 Web Installer。
- `electron-updater` 按 `latest*.yml` 中的摘要验证下载内容；发布工作流同时生成 SHA-256 清单与 GitHub artifact attestation。
- 工作流只允许从当前 `origin/main` HEAD 创建与 `package.json` 一致的新标签，不会覆盖已有标签或 Release。
- 公开附件使用白名单收集，平台原生模块在打包后验证目标架构。
- Release 发布后不得替换附件或移动标签；发现问题必须提高版本号发布修复版本。

无证书发布不具备操作系统级发布者身份验证。Windows 可能显示未知发布者警告，macOS 可能触发 Gatekeeper 提示；如果 GitHub 仓库、发布工作流或维护者账号被攻破，仅靠摘要和 provenance 不能替代 Authenticode 或 Developer ID 信任链。取得证书后应按本文后续章节恢复平台签名。

## 发布流程

1. 合并并确认 `main` 的 `Client CI` 全部通过，工作区不得混入未提交改动。
2. 更新 `package.json` 版本、许可证版本、README 和中英文发布说明。
3. 在 Actions 中从 `main` 手动运行 `Client Release`。
4. 输入与 `package.json` 完全一致的新标签，例如 `v2.0.6`，并输入 `RELEASE`。
5. Windows、macOS、Linux 分别执行测试、生产依赖审计和正式打包。
6. 工作流验证原生模块架构与打包后的 GitHub 更新源，收集白名单附件并生成 SHA-256 与 artifact attestation。
7. 最终任务再次验证全部摘要与来源证明，然后创建草稿、一次性上传附件并发布。

工作流拒绝以下情况：

- 不是从当前 `origin/main` HEAD 发起。
- 标签格式或 `package.json` 版本不一致。
- 标签或 Release 已存在。
- 安装包中的平台原生模块与目标架构不匹配。
- 更新元数据、安装包、DMG/ZIP/AppImage/deb 缺失。
- SHA-256 或 provenance 验证失败。

## GitHub 发布保护

建议为 `production-release` Environment、`main` 和 `v*` 标签配置以下保护：

- 发布环境需要他人审核并禁止自审。
- `main` 只能通过 Pull Request 合并，要求 Code Owner 审核和 `Test and build` 状态检查。
- 禁止强推、删除、移动发布标签和覆盖 Release 附件。
- 开启 Release immutability；Actions 默认只读，只有最终发布任务临时申请 `contents: write`。
- 维护者账号启用强 MFA，定期审计 Actions、Environment 与 Release 操作记录。

## 取得证书后的升级

### Windows

在 `production-release` Environment 配置：

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

证书发布者应与 `GPROPHET LIMITED` 一致。恢复 `forceCodeSigning` 后，工作流必须验证 Authenticode、受信任时间戳和更新安装包发布者。

### macOS

在 `production-release` Environment 配置：

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

取得 Developer ID Application 证书后，恢复强制签名、hardened runtime 和 notarization，并在发布工作流中验证 `codesign`、stapled ticket 与 Gatekeeper。只有完成这些验证后才能为 macOS 启用自动安装更新。

## 验证公开附件

下载 Release 附件后可以执行：

```bash
gh attestation verify G-LLM-Client-Setup-2.0.6-x64.exe -R filwu8/G-LLM-Client
gh release verify v2.0.6 -R filwu8/G-LLM-Client
gh release verify-asset v2.0.6 G-LLM-Client-Setup-2.0.6-x64.exe -R filwu8/G-LLM-Client
```

同时使用 Release 中的 `SHA256SUMS-*.txt` 核对文件。取得证书后，还应在 Windows 检查 Authenticode 发布者，在 macOS 检查 Developer ID、notarization 和 Gatekeeper。

## 错误发布或凭据泄露

1. 暂停 `production-release` Environment，并撤销相关 GitHub、Apple、签名或云服务凭据。
2. 不替换旧 Release；发布更高版本的修复包并保持客户端拒绝降级。
3. 审计 GitHub Actions 运行日志、Release attestation、Environment 和维护者账号登录记录。
4. 如果签名私钥可能泄露，联系证书颁发机构吊销证书并轮换客户端信任配置。
