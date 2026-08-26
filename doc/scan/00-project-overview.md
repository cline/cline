# Cline 项目全库扫描 · 总览报告

> 扫描日期：2026-08-26
> 扫描范围：整个 monorepo（sdk/、apps/、evals/、doc/、docs/、根级配置）
> 本报告为扫描系列的总纲，各模块详细报告见同目录其他文档。

---

## 1. 项目定位

Cline 是一个开源 AI 编码智能体（coding agent），以多种宿主形态发布：

| 形态 | 说明 | 入口 |
|---|---|---|
| CLI | 终端智能体，交互 TUI / headless / JSON 流 / zen 守护 | `npm i -g cline` |
| VS Code 扩展 | 编辑器内人机协同助手（Marketplace 主力产品） | `claude-dev` v4.9.9 |
| JetBrains 插件 | 同一体验的 JetBrains 家族版本（独立仓库） | Marketplace 28247 |
| Kanban | Web 任务板，并行多 agent，每卡片独立 worktree | `npm i -g kanban`（独立仓库） |
| SDK | `@cline/sdk` —— 驱动以上所有宿主的同一引擎的库形态 | `npm install @cline/sdk` |

核心架构理念：**单一 agent core，多宿主复用**。所有应用都构建在 `sdk/packages/*` 共享包之上。

## 2. Monorepo 结构与技术栈

```
cline/
├── sdk/packages/        # 核心引擎 6 包：shared → llms → agents → core → (sdk 门面) + ui
├── apps/
│   ├── cli/             # @cline/cli v3.0.44 —— 终端智能体
│   ├── cline-hub/       # Hub 浏览器仪表盘（private）
│   ├── vscode/          # claude-dev v4.9.9 —— 原始主力 VS Code 扩展
│   ├── vscode-rollout/  # A/B 灰度发布 loader（private）
│   └── examples/        # 9 个 SDK 示例（vscode / multi-agent 等）
├── evals/               # 三层评测框架（契约/冒烟/E2E + cline-bench 子模块）
├── doc/                 # 内部性能攻坚报告 V11–V21（中文）
├── docs/                # 架构审计与重构迭代报告 v3–v9（中文）
└── .clinerules/         # AI 助手仓库级规则集
```

**技术栈**：
- 运行时/包管理：Bun 1.3.13（`.tool-versions`），Node ≥22；CLI 因 OpenTUI 依赖 Zig 编译原生层
- 语言：TypeScript 5.9（ESM）；Linter/Formatter：Biome 2.4.5
- 测试：Vitest 4 为主，VS Code 扩展混用 Mocha/Bun test/Playwright/@microsoft/tui-test
- UI：React 19.2.4；CLI TUI 用 OpenTUI（@opentui/core+react）；webview 用 Vite + Tailwind 4
- LLM 层：Vercel AI SDK v6 生态（@ai-sdk/anthropic|openai|google|bedrock…）
- 通信：gRPC/proto（VS Code 扩展 hostbridge）、WebSocket/RPC sidecar（hub）、ACP 协议
- 观测：OpenTelemetry 全家桶 + PostHog + Langfuse
- CI 钩子：husky + lint-staged（typecheck + biome check）

## 3. 代码规模汇总（排除 node_modules/dist/generated）

| 模块 | 文件数(.ts/.tsx) | 行数(约) | 测试文件 |
|---|---:|---:|---:|
| sdk/packages 合计 | 608 | ≈205,400 | 191 |
| ├─ core | 397 | 130,525 | 132 |
| ├─ llms | 90 | 50,519 | 30 |
| ├─ shared | 107 | 18,761 | 24 |
| ├─ agents | 4 | 3,875 | 2 |
| ├─ ui | 9 | 1,744 | 3 |
| └─ sdk（门面） | 1 | 1 | 0 |
| apps/cli | 359 | 74,000 | 127 |
| apps/cline-hub | 143 | 37,000 | 7 |
| apps/vscode | 1,153 | 323,000 | 225 |
| apps/examples(vscode+multi-agent) | 99 | 21,700 | 1 |
| apps/vscode-rollout | 5 | 811 | 4 |
| evals（编排代码） | 15 | 轻量 | 含于上 |
| **总计** | **≈2,380** | **≈663,600** | **≈555** |

另：apps/vscode 有 gRPC 生成代码 64 文件 / 约 108,600 行（不计入手写统计）。

## 4. 版本状态（截至扫描日）

- 工作区最新提交：`90b31f389 fix: use open task transcript for pageable message history`
- CHANGELOG 当前大版本：**4.0.0**（扩展迁移到共享 Cline SDK 会话层、Customize 市场、消息队列等）
- VS Code 扩展 package.json 版本：4.9.9；SDK 六包统一 0.0.64（ui 为 0.1.0）；CLI 3.0.44
- git submodule：`evals/cline-bench` @ heads/main
- 未提交变更：`apps/vscode/src/sdk/SdkController.ts`、webview ChatView.tsx、.vscodeignore、doc/v21 报告

## 5. 分模块报告索引

| 报告 | 内容 |
|---|---|
| [01-sdk-packages.md](./01-sdk-packages.md) | SDK 六包分层架构、API 面、依赖与规模 |
| [02-apps-vscode.md](./02-apps-vscode.md) | 主力 VS Code 扩展（含 webview-ui） |
| [03-apps-cli.md](./03-apps-cli.md) | CLI 应用（TUI/headless/连接器） |
| [04-apps-hub-examples-rollout.md](./04-apps-hub-examples-rollout.md) | cline-hub、examples、vscode-rollout 灰度方案 |
| [05-evals.md](./05-evals.md) | 三层评测框架与 cline-bench |
| [06-docs-inventory.md](./06-docs-inventory.md) | doc/ 与 docs/ 全部 37 篇内部文档盘点 |
| [07-findings-and-recommendations.md](./07-findings-and-recommendations.md) | 综合发现、风险点与下一步建议 |

## 6. 关键结论（速览）

1. 架构清晰度高的部分：SDK 分层（shared→llms→agents→core）、"一核多宿主"复用模式、灰度发布机制。
2. 复杂度集中地：`@cline/core` 占 SDK 总量 64%（extensions/hub/services/runtime 四大目录）；`apps/vscode` 是最大单体（32 万行手写 + 10 万行生成代码）。
3. 文档体系呈双轨：英文官方社区文档（根目录）vs 中文内部技术报告（doc/+docs/，37 篇，记录 7–8 月两轮攻坚：重构 v3–v9 与性能优化 V11–V21）。
4. 主要风险与债务：详见 [07-findings](./07-findings-and-recommendations.md)（评测 CI 断档、文档计数滞后、示例缺测试、双扩展并存过渡期等）。
