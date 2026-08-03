<div align="center">

<img src="src/assets/icons/app-icon.png" alt="Libra" width="112" />

# Libra

**面向 AI 编程工具的一站式配置、供应商与工作流管理器**

统一管理 Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build、OpenCode、OpenClaw 与 Hermes Agent。

[官方网站](https://libra.irises.cc) · [使用文档](docs/user-manual/zh/README.md) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/farion1231/cc-switch/issues)

</div>

## 项目简介

Libra 是一款基于 Tauri 2 构建的桌面应用，用一个界面管理多个 AI 编程工具的供应商配置、MCP、Prompts、Skills、会话和本地代理。它可以在官方登录、官方 API 与兼容 API 服务之间快速切换，并提供故障转移、请求日志、Token 用量和成本统计。

本仓库当前版本为 **1.0.0**，重点提供 Windows 便携版体验：程序与数据可以放在同一目录中移动，不依赖安装程序。项目同时保留 macOS 与 Linux 的跨平台构建能力。

> Libra 会修改所管理工具的实时配置文件。首次使用前建议备份现有配置；切勿把包含 API Key、OAuth 凭据或会话数据的 `LibraData`、`.libra` 目录提交到代码仓库。

## 主要功能

### 多应用与供应商管理

- 管理 Claude Code、Claude Desktop、Codex、Gemini CLI、Grok Build、OpenCode、OpenClaw 和 Hermes Agent。
- 使用内置模板或自定义端点添加供应商，支持排序、复制、启用和恢复官方登录。
- 将同一供应商配置复用于多个受支持应用，并保留各应用的独立高级选项。
- 支持端点测速、余额查询、模型选择以及从现有配置导入。

### 本地代理与可观测性

- 本地代理接管和请求格式转换。
- 主备供应商故障转移与熔断保护。
- 请求日志、Token 用量、费用估算和模型定价维护。
- 支持 HTTP、HTTPS 和 SOCKS5 出站代理。

### MCP、Prompts、Skills 与会话

- 统一维护 MCP Server，并同步到不同 AI 工具。
- 使用 Markdown 编辑和切换系统提示词预设。
- 从本地目录或 GitHub 仓库导入、安装、更新和同步 Skills。
- 浏览、搜索和恢复多应用会话；管理 OpenClaw 工作区与 Hermes Memory。
- 支持配置备份、恢复、SQL 导入导出以及 WebDAV 同步。

### Libra 专属能力

- **Libra Codex+**：为 Codex 增加 Fast/Standard 切换、快速启动、模型白名单扩展、Markdown 会话导出、会话移动/删除和插件市场解锁。
- **Codex Radar**：每 60 秒读取社区众测数据，展示不同模型与 reasoning effort 的智力效率、平均价格和平均耗时。
- **Windows Computer Use Guard**：为 Codex 写入可撤销的独立安全策略。
- **真正的便携模式**：检测到 `portable.ini` 后，将数据库、设置、日志、备份和 Skills 全部保存在程序旁的 `LibraData` 中。
- **平滑迁移**：默认使用 `.libra` 与 `libra.db`，并兼容从旧版 `.cc-switch` 数据目录迁移。

> Libra Codex+ 需要本机 Codex 暴露调试端口，默认探测 `9229`、`9333` 和 `9222`。页面增强设置独立保存；关闭增强后，刷新或重新打开 Codex 即可恢复原界面。

## 快速开始

### Windows 便携版

1. 从 [Libra 官网](https://libra.irises.cc) 获取便携版，或使用仓库中的 `portable-release/Libra-Portable.zip`。
2. 将压缩包完整解压到一个可写目录。
3. 确保 `Libra.exe` 与 `portable.ini` 位于同一目录，然后运行 `Libra.exe`。
4. 首次启动后，导入已有工具配置，或点击“添加供应商”创建配置。
5. 启用目标供应商；Codex、OpenCode 等工具如未立即生效，请重新打开终端或对应客户端。

便携版目录结构如下：

```text
Libra-Portable/
├── Libra.exe
├── portable.ini
└── LibraData/          # 首次运行后生成
    ├── libra.db
    ├── settings.json
    ├── model-pricing.json
    ├── skills/
    ├── backups/
    └── logs/
```

移动便携版时，请一起移动 `Libra.exe`、`portable.ini` 和 `LibraData`。如果只复制可执行文件，Libra 将改用当前用户的标准数据目录。

### 首次配置

1. 在左侧选择要管理的应用。
2. 点击“添加供应商”，选择预设或填写自定义 API 地址与 API Key。
3. 点击供应商卡片上的“启用”。
4. 启动对应的 CLI 或桌面应用并发送测试请求。
5. 如需恢复原厂认证，切换到“官方登录”预设并按工具自身的登录流程操作。

CLI 工具需要单独安装，Libra 不会替代 Claude Code、Codex、Gemini CLI 等客户端本身。

## 数据目录

| 模式 | Libra 数据位置 | 说明 |
| --- | --- | --- |
| 便携模式 | `<Libra.exe 所在目录>/LibraData` | `portable.ini` 与程序同目录时优先使用 |
| 标准模式 | `~/.libra` | 可在设置中改为其他目录 |
| 旧版迁移来源 | `~/.cc-switch` | 仅用于兼容已有数据 |

核心文件：

- `libra.db`：供应商、MCP、Prompts 等可同步数据。
- `settings.json`：当前设备的界面与行为设置。
- `model-pricing.json`：用户维护或自动同步的模型价格。
- `skills/`：Libra 管理的 Skills 主副本。
- `backups/`：数据库与迁移备份。
- `logs/`、`crash.log`：运行日志与崩溃诊断信息。

Libra 还会按需读写各受管应用自己的配置目录，例如 `~/.claude`、`~/.codex` 和 `~/.gemini`。具体路径请参阅[配置文件说明](docs/user-manual/zh/5-faq/5.1-config-files.md)。

## 从源码运行

### 环境要求

- Windows 10+、macOS 12+ 或主流 Linux 发行版。
- Node.js **22.12.0**（以 `.node-version` 为准）。
- pnpm 8 或更高版本。
- Rust **1.95**，并安装 `rustfmt` 与 `clippy`（由 `rust-toolchain.toml` 指定）。
- 对应平台的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)；Windows 需要 WebView2 与 MSVC 构建工具。

### 安装与开发

```powershell
corepack enable
pnpm install
pnpm dev
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Tauri 开发环境与 Vite 热更新 |
| `pnpm dev:renderer` | 只启动前端开发服务器 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm format:check` | 检查前端代码格式 |
| `pnpm test:unit` | 运行 Vitest 前端测试 |
| `pnpm build` | 构建当前平台的安装包 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 运行 Rust 测试 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | 运行 Rust 静态检查 |

### 构建 Windows 便携版

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-libra-portable.ps1
```

脚本先构建 Vite 前端，再使用 Cargo 生成 release 可执行文件，最后输出：

```text
portable-release/Libra-Portable.zip
```

也可以指定输出目录：

```powershell
.\scripts\build-libra-portable.ps1 -OutputDirectory D:\Releases\Libra
```

## 技术架构

```text
React 18 + TypeScript + Vite + Tailwind CSS
                    │
                 Tauri IPC
                    │
Tauri 2 + Rust + Tokio + SQLite + Axum/Reqwest
```

- **前端**：React、TypeScript、TanStack Query、i18next、CodeMirror、Radix UI、dnd-kit、Recharts。
- **后端**：Tauri、Rust、Tokio、Serde、rusqlite、Axum、Reqwest。
- **测试**：Vitest、Testing Library、MSW、Rust integration tests。
- **存储**：SQLite 保存核心数据，JSON 保存设备设置；通过原子写入、备份轮换和数据库迁移保护配置。

## 项目结构

```text
.
├── src/                    # React 前端
│   ├── components/         # 供应商、代理、MCP、Skills、会话等界面
│   ├── config/             # 供应商与 MCP 预设
│   ├── hooks/              # 前端业务 hooks
│   ├── i18n/               # 中、英、日、繁中本地化
│   └── lib/                # API 与 Query 封装
├── src-tauri/              # Rust/Tauri 后端
│   ├── src/commands/       # IPC 命令层
│   ├── src/services/       # 业务服务
│   ├── src/database/       # SQLite、DAO 与迁移
│   ├── src/proxy/          # 本地代理与故障转移
│   └── tests/              # Rust 集成测试
├── tests/                  # 前端单元与集成测试
├── docs/                   # 用户手册与版本说明
├── scripts/                # 便携版构建与源码导出脚本
├── flatpak/                # Flatpak 构建资料
└── portable-release/       # 本地便携版产物
```

## 网络访问说明

- 自动更新从 `https://libra.irises.cc/latest.json` 获取版本清单，并使用内置公钥校验更新包。
- Codex Radar 从 `https://codexradar.com` 获取社区众测数据；该页面不可用不会影响其他管理功能。
- 余额查询、测速、模型价格同步、GitHub Skills 与 WebDAV 等功能仅在用户主动配置或启用后访问相应服务。

## 文档

- [中文用户手册](docs/user-manual/zh/README.md)
- [快速上手](docs/user-manual/zh/1-getting-started/1.4-quickstart.md)
- [供应商管理](docs/user-manual/zh/2-providers/2.1-add.md)
- [MCP、Prompts 与 Skills](docs/user-manual/zh/3-extensions/3.1-mcp.md)
- [本地代理与故障转移](docs/user-manual/zh/4-proxy/4.1-service.md)
- [会话管理说明](session-manager.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)

## 开源来源与许可证

Libra 基于 [CC Switch](https://github.com/farion1231/cc-switch) 继续开发，并保留原项目的版权与许可声明。源码采用 [MIT License](LICENSE) 发布。

项目代码中的 `cc-switch` 包名、Rust crate 名或部分历史文档名称用于保持上游兼容，不代表当前产品名称；面向用户的正式名称统一为 **Libra**。

MIT © Jason Young and Libra contributors
