# apps/vscode 扫描报告 —— 原始主力 VS Code 扩展

> 扫描日期：2026-08-26 · 路径：`apps/vscode/`

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 包名 | `claude-dev`（displayName **Cline**），publisher saoudrizwan |
| 版本 | **4.9.9**（最近提交 `8316906c0` 刚 bump） |
| engines | vscode ^1.101.0；main `./dist/extension.js` |
| 激活 | onLanguage / onUri / onStartupFinished |
| 规模 | src/ 807 文件 ≈162,300 行 + webview-ui/src/ 346 文件 ≈52,000 行 ≈ **1,153 文件 / 32.3 万行**；另有 generated gRPC 代码 64 文件 ≈108,600 行 |
| README | 根 README.md 为空文件，商店文案在 `README.marketplace.md` |

## 2. 功能贡献点（package.json）

- 5 步 Walkthrough、活动栏 webview（`claude-dev.SidebarProvider`）
- 约 **20 个命令**：New Task、MCP Servers、Customize、History、Account、Settings、Add to Chat、终端输出入 Chat、Git 提交信息生成/中止、Explain/Improve Code、Jupyter 单元系列命令、Reconstruct Task History 等
- 快捷键 `cmd+'`；**17 项配置**（language、requestTimeoutMs、terminalExecutionMode、enableCheckpoints、autoCompact、hooksEnabled、maxConsecutiveMistakes、subagentsEnabled、worktreesEnabled、yoloMode、openTelemetryEnabled 等）

## 3. 依赖特征（~90 个）

- LLM SDK 直连：`@anthropic-ai/sdk`、`openai`、`@google/genai`
- MCP：`@modelcontextprotocol/sdk`；浏览器自动化：puppeteer-core + puppeteer-chromium-resolver
- gRPC 全栈：`@grpc/grpc-js`、nice-grpc、buf/ts-proto（proto → generated/）
- OpenTelemetry 全套、posthog-node；文档解析 cheerio/turndown/mammoth/pdf-parse/exceljs
- **workspace 共享包：`@cline/agents`、`@cline/core`、`@cline/llms`、`@cline/shared`**（SDK 迁移进行中的标志）

## 4. 源码结构

```
src/
├── extension.ts        # 激活入口：HostProvider + vscode hostbridge gRPC、WebviewProvider、UI 事件订阅、编辑器命令、迁移
├── core/               # api, context, controller, hooks, ignore, locks, mentions, prompts, storage, task, webview, workspace
├── hosts/              # external / vscode 宿主抽象层
├── services/           # account, auth, browser, feature-flags, logging, mcp, search, telemetry, uri
├── shared/             # clients, proto(+conversions), providers, remote-config, storage, messages, multi-root
├── integrations/       # diagnostics, editor, openai-codex, terminal
├── sdk/                # model-catalog, vscode-lm, SdkController.ts ← SDK 适配层（当前有未提交修改）
├── standalone/         # cline-core.ts, protobus-service.ts, hostbridge-client.ts, memory-monitor.ts
│                       #   （standalone 核心 API server，供 rollout "next" 使用）
├── generated/          # gRPC 生成代码（64 文件，不计入手写统计）
└── exports/ dev/ test/ types/ __tests__/
webview-ui/             # Vite+React+Tailwind4+Storybook 前端子应用
└── src/components/{account,browser,chat,cline-rules,common,history,marketplace,mcp,
     menu,onboarding,settings,ui,welcome,worktrees} + config/context/hooks/lib/services/utils
```

## 5. 测试体系（225 个测试文件）

- Mocha+Chai/Sinon（`@vscode/test-cli` 集成测试，c8 覆盖率）
- Vitest、Bun 单测运行脚本并存
- Playwright e2e（打包 VSIX 后驱动）+ smoke evals
- webview-ui 另有 48 个测试文件
- 脚本约 50 条：proto 生成、esbuild watch/package、多套测试、Marketplace/nightly 发布、knip 死代码分析

## 6. 与 SDK 迁移的关系（重要背景）

结合 `.clinerules/sdk-migration.md` 与 `standalone/` 目录：
1. 本扩展正从"自带全部逻辑"向"运行于 @cline/core 等共享包"迁移；
2. `src/sdk/SdkController.ts` 是适配枢纽（当前工作区有未提交修改，配合最新两条 fix/refactor 提交）；
3. `standalone/cline-core.ts` 提供独立核心 API server，是 rollout 方案中 "next" bundle 的基础；
4. 迁移完成后由 `apps/vscode-rollout` 做 A/B 切换（见报告 04）。

## 7. 观察

1. 体量最大、历史包袱最重的模块；gRPC/proto 通信层（hostbridge + protobus）是其区别于 CLI 的核心基础设施。
2. 测试框架四套并存（Mocha/Vitest/Bun/Playwright），维护成本高。
3. 近期提交热点集中于：webview 消息历史分页、framer-motion chunk 循环依赖修复、auto-compact 可配置化——与 doc/ V11–V21 报告一一对应。
