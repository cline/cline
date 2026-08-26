# apps/cli 扫描报告 —— Cline CLI 终端智能体

> 扫描日期：2026-08-26 · 路径：`apps/cli/`

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 包名 | `@cline/cli`（displayName `cline`），版本 **3.0.44** |
| bin | `cline → src/index.ts`（Bun 直接执行 TS；main 为 dist/index.js） |
| 规模 | 359 个 .ts/.tsx ≈ **74,000 行** |
| 测试 | 127 个 *.test.ts ≈26,900 行 + e2e 套件；框架 Vitest + @microsoft/tui-test |
| 许可 | Apache-2.0，engines node >=22 |

## 2. 运行模式（README.md，373 行）

1. 交互 TUI：`cline` / `cline -i`
2. one-shot：`cline "prompt"`
3. JSON NDJSON 流：`--json`
4. yolo 免审批：`--yolo`
5. zen 后台 hub 守护：`--zen`

特性：Plan/Act 切换、MCP、checkpoints `/undo`、子代理与 agent teams、OAuth（cline / openai-codex / OCA）、思考预算、cron 调度、聊天平台连接器。

## 3. 关键依赖

- TUI：**@opentui/core / @opentui/react (0.1.102)** + React 19.2.4 + react-reconciler
  - ⚠️ OpenTUI 原生核心经 `bun:ffi` 加载，需 **Zig** 编译——DEVELOPMENT.md 明确缺 Zig 则 `bun install` 失败；也因此无法跑在纯 Node 上
- 命令：commander ^14
- 聊天连接器：`@chat-adapter/{discord,gchat,linear,slack,telegram,whatsapp}`
- 编辑器集成：`@agentclientprotocol/sdk`（ACP）
- workspace：`@cline/core`、`@cline/shared`、`@cline/cline-hub`

## 4. 源码结构

```
src/
├── index.ts        # 入口：信号处理/VCR/hub-daemon 分流 → main.runCli()
├── main.ts         # 主流程(1269 行)，commander 驱动
├── acp/            # Agent Client Protocol 模式(acpAgent/auth/permissions/session-updates)
├── commands/       # program.ts(createProgram) + auth/connect/dashboard/doctor/history/hub/
│                   #   kanban/mcp/plugin/schedule/skill/update/help + rpc-runtime/
├── connectors/     # 聊天平台连接器(registry/catalog/chat-runtime/session-runtime/
│                   #   runtime-turn/thread-bindings/task-updates + adapters/ stores/)
├── runtime/        # run-agent/run-interactive/run-zen/prompt/tool-policies/session-events/
│                   #   active-runtime + interactive/（REPL）
├── tui/            # OpenTUI React 界面(root.tsx/palette/views/components)
├── wizards/        # connect / mcp / schedule 交互向导
├── kanban-migration/ kanban 迁移提示
├── logging/ session/ utils/(~50 模块: telemetry/provider-auth/feature-flags/hooks/resume/worktree...)
└── tests/          # e2e(cli/configs/fixtures/headless/helpers/interactive + tui-test.config.ts)
```

命令注册位于 `src/commands/program.ts`（根级选项 `-p/--plan`、`--json`、`--auto-approve`、`-i/--tui`、`--acp`、`-z/--zen` 等）。

## 5. 分发方式（DISTRIBUTION.md）

- 因 bun:ffi 依赖，发布走 `bun build --compile` 自包含二进制
- 共发 **7 个 npm 包**：6 个 `@cline/cli-*` 平台包（darwin/linux/windows × arm64/x64）+ `cline` 包装包经 optionalDependencies 解析

## 6. 观察

1. CLI 是 SDK 的"第一公民"宿主，直接消费 core/shared，无 gRPC 层，链路最短。
2. evals 文档提到冒烟测试正迁移到"新的 SDK CLI"——本应用即迁移目标。
3. TUI 采用 React 渲染终端（OpenTUI），与传统 Ink 方案不同，构建链路特殊（Zig/bun:ffi），是新贡献者环境搭建的最大门槛。
