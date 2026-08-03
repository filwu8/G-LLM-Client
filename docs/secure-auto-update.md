# 安全自动更新与发布

G-LLM Client 使用公开的 GitHub Releases 作为更新源。Windows 和 macOS 正式安装包会在启动后延迟检查更新，默认不静默下载；用户确认后才下载，下载完成后可立即重启安装，也可在正常退出时安装。

开发环境、未打包应用和 Linux 构建不会自动执行安装包，只保留版本检查和手动下载入口。这样可以避免在缺少 Windows Authenticode 或 macOS Developer ID 平台签名保护时自动执行远程制品。

## 信任边界

- 更新源由打包时生成的 `app-update.yml` 固定为 `filwu8/G-LLM-Client`，渲染进程不能修改 feed URL。
- 稳定客户端拒绝预发布版本和版本降级，并禁用缺少完整签名校验保障的 Web Installer。
- `electron-updater` 校验 `latest*.yml` 中的文件摘要；Windows 还校验发布者签名，macOS 依赖 Developer ID、Gatekeeper 和 notarization。
- Release 发布后不得替换附件或移动标签。发现问题必须提高版本号发布修复版本，禁止覆盖原安装包。
- GitHub provenance 证明制品由指定仓库和工作流生成，但它不能判断已获批准的源代码是否存在恶意逻辑，因此仍必须执行代码审核和发布审批。

## 依赖供应链

- CI 只使用锁定的 pnpm 版本和 `--frozen-lockfile`，GitHub Actions 也固定到完整 commit SHA。
- `pnpm-workspace.yaml` 延迟安装发布不足 24 小时的新依赖、拒绝传递依赖使用 git/任意 tarball，并阻止包发布可信度降级。
- Windows、Linux、macOS x64 和 macOS arm64 的原生 Canvas 模块在正式打包后逐项检查；架构错误会直接阻止 Release。
- `supportedArchitectures` 同时安装 macOS x64/arm64 可选依赖，避免 Apple Silicon 构建机交叉打出的 Intel 包携带错误原生模块。
- 每次 CI 和正式发布都执行生产依赖高危漏洞门禁。Dependabot 只负责提出更新，仍需通过 Code Owner 审核和完整检查。

## 首次启用

V2.0.3 已包含安装更新器代码，但在 Windows 与 macOS 平台签名、notarization 配置完成前保持禁用，继续由用户手动下载安装。取得证书后发布的第一个签名版本仍需用户手动下载安装；从该桥接版本开始，后续版本才能通过客户端安全更新。

启用平台签名和自动安装前必须完成以下 GitHub 设置。这些设置不保存在仓库文件中，克隆代码不会自动获得它们。当前无证书过渡版本继续使用手动下载安装，不读取这些 Secrets。

### 1. `production-release` Environment

在 Repository Settings → Environments 创建 `production-release`：

1. 添加至少一名 Required reviewer。
2. 开启 Prevent self-review。
3. 仅允许受保护的 `main` 分支部署。
4. 禁止管理员绕过保护规则。
5. 把签名与 notarization 凭据保存为 Environment secrets，不要保存为普通仓库变量。

### 2. `main` Ruleset

建议启用：

- 合并前必须通过 Pull Request。
- 至少两名审核人，驳回过期批准，并要求最后一次推送由其他人批准。
- Require review from Code Owners。
- 必须通过 `Test and build` 状态检查。
- 禁止强推、删除和直接绕过；管理员也不例外。
- 对 `.github/**`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、更新器和签名代码重点审核。

仓库包含 `.github/CODEOWNERS`，但只有在 Ruleset 中开启 Code Owner 审核后才会强制生效。

### 3. 标签与 Release

- 为 `v*` 建立标签 Ruleset，禁止普通成员创建、移动或删除标签；只允许正式 Release 工作流创建。
- 在 Repository Settings → General → Releases 开启 Release immutability。
- Actions 默认 `GITHUB_TOKEN` 权限设为 Read repository contents；发布工作流只在最终上传任务临时申请 `contents: write`。
- 禁止 Actions 自动批准 Pull Request；Fork Pull Request 不得访问 Secrets。

## 必需的 Environment secrets

### Windows

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

优先使用 Azure Artifact Signing 或其他 HSM/云签名服务，避免可导出的长期 PFX 私钥进入 CI。若暂时使用 PFX，必须定期轮换，并确保只在受审批的发布环境中可用。

证书 Common Name 必须与 `package.json` 中的 `GPROPHET LIMITED` 完全一致；不一致时，构建或更新签名验证会失败。

### macOS

- `MAC_CSC_LINK`：Developer ID Application `.p12` 的 base64 内容
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY_BASE64`：App Store Connect API `.p8` 文件的 base64 内容
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

取得证书并恢复签名发布门禁后，发布任务必须强制执行签名、notarization、`codesign --verify` 和 Gatekeeper 验证；任何一步失败都不会创建 Release。当前过渡版 Windows 不做 Authenticode 签名，macOS 仅使用 ad-hoc 签名，不冒充 Developer ID 受信任签名。

## 取得证书后的签名发布流程

1. 合并并确认 `main` 全部检查通过，工作区中不得混入未提交改动。
2. 更新 `package.json` 版本及对应许可、README 和更新说明。
3. 在 Actions 中从 `main` 手动运行 `Client Release`。
4. 输入与 `package.json` 完全一致的新标签，例如 `v2.0.3`，并输入 `RELEASE`。
5. 审核人检查目标 commit 后批准 `production-release`。
6. 三个平台分别构建；Windows/macOS 必须签名，所有公开附件生成 SHA-256 与 GitHub artifact attestation。
7. 最终任务再次验证摘要和来源证明，然后创建草稿、一次性上传全部附件并发布。
8. 启用 Release immutability 后，发布瞬间锁定标签和附件。

恢复签名发布门禁后，工作流必须拒绝以下情况：

- 不是从当前 `origin/main` HEAD 发起。
- 标签格式、`package.json` 版本不一致。
- 标签或 Release 已存在。
- 缺少签名或 notarization 凭据。
- Windows 发布者不是 `GPROPHET LIMITED`。
- 安装包中的平台原生模块与目标架构不匹配。
- 更新元数据、安装包、DMG/ZIP/AppImage/deb 缺失。
- SHA-256 或 provenance 验证失败。

## 验证公开附件

下载 Release 附件后可以执行：

```bash
gh attestation verify G-LLM-Client-Setup-2.0.3-x64.exe -R filwu8/G-LLM-Client
gh release verify v2.0.3 -R filwu8/G-LLM-Client
gh release verify-asset v2.0.3 G-LLM-Client-Setup-2.0.3-x64.exe -R filwu8/G-LLM-Client
```

同时使用 Release 中的 `SHA256SUMS-*.txt` 核对下载文件。启用签名后，Windows 还应检查 Authenticode 发布者，macOS 应检查 Developer ID、notarization 和 Gatekeeper 结果。

## 凭据泄露或错误发布

1. 立即撤销相关签名、Apple、GitHub 或云服务凭据。
2. 暂停 `production-release` Environment，并移除可疑维护者权限。
3. 不替换旧 Release；发布更高版本的修复包并在客户端侧拒绝降级。
4. 审计 GitHub Actions 运行日志、Environment 审批记录、Release attestation 和签名时间戳。
5. 如果签名私钥可能泄露，联系证书颁发机构吊销证书并轮换客户端信任配置。
