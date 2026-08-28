# G-LLM Client

[简体中文](./README.md) | [English](./README.en-US.md)

Current code version: [V2.0.12](https://github.com/filwu8/G-LLM-Client/tree/main)

Latest stable release: [V2.0.12](https://github.com/filwu8/G-LLM-Client/releases/tag/v2.0.12), released on 2026-08-28.

> Starting with V1.1.0, the source is licensed under BUSL-1.1 for free personal and internal business use; each version's conversion date is defined by the `LICENSE` included with that release. V1.0.10 and earlier remain under the AGPL-3.0-only license included in their release tags.

[Download](https://llm.gprophet.com/download) | [Full changelog](https://llm.gprophet.com/download/changelog) | [GitHub Releases](https://github.com/filwu8/G-LLM-Client/releases)

G-LLM Client is a cross-platform desktop AI client built by GPROPHET LIMITED for Windows, macOS, and Linux. The product direction is assistant-first: users choose or create a role-based assistant, then use one desktop client for model configuration, knowledge references, screenshots, file understanding, and multi-turn conversations.

## Interface Preview

The workspace agent can read and modify files inside a user-authorized directory while showing its actions in the conversation. Eligible paid G-LLM users can also enable the exclusive gold theme.

![Business-plan assistant and workspace agent in the gold theme](./docs/images/gllm-gold-workspace.png)

Local file tools can generate, modify, and compress files in a conversation. Light and dark themes are available to every user.

| Dark theme | Light theme |
| --- | --- |
| ![PDF compression task in the dark theme](./docs/images/gllm-dark-file-tools.png) | ![PDF compression task in the light theme](./docs/images/gllm-light-file-tools.png) |

## V2.0.12 Cross-Platform Icons and Quick Chat Search Progress

- The Windows tray icon now uses the same complete monochrome logo as the macOS menu bar and automatically selects a black or white version based on the actual system taskbar appearance.
- Native 16–64 pixel Windows icon frames improve edge quality at different DPI scales, while a slightly larger visual footprint keeps the logo from appearing undersized beside other tray icons.
- macOS now uses a dedicated Dock icon with a safe-area inset, correcting the oversized appearance on older MacBooks while retaining a balanced size on newer devices.
- Quick Chat now shows search planning, query progress, results, and sources just like the main window, without a duplicate thinking placeholder while research is active.

## V2.0.11 Quick Chat Stability and Conversation Handoff

- Fixed Quick Chat's waiting status being squeezed into a one-character-wide vertical column by a legacy animation selector, and stabilized unfinished bold, strikethrough, and inline-code markers during streaming.
- Quick Chat now uses the same Markdown content layout as the main window, reducing early line jumps and reflow in the narrow conversation view.
- Windows Quick Chat now provides an always-available vertical scrollbar with reserved space and visible contrast in dark and gold themes.
- Opening the main window from Quick Chat first saves the current content and hands off the exact space, assistant, and conversation IDs so the same context remains selected.

## V2.0.10 Model Stability, Document Delivery, and Diagnostics

- Workspace model requests now retry temporary network and upstream failures and correctly handle responses that contain only reasoning, omit a final answer, or never perform the required file operation.
- Busy, timeout, and upstream-routing failures now use clear guidance to switch models and retry instead of exposing opaque gateway JSON.
- Added native PDF generation and artifact-contract verification for the requested Word/PDF format, filename, single final file, and editable Word-table requirements.
- Regular chat and workspace tasks now keep a local structured run history; Settings can export a credential-redacted diagnostic report covering retries, tools, verification, tokens, and terminal states.
- Fixed unrendered Markdown emphasis when Chinese or English text touches a closing bold delimiter, without confusing multiple bold spans in the same paragraph.

## V2.0.9 Stability, Documents, and Cross-Platform Experience

- Fixed workspace authorization disappearing after a model change, repeated blank conversations, stop indicators that kept spinning, overflowing edit fields, and requests that appeared not to send.
- Added native interactive region capture and permission diagnostics on macOS; sent images now render larger and open in a full-size preview.
- Word generation now converts Markdown tables into real editable DOCX tables, validates document structure, honors the requested output format, and keeps one final deliverable.
- Web search now offers global Auto / On / Off modes, defaults to Off, and remembers the user's choice; search planning also gains timeout fallbacks and recovery when sources are insufficient.
- Long conversations and workspace tool results compact older context and show the saved percentage, reducing token usage while preserving the latest instruction and verifiable results.
- Improved the gold theme, model picker, message editor, screenshot preview, and web-search menu for alignment, contrast, and narrow-window layouts.

## V2.0.8 Edit and Resend

- Sent user messages in the main chat and Quick Chat can now be edited in place and resent, with `Command/Ctrl + Enter` to submit and `Escape` to cancel.
- Resending preserves the earlier context and replaces the old reply branch after the edited message; affected project memories are also cleared so stale answers do not contaminate the new branch.
- The original images, files, quotes, and knowledge references are preserved, and conversations with authorized folders continue to use the workspace agent.
- The new request keeps the conversation's current provider, model, reasoning effort, and web-search setting.

## V2.0.7 Performance and Long-Reasoning Stability

- Screenshots, attachments, file tasks, the workspace agent, and window renderers now load on demand, while conversation saves use incremental synchronization to reduce startup and switching overhead.
- Historical Markdown avoids unrelated reparsing, streaming fragments render in batches, and the floating assistant is created only when needed with a capped frame rate.
- The workspace agent now supports single-newline SSE, Nemotron `reasoning_content`, fragmented tool calls, and `[DONE]` responses whose connections close late.
- Streaming uses response-header and per-chunk idle timeouts, so long reasoning that keeps sending content or heartbeats is no longer limited by a fixed 120-second total timeout.

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
- Streaming chat, starter prompts, Markdown rendering, conversation history, local persistence, and editing and resending sent messages. Long conversations preserve the latest instruction while compacting older context, and the main window and Quick Chat show total/input/output tokens plus the request's context-saving percentage.
- Intelligent conversation search across spaces using topics, people, tasks, or conclusions, with direct navigation back to the original conversation.
- Local-first features including lightweight knowledge base, assistant memory, persistent project memory, local data storage, and data import/export.
- Attachments and visual inputs including files, images, pasted clipboard content, system screenshots, and image copy to the system clipboard.
- Local file tasks that compress images or PDFs to a requested byte limit with approval, PDF rasterization warnings, non-destructive output, and per-file verification.
- Conversation workspaces that grant a single conversation controlled access to inspect, search, create, and modify files. Large text is read in ranges, while completed older tool payloads become verifiable summaries and the newest read result remains verbatim.
- Agent runtime persistence for both regular chat and workspace tasks, recording model requests, retries, tools, approvals, artifact verification, and terminal states locally. An app restart marks unfinished runs as interrupted instead of leaving a false running state.
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
- Main-process logs are written to `%APPDATA%/G-LLM/logs/main.log`. Settings can also export a credential-redacted JSON diagnostic report with recent structured run timelines, token usage, retries, and failure categories.

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

G-LLM Client is published by GPROPHET LIMITED. V1.1.0 and later releases use the [Business Source License 1.1](./LICENSE) included with each version, with an Additional Use Grant.

Personal use, research, evaluation, and internal business operations are free. Without a written commercial license from GPROPHET LIMITED, you may not white-label or OEM the client, resell or rent it, release or distribute it as a competing product, or provide it to third parties as a hosted, managed, outsourcing, service-bureau, or application service.

Each BUSL release automatically changes to AGPL-3.0-only on the Change Date specified in its `LICENSE`. V1.0.10 and earlier are unaffected and remain under the license included in each release tag.

See [LICENSE](./LICENSE) and [LICENSE_POLICY.md](./LICENSE_POLICY.md) for the controlling scope, [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md) for commercial licensing, and [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing code.

For commercial licensing, OEM cooperation, enterprise deployment, or white-label authorization, contact:

```text
GPROPHET LIMITED
Email: licensing@gprophet.com
Website: https://llm.gprophet.com/
```

The source license does not grant rights to use "G-LLM", "G-LLM Client", related logos, icons, slogans, or brand assets. See [TRADEMARKS.md](./TRADEMARKS.md) for brand rules and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for third-party licenses.
