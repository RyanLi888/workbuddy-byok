# WorkBuddy BYOK

[![CI](https://github.com/RyanLi888/workbuddy-byok/actions/workflows/ci.yml/badge.svg)](https://github.com/RyanLi888/workbuddy-byok/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/RyanLi888/workbuddy-byok)](https://github.com/RyanLi888/workbuddy-byok/releases/latest)
[![MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

免费、开源的 WorkBuddy 本地模型网关。使用自己的 API 地址和凭据，在桌面工具中管理模型，并自动同步到 WorkBuddy。

[English](README.md) · [下载安装包](https://github.com/RyanLi888/workbuddy-byok/releases/latest) · [反馈问题](https://github.com/RyanLi888/workbuddy-byok/issues) · [参与贡献](CONTRIBUTING.md)

> 本项目基于 [leookun/cursor-byok](https://github.com/leookun/cursor-byok) 二次开发，是独立社区项目，与 WorkBuddy、腾讯、Cursor 及模型服务商无隶属、合作或官方背书关系。工具本身免费，所接入的 API 和账号服务可能收费。使用前请阅读下方免责声明。

## 功能

- 接入 OpenAI Chat Completions、OpenAI Responses 和 Anthropic 兼容 API。
- 配置模型、使用服务商预设、测试连接，并自动同步到 WorkBuddy。
- 内置 Codex、Google Antigravity 和 Grok 账号插件，管理登录凭据与账号模型目录。
- 转发流式文本、思考、工具调用和用量；对话管理与工具执行由 WorkBuddy 完成。
- 本地调用记录、Token 统计、延迟图表与费用估算。
- Windows、macOS 和 Linux 桌面构建、托盘运行及带签名校验的应用更新。

账号插件能否使用取决于上游接口、账号权限、额度及服务条款。离线测试通过不代表真实账号始终可用。

## 下载与安装

从 [GitHub Releases](https://github.com/RyanLi888/workbuddy-byok/releases/latest) 下载对应平台的文件。

| 平台 | 架构 | 安装文件 |
| --- | --- | --- |
| Windows | x64 | `*-setup.exe`（推荐）、`.msi` 或便携版 `.zip` |
| macOS | Apple Silicon / ARM64 | `*_aarch64.dmg` |
| macOS | Intel / x64 | `*_x64.dmg` |
| Linux | x64 | `.deb` 或 `.AppImage` |

请选择与 CPU 对应的安装包。`.sig`、`latest.json` 和 `portable-latest.json` 用于自动更新。安装桌面工具无需 Rust、Node.js 或单独启动服务；账号插件在初始化时下载运行时。Windows 便携版需要系统安装 WebView2。

Windows 推荐 EXE 安装包，默认按当前用户安装，适合自动更新。MSI 为全局安装，默认写入 Program Files，升级时需要管理员权限或重新运行新版 MSI。便携版需放在当前用户可写的目录中才能更新。

更新文件的签名校验与 Windows 发布者证书、Apple 公证不同。首发安装包没有 Windows 发布者证书和 Apple 公证，系统可能提示确认。运行前请核对源码及发布来源。

## 快速开始

1. 安装 WorkBuddy 与 WorkBuddy BYOK。
2. 在「WorkBuddy 模型」添加接口协议、API 地址、密钥和模型标识，保存并测试。
3. 开启「WorkBuddy 网关」（首次安装默认关闭）。开启后约 2 秒自动同步模型，也可点击「一键同步」立即写入。
4. 在 WorkBuddy 刷新模型设置或重启，选择同步后的模型。调用期间保持 WorkBuddy BYOK 运行；关闭窗口可留在托盘。

使用账号插件时，先在「插件配置」初始化运行时，登录或导入凭据，再同步账号模型目录。

默认基础地址为 `http://127.0.0.1:3721/v1`。同步会将完整 `/v1/chat/completions` URL 写入 `~/.workbuddy/models.json`，使用 WorkBuddy 自定义协议选项。参见 [WorkBuddy 官方模型配置说明](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)。

## 工作方式

```text
桌面配置 API / 登录账号
    -> 本地模型设置 / 插件凭据
    -> 统一模型目录
    -> ~/.workbuddy/models.json（网关地址和网关密钥）

WorkBuddy 对话和工具结果
    -> 本地 /v1/chat/completions
    -> 自定义 API 或账号插件
    -> 流式文本、思考、工具调用和用量
    -> WorkBuddy 执行工具，继续发起下一次模型请求

网关调用记录 -> 本地 SQLite 数据库 -> 桌面统计
```

WorkBuddy 负责对话状态与 Agent 执行；本工具负责模型路由、协议转换、凭据、配置同步和调用记录。

## 数据与配置

设置、调用记录、插件凭据与运行时默认位于 `~/.workbuddy-byok`，数据库为 `workbuddy-byok.db`。上游 API 密钥保留在本工具中，同步到 WorkBuddy 的仅为网关地址与网关密钥。凭据和请求、响应记录可能含有敏感信息，请保护数据目录。本地存储不代表离线推理：模型请求仍会发送至你配置的服务商。

同步通过 `workbuddy-byok:` 标签识别托管模型，保留个人模型及其字段。写入前备份为 `models.json.bak`，再原子替换；无法解析的文件会报错并保留。显示名称用于生成唯一模型 ID，重命名后已有对话需要重新选择模型。

网关默认关闭；网关密钥留空时允许本地免密调用。需要鉴权时，在设置中配置密钥并重新同步。除非有明确需求并已配置访问保护，建议保持本地回环监听。

| 环境变量 | 用途 |
| --- | --- |
| `WORKBUDDY_DATA_DIR` | 数据库、设置、插件凭据和运行时目录 |
| `WORKBUDDY_LISTEN_ADDR` | 独立服务地址，默认 `127.0.0.1:3721` |
| `WORKBUDDY_DATABASE_URL` | SQLite 数据库 URL |
| `WORKBUDDY_MODELS_PATH` | WorkBuddy 模型文件位置 |
| `WORKBUDDY_PROVIDER_TIMEOUT_SECONDS` | 上游请求超时秒数 |
| `WORKBUDDY_CONSOLE_DIR` | 独立服务的前端资源目录 |
| `WORKBUDDY_CONSOLE_PROXY` | 开发时的 Vite 地址 |

Docker 数据位于 `/data`，模型同步文件为 `/data/workbuddy/models.json`。将宿主 WorkBuddy 模型目录挂载到 `/data/workbuddy`，才能与宿主应用共享配置。

## 从源码运行

安装 Rust stable、Node.js 22 或更新版本，以及 [Tauri 对应平台的构建依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone https://github.com/RyanLi888/workbuddy-byok.git
cd workbuddy-byok
npm ci --prefix apps/desktop
npm run tauri:dev --prefix apps/desktop
```

检查、打包、Docker 和贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

```text
workbuddy-byok/                 # 开源应用及构建输入
├── apps/desktop/               # React 界面和 Tauri 桌面壳
│   ├── src/                    # 模型、插件、设置和统计界面
│   ├── plugins/                # 本地化与内嵌许可证构建插件
│   └── src-tauri/              # 原生启动、托盘及更新
├── server/                     # 本地网关和持久化
│   ├── src/api/byok/           # 标准模型 HTTP 接口
│   ├── src/control/            # 桌面管理 HTTP 接口
│   ├── src/provider/           # 自定义 API 转发及记录
│   ├── src/plugin/             # 插件授权、运行时和 SDK
│   ├── src/store/              # SQLite 设置及调用记录
│   ├── plugins/build-in/       # 随应用打包的账号适配器
│   ├── migrations/             # 启动所需的数据库结构历史
│   └── tests/                  # 网关和模型同步集成测试
└── .github/                    # 持续检查和标签触发的多平台发布
```

## 来源与致谢

本项目最初基于 **[leookun/cursor-byok](https://github.com/leookun/cursor-byok)** 二次开发。感谢 leookun 和上游贡献者提供的桌面网关、模型服务适配、账号插件及开源成果。WorkBuddy BYOK 在这一基础上，针对 WorkBuddy 的自定义模型配置与标准 HTTP 模型协议进行改造。

保留上游版权声明与 MIT 许可证，详细来源和第三方声明见 [UPSTREAM.md](UPSTREAM.md)。本仓库的修改与支持由本项目维护者负责，上游维护者不对这些修改承担责任。

## 免责声明

本软件按 **“原样”（AS IS）** 提供，不对可用性、准确性、安全性、模型兼容性或特定用途适用性作出保证。在适用法律允许的范围内，作者与贡献者不对使用本软件造成的损失承担责任，包括账号限制、API 费用、数据丢失或泄露、服务中断等；完整担保及责任条款以 [LICENSE](LICENSE) 为准。

使用者应仅使用有权访问的账号和 API 密钥，自行遵守适用法律及上游服务条款，管理费用和额度、备份配置，并在执行前核查模型输出。本项目不授予绕过访问控制或服务限制的权利，也不承诺免费或无限额度的模型访问。模型输出可能有误，工具执行仍由 WorkBuddy 与使用者控制。

WorkBuddy、腾讯、Cursor、OpenAI、Google、xAI 等产品名称和标识归各自权利人所有，仅用于说明适配对象，不表示合作、赞助或官方认可。

## 许可证与反馈

源码采用 [MIT License](LICENSE)，第三方内容适用 [UPSTREAM.md](UPSTREAM.md) 中的声明。欢迎提交 Issue 和 Pull Request。安全漏洞请依照 [SECURITY.md](SECURITY.md) 私下报告；公开反馈中请勿包含密钥、登录凭据或原始敏感请求日志。
