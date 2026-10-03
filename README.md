# WorkBuddy BYOK

[![CI](https://github.com/RyanLi888/workbuddy-byok/actions/workflows/ci.yml/badge.svg)](https://github.com/RyanLi888/workbuddy-byok/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/RyanLi888/workbuddy-byok)](https://github.com/RyanLi888/workbuddy-byok/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A free, open-source local model gateway for WorkBuddy. Bring your own API endpoints and credentials, manage models, and sync them to WorkBuddy from a desktop app.

[中文说明](README-CN.md) · [Download](https://github.com/RyanLi888/workbuddy-byok/releases/latest) · [Report an issue](https://github.com/RyanLi888/workbuddy-byok/issues) · [Contributing](CONTRIBUTING.md)

> This independent community project is adapted from [leookun/cursor-byok](https://github.com/leookun/cursor-byok). It is not affiliated with or endorsed by WorkBuddy, Tencent, Cursor, or the model providers. The software is free; connected APIs and account services may incur charges. Read the [disclaimer](#disclaimer) before use.

## Features

- Custom OpenAI Chat Completions, OpenAI Responses, and Anthropic-compatible APIs.
- Model configuration, provider presets, connectivity tests, and automatic synchronization with WorkBuddy.
- Built-in Codex, Google Antigravity, and Grok account plugins, with model discovery and credential management.
- Streaming text, reasoning, tool calls, and usage forwarding. WorkBuddy manages conversations and executes tools.
- Local call records, token statistics, latency charts, and estimated costs.
- Windows, macOS, and Linux desktop builds, tray operation, and signed application updates.

Account plugin availability depends on upstream access, account permissions, quotas, and service terms. Offline tests do not establish real-account compatibility.

## Download and install

Download the matching asset from [GitHub Releases](https://github.com/RyanLi888/workbuddy-byok/releases/latest).

| Platform | Architecture | Package |
| --- | --- | --- |
| Windows | x64 | `*-setup.exe` (recommended), `.msi`, or portable `.zip` |
| macOS | Apple Silicon / ARM64 | `*_aarch64.dmg` |
| macOS | Intel / x64 | `*_x64.dmg` |
| Linux | x64 | `.deb` or `.AppImage` |

Choose the package for your CPU. `.sig`, `latest.json`, and `portable-latest.json` are update metadata. Desktop installation does not require Rust, Node.js, or a separate server. Account plugins download their runtime when initialized. The Windows portable build requires WebView2.

Builds use updater signatures, which are separate from Windows publisher certificates and Apple notarization. These initial packages are not publisher-signed on Windows or notarized on macOS; the operating system may prompt before opening them. Check the source and release origin before allowing an application to run.

## Quick start

1. Install WorkBuddy and WorkBuddy BYOK.
2. Open **WorkBuddy models**, add your API protocol, endpoint, key, and model ID, then save and test the model.
3. Enable **WorkBuddy gateway**; it is disabled on a fresh installation. Models synchronize within about two seconds. Use **One-click sync** for an immediate update.
4. Refresh WorkBuddy model settings or restart WorkBuddy, select a synchronized model, and keep WorkBuddy BYOK running. Closing the window leaves it in the tray.

For account plugins, first open **Plugins**, initialize the runtime, sign in or import credentials, and synchronize the account model catalog.

The gateway base URL defaults to `http://127.0.0.1:3721/v1`. Synchronization writes the full `/v1/chat/completions` URL to `~/.workbuddy/models.json` using WorkBuddy's custom protocol option. See the [official WorkBuddy model configuration guide](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model).

## How it works

```text
Desktop configuration / account sign-in
    -> local model settings / plugin credentials
    -> shared model catalog
    -> ~/.workbuddy/models.json (gateway URL and gateway key)

WorkBuddy conversation and tool results
    -> local /v1/chat/completions
    -> custom API provider or account plugin
    -> streamed text, reasoning, tool calls and usage
    -> WorkBuddy executes tools and sends the next request

Gateway call records -> local SQLite database -> desktop statistics
```

WorkBuddy owns conversation state and agent execution. This gateway owns model routing, protocol conversion, credentials, synchronization, and call records.

## Data and configuration

Settings, call records, plugin credentials, and runtime files default to `~/.workbuddy-byok`; the database is `workbuddy-byok.db`. Upstream API keys stay in this tool. Only the gateway URL and gateway key are synchronized to WorkBuddy. Credentials and request/response records may contain sensitive information; protect the data directory. Local storage does not mean offline processing: requests are sent to your chosen providers.

Synchronization preserves personal models, identifies managed entries using `workbuddy-byok:` tags, and backs up the model file to `models.json.bak` before replacing it. Invalid configuration is reported without overwriting it. Display names become unique model IDs; after renaming a model, select it again in existing conversations.

Gateway access is disabled by default. An empty gateway key permits local calls; configure a key in Settings and synchronize again to require authentication. Keep the service on loopback unless you intentionally configure and protect remote access.

| Environment variable | Purpose |
| --- | --- |
| `WORKBUDDY_DATA_DIR` | Database, settings, plugin credentials, and runtime directory |
| `WORKBUDDY_LISTEN_ADDR` | Standalone server address; default `127.0.0.1:3721` |
| `WORKBUDDY_DATABASE_URL` | SQLite database URL |
| `WORKBUDDY_MODELS_PATH` | WorkBuddy model configuration path |
| `WORKBUDDY_PROVIDER_TIMEOUT_SECONDS` | Upstream request timeout |
| `WORKBUDDY_CONSOLE_DIR` | Standalone frontend build directory |
| `WORKBUDDY_CONSOLE_PROXY` | Development Vite URL |

Docker uses `/data` for storage and `/data/workbuddy/models.json` for synchronization. Mount the host WorkBuddy model directory at `/data/workbuddy` to share the file with the host application.

## Build from source

Install Rust stable, Node.js 22 or newer, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
git clone https://github.com/RyanLi888/workbuddy-byok.git
cd workbuddy-byok
npm ci --prefix apps/desktop
npm run tauri:dev --prefix apps/desktop
```

For checks, packaging, Docker, and contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

```text
workbuddy-byok/                 # Open-source application and build inputs
├── apps/desktop/               # React frontend and Tauri desktop shell
│   ├── src/                    # Model, plugin, settings, and statistics UI
│   ├── plugins/                # Localization and embedded license build plugins
│   └── src-tauri/              # Native startup, tray, and application updates
├── server/                     # Local gateway and persistence
│   ├── src/api/byok/           # Standard model HTTP endpoints
│   ├── src/control/            # Desktop management HTTP endpoints
│   ├── src/provider/           # Custom API transport and recording
│   ├── src/plugin/             # Plugin authorization, runtime, and SDK
│   ├── src/store/              # SQLite settings and call records
│   ├── plugins/build-in/       # Bundled account adapters
│   ├── migrations/             # Database schema history required at startup
│   └── tests/                  # Gateway and synchronization integration tests
└── .github/                    # CI and tagged multi-platform release workflow
```

## Acknowledgments and origin

This project began by adapting **[leookun/cursor-byok](https://github.com/leookun/cursor-byok)**. We thank leookun and upstream contributors for the original desktop gateway, provider integration, account plugins, and open-source work. WorkBuddy BYOK adapts that foundation to WorkBuddy's custom model configuration and standard HTTP model protocols.

The upstream copyright and MIT license are retained. See [UPSTREAM.md](UPSTREAM.md) for attribution and third-party notices. Changes and support for this project are maintained in this repository; upstream maintainers are not responsible for them.

## Disclaimer

The software is provided **“AS IS”**, without warranties of availability, accuracy, security, model compatibility, or fitness for a particular purpose. To the extent permitted by applicable law, the authors and contributors are not liable for losses arising from use, including account restrictions, API charges, loss or disclosure of data, or service interruptions. The full warranty and liability terms are in [LICENSE](LICENSE).

You are responsible for using accounts and API keys you are authorized to access, complying with applicable laws and upstream service terms, managing costs and quotas, backing up configuration, and reviewing model output before acting on it. This project grants no rights to bypass access controls or service restrictions and makes no promise of free or unlimited model access. Model output may be incorrect; tool execution remains under WorkBuddy and user control.

Product names and logos belong to their respective owners and identify integration targets only; they do not imply partnership, sponsorship, or endorsement.

## License and support

Source code is licensed under the [MIT License](LICENSE), subject to the third-party notices in [UPSTREAM.md](UPSTREAM.md). Issues and pull requests are welcome. Report vulnerabilities privately using [SECURITY.md](SECURITY.md); do not post credentials or raw sensitive request logs in public issues.
