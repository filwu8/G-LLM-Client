# 浏览器唤起 G-LLM

G-LLM 安装包注册自定义 URL 协议 `gllm:`。仅打开客户端时可以使用：

```text
gllm://open?source=g-llm
```

登录 G-LLM Web 后自动配置 API Key 时，网页必须先调用 `POST /api/client/handoff` 获取一次性授权码，再打开服务端返回的深链接：

```text
gllm://open?source=g-llm&handoff=<64 位一次性授权码>
```

授权码有效期为 90 秒，只能兑换一次。明文 API Key 不进入 URL、浏览器历史、系统协议参数或客户端日志；桌面客户端通过固定 HTTPS 端点兑换后保存到本地 G-LLM 供应商配置。

`source` 可以省略，此时纯唤起链接为 `gllm://open`。不需要自动配置时，浏览器页面可以使用普通链接或把同一地址赋给 `window.location.href`：

```html
<a href="gllm://open?source=g-llm">打开 G-LLM Client</a>
```

浏览器可能先显示“是否打开外部应用”的确认框，这是浏览器自身的安全行为。客户端未安装或协议尚未完成系统关联时，浏览器无法直接启动客户端。

## 接收规则

客户端只接受以下内容：

- 协议：`gllm:`
- host：`open`
- path：空路径或根路径 `/`
- 参数：无参数、唯一参数 `source=g-llm`，或严格顺序的 `source=g-llm&handoff=<64 位字母数字授权码>`。

其他 action/path、fragment、端口、用户名密码、未知参数、重复参数、非白名单 `source` 以及任何编码后的替代写法都会被拒绝。协议不会接收或传递 access token、API key、登录态、命令、脚本或文件路径；拒绝日志也不会写入原始 URL。进程参数完成解析后还会立刻把授权码替换为不含凭据的普通唤起链接。

纯唤起链接可以重复触发，客户端会保持单实例，只恢复、显示并聚焦主窗口。带 handoff 的链接也会安全唤起窗口，但授权码只在第一次触发时兑换；重复触发不会再次导入 Key。

## 平台和开发环境

- Windows NSIS 安装器写入 `gllm` 协议关联；冷启动从进程参数接收，客户端已运行时通过 Electron `second-instance` 事件交给现有进程。
- macOS 应用包的 `Info.plist` 由 electron-builder 写入协议声明；冷启动和运行中均由尽早注册的 `open-url` 事件接收。
- Linux 的 deb/AppImage 构建会在 `.desktop` 元数据中声明 `x-scheme-handler/gllm`；冷启动从进程参数接收，运行中通过单实例转交。不同桌面环境对 AppImage 的桌面集成方式不同，安装 deb 或完成 AppImage 桌面集成后协议关联最稳定。
- Windows 开发模式会将协议关联到当前 Electron 启动入口（该系统关联会持续到被重新注册）。macOS 无法在运行时修改开发版 `Info.plist`，Linux 开发模式也不写用户的桌面数据库；这两端应通过解析器测试或打包后的应用联调，避免开发命令污染系统协议关联。
- 生产客户端只向 `https://llm.gprophet.com/api/client/handoff/exchange` 兑换授权码。开发环境可用 `GLLM_HANDOFF_EXCHANGE_URL=http://localhost:3000/api/client/handoff/exchange` 指向本机服务；明文 HTTP 仅允许 localhost/127.0.0.1。

运行自动化校验：

```bash
pnpm test:deep-link
pnpm build
```
