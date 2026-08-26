# SDK 包扫描报告（sdk/packages）

> 扫描日期：2026-08-26 · 范围：`sdk/packages/` 全部 6 包 + `sdk/README.md`
> 统计口径：排除 node_modules/dist

---

## 1. 分层架构与依赖方向

```
shared ──► llms ──► agents ──► core ──► CLI / VS Code / cline-hub 等应用
   └──────────┴───────▲──────────┘
        shared 直供 agents / core
```

| 包 | 版本 | 定位 | TS 文件 | 行数 | 测试 |
|---|---|---|---:|---:|---:|
| `@cline/shared` | 0.0.64 | 类型/schema/工具契约/hook 引擎等底层契约 | 107 | 18,761 | 24 |
| `@cline/llms` | 0.0.64 | LLM 提供商网关（~48 个 provider） | 90 | 50,519 | 30 |
| `@cline/agents` | 0.0.64 | 无状态 agent 循环（browser-safe） | 4 | 3,875 | 2 |
| `@cline/core` | 0.0.64 | 有状态编排：会话/持久化/内置工具/RPC hub | 397 | 130,525 | 132 |
| `@cline/sdk` | 0.0.64 | 用户安装入口（core 的零逻辑门面） | 1 | 1 | 0 |
| `@cline/ui` | 0.1.0 | Web 主题 + 可复用 agent 聊天组件（React） | 9 | 1,744 | 3 |
| **合计** | — | — | **608** | **≈205,400** | **191** |

## 2. @cline/core —— 复杂度中心（占 SDK 总量 ~64%）

**入口**：`ClineCore.ts` 主类 + `src/index.ts` 975 行 barrel；子路径导出 `./hub`、`./telemetry`、`./services/feature-flags/posthog` 等。

**主要依赖**：`@modelcontextprotocol/sdk ^1.29.0`、OpenTelemetry 全套（~10 包）、`simple-git`、`ws`、`yaml`、`zod ^4.3.6`、`jiti`、`node-machine-id`；可选 peer `posthog-node`。

**目录结构与职责**：

| 目录(文件数) | 职责要点 |
|---|---|
| `extensions/`(90) | 内置工具（constants.ts 定义 9 个默认工具：read_files/search_codebase/run_commands/fetch_web_content/apply_patch/editor/skills/ask_question/submit_and_exit）、MCP 管理（stdio/SSE/streamable-http+OAuth）、多智能体团队（AgentTeam/spawn 工具）、插件贡献注册表 |
| `hub/`(57) | 共享守护进程 daemon/discovery/server/client/runtime-host，跨进程会话管理与 RPC sidecar |
| `services/`(86) | SqliteSessionStore 持久化、ProviderSettingsManager、OpenTelemetry+PostHog 遥测（30+ capture 函数）、feature-flags、workspace 服务 |
| `runtime/`(47) | RuntimeHost 抽象、DefaultRuntimeBuilder 组装 SessionRuntime、subprocess-sandbox 工具审批沙箱、turn-queue |
| `session/`(27) | 会话快照、版本化（SessionVersioningService）、checkpoint diff/恢复、会话图 |
| `cron/`(31) | 计划任务自动化（specs/service/store/runner/reports/events） |
| `auth/`(17) | Cline OAuth、OpenAI Codex、OCA 登录、凭证刷新、本地 OAuth 回调服务器 |
| 其他 | account(7)、hooks(10)、cline-core(5)、logging、remote-config、settings |

## 3. @cline/llms —— 提供商网关

- 基于 Vercel AI SDK v6：`@ai-sdk/{anthropic,google,google-vertex,mistral,openai,openai-compatible,amazon-bedrock}` + ollama/claude-code/codex-cli/opencode/dify/sap 等 provider 适配
- `providers/ids.ts` 的 `BUILT_IN_PROVIDER` 定义 **~48 个 provider ID**：第一方（anthropic/cline/cline-pass）、云（bedrock/vertex/gemini）、本地（ollama/lmstudio）、兼容端点（deepseek/xai/together/fireworks/groq/moonshot/qwen/doubao/minimax/zai 等）、聚合器（openrouter/litellm/vercel-ai-gateway）
- 关键模块：`catalog/`（catalog.generated.ts 生成目录 + models.dev 实时目录）、`providers/gateway.ts`（DefaultGateway）、`middleware/routing`（wire-format 编码规则）、`billing.ts`（订阅限制错误 ClineNotSubscribedError/ClinePassLimitError）
- 测试特色：**VCR 录制回放**（`tests/provider-vcr/`），另有 `test:live`/`test:vcr` 专用脚本

## 4. @cline/agents —— 极简 agent 循环

仅 4 个文件，核心 `agent-runtime.ts` 单文件 1,666 行：
- `Agent`/`AgentRuntime` 同类双名；`createAgent` 工厂；`AgentRuntimeAbortError`
- 配置为判别联合：`ConfigWithModel`（core 传预构建模型）/ `ConfigWithProvider`（内部经 llms 构建）
- 职责纯度：流式事件（AgentEventListener）、工具编排（before/after hooks）、StopControl、token 用量；**不涉及会话/存储/配置**

## 5. @cline/shared 与 @cline/sdk

- shared 提供 8 个导出子路径（`.`、`./browser`、`./types`、`./storage`、`./db`、`./node`、`./automation`、`./remote-config`）；22 个子目录覆盖 agents/tools/hooks/extensions/llms/prompt/parse/rpc/connectors/cron/team 等
- 关键导出：`createTool`、`ContributionRegistry`、hook 事件 payload schema、`buildClineSystemPrompt`、媒体预算校验、token 估算、`RemoteConfigSchema`、VCR 测试初始化
- `@cline/sdk` 整包仅 1 行：`export * from "@cline/core"` —— 发布门面

## 6. @cline/ui

- 无 src/ 目录，源码在包根：`components/agent-chat/index.tsx` + CSS、`theme/` 四套样式（tokens.css 设计令牌）
- Storybook 9 故事 + 构建前主题一致性校验脚本（validate-theme.ts）+ 打包冒烟脚本
- peer 依赖可选 react/tailwindcss；标记 internal 但可发布

## 7. 观察

1. **分层纪律严格**：agents 仅 3,875 行即完成完整循环；复杂度全部压在 core。
2. **测试密度**：core 33% 文件为测试；llms 用 VCR 做 provider 回归；ui 有主题校验防线。
3. **API 面风险点**：SDK 对外 API 实际由 core 的 975 行 barrel 决定，barrel 再导出面很大（含 telemetry/posthog 子路径），公共 API 收敛尚在进行中（版本仍 0.0.x）。
