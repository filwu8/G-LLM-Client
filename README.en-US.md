# G-LLM Client

[简体中文](./README.md) | [English](./README.en-US.md)

Current code version: [V2.0.6](https://github.com/filwu8/G-LLM-Client/tree/main)

Latest stable release: [V2.0.6](https://github.com/filwu8/G-LLM-Client/releases/tag/v2.0.6), released on 2026-08-21.

> Starting with V1.1.0, the source is licensed under BUSL-1.1 for free personal and internal business use; the current V2.0.6 release will automatically change to AGPL-3.0-only on 2030-08-01. V1.0.10 and earlier remain under the AGPL-3.0-only license included in their release tags.

[Download](https://llm.gprophet.com/download) | [Full changelog](https://llm.gprophet.com/download/changelog) | [GitHub Releases](https://github.com/filwu8/G-LLM-Client/releases)

G-LLM Client is a cross-platform desktop AI client built by GPROPHET LIMITED for Windows, macOS, and Linux. The product direction is assistant-first: users choose or create a role-based assistant, then use one desktop client for model configuration, knowledge references, screenshots, file understanding, and multi-turn conversations.

## Interface Preview

The workspace agent can read and modify files inside a user-authorized directory while showing its actions in the conversation. Eligible paid G-LLM users can also enable the exclusive gold theme.

![Business-plan assistant and workspace agent in the gold theme](./docs/images/gllm-gold-workspace.png)

Local file tools can generate, modify, and compress files in a conversation. Light and dark themes are available to every user.

| Dark theme | Light theme |
| --- | --- |
| ![PDF compression task in the dark theme](./docs/images/gllm-dark-file-tools.png) | ![PDF compression task in the light theme](./docs/images/gllm-light-file-tools.png) |

## V2.0.6 Windows Automatic Updates and Reasoning-Model Compatibility

- V2.0.6 continues the existing certificate-free distribution model, so Windows and macOS may show unknown-publisher or security warnings.
- V2.0.6 is the automatic-update bridge release and must still be installed manually once. Later Windows releases are checked and downloaded in the background, then installed on restart or app exit.
- Electron requires a signed macOS app for automatic installation, so macOS continues to check versions and direct users to a manual download until a Developer ID certificate is available.
- OpenAI-compatible streams that place reasoning output in `reasoning_content` are now supported, fixing the indefinite waiting state with `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`.
- Fixed the model label becoming inconsistent after stopping a response and switching models.

## V2.0.5 Model Availability and Background Conversations

- The official G-LLM model catalog now refreshes automatically, so removed models and models without an available route are no longer shown or requested.
- When a request reports that its model has no available channel, the client refreshes the catalog immediately, switches to a currently available model, retries once, and explains the fallback.
- You can switch to another conversation while a response continues in the background. Assistant and conversation lists show responding, completed, and failed states.
- Drafts, attachments, references, web-search settings, and workspace activity are isolated per conversation so switching does not overwrite in-progress work.

## V2.0.4 Web Research and Conversation UI Fixes

- Web retrieval now searches Google, Bing, and DuckDuckGo concurrently, with Google News added for time-sensitive questions. Google automatically falls back when a firewall, CAPTCHA, JavaScript gate, or consent page blocks access.
- Added query planning, source deduplication, freshness and applicability evaluation, conflict preservation, and an evidence audit to reduce repetitive, stale, context-poor, or user-mismatched results.
- Search progress, query tags, and source cards now appear incrementally, while the model's final answer is streamed again.
- Fixed incorrect main-chat colors in the gold theme, overflowing LLM citation cards, and abnormal safety labels being displayed as assistant answers.

## V2.0.3 Sidebar Organization and Update Readiness

- Windows and macOS remain manual-download releases. The automatic-update implementation is ready but will not download or execute packages until platform signing and macOS notarization are configured.
- Assistants and conversations can be pinned; unpinned items follow recent activity, and conversation rows now expose timestamps and quick actions.
- Releases now use three-platform packaging, SHA-256 manifests, and GitHub provenance verification; platform signing and macOS notarization will be enabled after certificates are configured.
- Improved drawer positioning below the Windows native title bar so top controls remain interactive.

## V2.0.2 Installer License Metadata Fix

- Aligned installer agreements, bundled license files, and version metadata so the installer no longer displays a stale version number.

## V2.0.1 Browser Launch and Gold Theme

- G-LLM Web can securely start or wake G-LLM Client from Chat and automatically select the gold theme.
- Deep links carry only a short-lived, single-use handoff code and never expose the API key; cold and running-state activation both focus the main window.
- New users can use the gold theme during the initial observation period; official-channel usage ratio is evaluated only after the observation threshold.
- Improved protocol registration, single-instance handling, and uninstalled-client fallback coordination across macOS, Windows, and Linux.

## V2.0.0 Independent Identity and Browser Authorization

- The client, installers, application ID, default workspace, and built-in assistants now use **G-LLM Client** exclusively, with no historical product aliases.
- Signed-in G-LLM Web users can launch the client from Chat and configure their API key through a single-use authorization code that expires after 90 seconds.
- Windows, macOS, and Linux support cold and running-state `gllm://` activation while preserving a single app instance and focusing the main window.
- Fixed AI-content overflow in narrow windows and the model picker appearing behind the sidebar.

## V1.2.4 Floating Assistant and Settings Experience

- The floating assistant visibility preference is now persisted and synchronized across the main window, Quick Chat, the tray, and the floating assistant.
- Improved floating-assistant behavior when minimizing, closing, and reopening the main window on Windows, preventing inconsistent visibility after state changes.
- Increased the floating hint area with wrapping for longer messages, while assistant-setting actions now adapt to narrow windows and longer translations.

## Features

- Cross-platform desktop client built with Electron, React, and TypeScript, with Windows, macOS, and Linux packaging.
- Assistant workflow with built-in assistants for general chat, documents, contracts, code, business analysis, and learning, plus creation, editing, drag reordering, pinning, hiding, restoring, and deletion.
- Chinese and English UI with system-language detection or manual selection across the main window, Quick Chat, and native menus.
- Multi-provider and multi-model setup with the default G-LLM gateway and OpenAI-compatible provider templates.
- Model management with connection tests, `/models` fetching, capability detection, and default model selection.
- Unified model selection across chat, global defaults, assistant settings, and quick chat, with capability labels and natural name sorting.
- Streaming chat, starter prompts, Markdown rendering, conversation history, and local persistence, with full dates, selected time zones, and total/input/output token details shared by the main window and Quick Chat.
- Intelligent conversation search across spaces using topics, people, tasks, or conclusions, with direct navigation back to the original conversation.
- Local-first features including lightweight knowledge base, assistant memory, persistent project memory, local data storage, and data import/export.
- Attachments and visual inputs including files, images, pasted clipboard content, system screenshots, and image copy to the system clipboard.
- Local file tasks that compress images or PDFs to a requested byte limit with approval, PDF rasterization warnings, non-destructive output, and per-file verification.
- Conversation workspaces that grant a single conversation controlled access to inspect, search, create, and modify files with a visible tool activity timeline.
- Progressive multi-engine retrieval through Google, Bing, DuckDuckGo, and Google News, with query planning, source deduplication, evidence evaluation, and auditing before highly relevant material is organized into the conversation context.
- Automatic system light/dark theming with manual overrides, plus a gold theme unlocked by a valid official G-LLM API key.
- Frosted-glass modal backdrops and progressive entry animations, with reduced-motion preference support.
- Privacy-friendly anonymous telemetry. The client only sends anonymous metadata and does not collect chat content, API keys, file content, screenshot content, knowledge base content, or memory content. Users can disable telemetry in settings.
- Updates. Windows checks GitHub Releases and downloads updates in the background, then installs on restart or app exit. macOS and Linux keep version checking with manual downloads.

## Desktop Resident Behavior

The client includes the following resident desktop behavior:

- A single click on the Windows tray icon, macOS menu-bar icon, or desktop pet opens Quick Chat; the context menu provides Open Main Window and the full set of actions.
- On Windows, closing the main window hides the app to the system tray instead of quitting.
- When the floating assistant is enabled, minimizing or closing the main window keeps the floating G-LLM logo available for quick access.
- The floating logo can be dragged and snaps to the screen edge.
- The floating logo and tray/menu-bar icon share the same right-click menu: open Quick Chat, open the main window, show/hide the floating logo, and quit G-LLM.
- The quick chat window is transparent, frameless, always-on-top, and designed for fast access.
- Quick Chat and the main window share message actions, full timestamps, time zones, and token usage details.
- The screenshot button hides the current app window before entering the Windows screenshot flow.
- Single-instance protection is enabled. Launching the shortcut again brings the existing app to the front instead of starting another process.
- Main-process logs are written to `%APPDATA%/G-LLM/logs/main.log` for startup and crash diagnostics.

> V2.0.6 is the first Windows automatic-update bridge release and must be installed manually once. Later Windows releases can update inside the client. Current packages still do not use commercial platform-signing certificates.

## Development

```bash
pnpm install
pnpm dev
```

For browser or G-LLM Web integration, follow the [G-LLM custom URL protocol contract](./docs/browser-deep-link.md). Automatic API-key setup puts only a single-use, 90-second handoff code in the URL—never the plaintext credential.

Build:

```bash
pnpm build
pnpm package:win
pnpm package:mac
pnpm package:linux
```

Build artifacts are written to `dist/`. GitHub Actions creates Windows, macOS, and Linux packages with updater metadata, SHA-256 manifests, and provenance. The current transition release has no commercial code-signing certificates: Windows supports in-app updates, while macOS and Linux remain manual. See [Automatic updates and releases](./docs/secure-auto-update.md) for the enforced controls.

## API Contract

The client calls an OpenAI-compatible streaming Chat Completions endpoint:

```http
POST {apiBaseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

Example request body:

```json
{
  "model": "g-llm-chat",
  "messages": [],
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": true
}
```

The default provider is G-LLM:

```text
https://llm.gprophet.com/v1
```

Users provide their own API key on first use. Additional OpenAI-compatible providers can also be configured from templates.

Model fetching uses:

```http
GET {apiBaseUrl}/models
Authorization: Bearer {apiKey}
```

The client supports standard OpenAI `/models` responses and simple string-array model lists.

## Release QA

Before shipping, use [docs/release-qa-checklist.md](./docs/release-qa-checklist.md) for cross-platform QA, then verify the Environment, Rulesets, immutable Releases, checksums, and provenance controls described in [Automatic updates and releases](./docs/secure-auto-update.md).

## License

G-LLM Client is published by GPROPHET LIMITED. The current V2.0.6 version is licensed under the [Business Source License 1.1](./LICENSE) with an Additional Use Grant.

Personal use, research, evaluation, and internal business operations are free. Without a written commercial license from GPROPHET LIMITED, you may not white-label or OEM the client, resell or rent it, release or distribute it as a competing product, or provide it to third parties as a hosted, managed, outsourcing, service-bureau, or application service.

V2.0.6 automatically changes to AGPL-3.0-only on 2030-08-01. V1.0.10 and earlier are unaffected and remain under the license included in each release tag.

See [LICENSE](./LICENSE) and [LICENSE_POLICY.md](./LICENSE_POLICY.md) for the controlling scope, [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md) for commercial licensing, and [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing code.

For commercial licensing, OEM cooperation, enterprise deployment, or white-label authorization, contact:

```text
GPROPHET LIMITED
Email: licensing@gprophet.com
Website: https://llm.gprophet.com/
```

The source license does not grant rights to use "G-LLM", "G-LLM Client", related logos, icons, slogans, or brand assets. See [TRADEMARKS.md](./TRADEMARKS.md) for brand rules and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for third-party licenses.
