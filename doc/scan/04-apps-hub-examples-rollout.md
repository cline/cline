# apps/ 其余应用扫描报告 —— cline-hub / examples / vscode-rollout

> 扫描日期：2026-08-26

---

## 1. apps/cline-hub —— Hub 浏览器仪表盘

| 项 | 值 |
|---|---|
| 包名 | `@cline/cline-hub` v0.0.0（private） |
| 定位 | 本地 Cline hub 的浏览器仪表盘：live clients、会话、流式聊天、hub 重启 |
| 规模 | 143 个 .ts/.tsx ≈37,000 行；测试 7 个（Vitest） |
| 依赖 | 仅 workspace：@cline/core、@cline/llms、@cline/shared；webview 为独立 Vite 子应用 |

**功能要点**（README，114 行）：
- 默认 `http://127.0.0.1:8787`；经 `HubUIClient.subscribeUI` 列出已连接客户端与活跃会话
- 点击会话查看历史 + 流式接收新输出；可从初始 prompt 新建会话（provider/model 取最近会话或 `CLINE_PROVIDER`/`CLINE_MODEL` 环境变量）
- Restart Hub 按钮：`stopLocalHubServerGracefully()` → `ensureDetachedHubServer()` 重建守护进程
- 可选 LAN/隧道暴露需共享 `ROOM_SECRET`；文档明确标注"示例仪表盘而非生产管理工具"

**结构**：`src/server.ts` 入口 + `src/server/`(19 模块：http/sessions/approvals/connectors/marketplace/mcp/providers/schedules…) + `src/webview/`(Vite+React：App/Chat/components)。

## 2. apps/examples —— SDK 示例集（9 个）

统一模式：基于 `@cline/sdk`，`bun install && bun run build:sdk && export CLINE_API_KEY=… && bun dev`。README 按难度分级。

### examples/vscode —— CLI RPC 驱动的聊天扩展示例
- `@cline/vscode` private；贡献命令 `clineVscode.openChat` + webview 视图
- 链路：webview → `cline rpc ensure --json` 确保 owner-scoped RPC sidecar → RPC 方法（StartRuntimeSession/SendRuntimeSession/AbortRuntimeSession）→ 运行时事件流入 webview 增量渲染
- 结构：extension.ts **1,615 行**（ClineCore/NodeHubClient/hub 发现/遥测接线）+ hub-daemon.ts + webview/(Vite React)
- 规模：98 文件 ≈20,500 行（webview 占 18,400）；仅 1 个测试

### examples/multi-agent —— Agent War Room
- 单文件实现 `src/index.ts` **1,155 行**（node:http + 内联 HTML/CSS + /run SSE）
- 输入 mission 并行 spawn 4 专家代理（Architect/Security Analyst/Pragmatist/Skeptic），SSE 推流到浏览器卡片，完成后 synthesizer 汇总简报
- 演示概念：Promise.all 并发、每代理独立 subscribe()、SSE、代理组合；无测试

其余 7 个示例：quickstart、cli-agent、cline-core-cli-agent、code-review-bot、desktop-app、menubar 等。

## 3. apps/vscode-rollout —— A/B 灰度发布 loader（重点）

| 项 | 值 |
|---|---|
| 包名 | `@cline/vscode-rollout` v0.1.0（private） |
| 用途 | VS Code Marketplace 不支持分阶段推送，本包实现灰度发布 |
| 规模 | src 仅 5 文件 811 行 + scripts 若干 .mjs；bun test 4 个测试 |

**机制**（README，202 行）：
```
VSIX/
├── extension.js   ← loader（本包构建，~40KB）
├── package.json   ← 双 bundle 清单 UNION（gen-manifest.mjs）
├── next/          ← SDK 版扩展（main 分支 apps/vscode 构建）
└── legacy/        ← 旧版扩展（legacy-extension 分支构建）
```
1. loader 同步读 globalState 缓存的 cohort 分配（从不阻塞网络），设置 `cline.sdkBundle` 上下文键
2. 用 Proxy 包装 ExtensionContext（路径重定向到所选 bundle 子目录），require 并激活恰好一个 bundle；两者共享同一 `~/.cline/data`
3. 后台刷新 PostHog 旗标 `ext-sdk-bundle-rollout`（百分比灰度），下一窗口生效；**0% 即紧急回滚开关**
4. 崩溃自愈：next 激活抛错→清理半注册项→钉死版本回 legacy→上报 fallback 遥测
5. 手动覆盖：`cline.rollout.bundleOverride` 或环境变量 `CLINE_BUNDLE_OVERRIDE`；union manifest 中 views/configuration/walkthroughs 必须两分支一致否则 stitch 失败
6. Nightly 渠道以 `saoudrizwan.cline-nightly` 发布同一组合包（nightlify.mjs 重写命名空间）；next 达 100% 后退役 loader

**scripts/**：stitch.mjs（合并）、gen-manifest.mjs、nightlify.mjs、set-version.mjs（组合版本须高于两分支历史，4.1.0 起）、smoke-loader.mjs。

## 4. 观察

1. cline-hub 与 examples 均为轻量演示性质，测试覆盖薄弱（合计 8 个测试文件）。
2. vscode-rollout 设计成熟（崩溃自愈/回滚开关/manifest 校验），是 SDK 迁移落地的关键安全网。
3. 三者共同点：全部复用 workspace 共享包，验证"一核多宿主"架构的一致性策略。
