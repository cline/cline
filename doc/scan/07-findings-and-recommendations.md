# 综合发现与建议（供下一步审阅）

> 扫描日期：2026-08-26 · 汇总自 00–06 各分报告

---

## 1. 架构健康度评估

### 优势
1. **分层清晰**：`shared → llms → agents → core` 依赖方向单一，agents 包仅 3,875 行即完成完整循环，职责纯度高。
2. **一核多宿主**：CLI / VS Code / hub / examples 全部复用 workspace 共享包，无逻辑分叉。
3. **发布工程成熟**：vscode-rollout 的 A/B 灰度方案具备崩溃自愈、紧急回滚开关、manifest 一致性校验；CLI 多平台二进制分发（7 npm 包）完备。
4. **过程可追溯**：37 篇内部报告形成"诊断→修正→实施→审计"闭环。

### 风险与债务（按优先级）

| # | 级别 | 发现 | 位置 |
|---|---|---|---|
| R1 | 高 | **评测安全网断档**：冒烟 CI 已移除、夜间 E2E 未建，恰逢 SDK 迁移 + 灰度切换关键期 | evals/README |
| R2 | 高 | **复杂度集中**：core 占 SDK 64%（13 万行），extensions/hub/services/runtime 四大目录耦合面大；apps/vscode 单体 32 万行手写代码 | sdk/packages/core、apps/vscode |
| R3 | 中 | **测试框架四套并存**（Mocha/Vitest/Bun/Playwright）+ tui-test，维护成本高 | apps/vscode、apps/cli |
| R4 | 中 | **环境门槛**：CLI 依赖 Zig 编译 OpenTUI 原生层，缺 Zig 则 bun install 失败，阻碍新贡献者 | apps/cli/DEVELOPMENT.md |
| R5 | 中 | **未提交变更悬置**：SdkController.ts、ChatView.tsx、.vscodeignore 有修改未提交，且 doc/v21 报告同被改动——需确认是否对应最新两条 fix 提交的收尾 | git status |
| R6 | 低 | **文档滞后**：evals README 场景计数 5 vs 实际 8；doc/ 缺 V18–V20 独立报告（仅有提交记录）；v17a 根因结论曾被 V20 推翻，阅读时需注意时序 | evals/、doc/ |
| R7 | 低 | **技术栈碎片**：evals 根包仍用 TS 4.9 + ts-node，与主线 Bun/Vitest/TS5.9 割裂；CHANGELOG 大版本 4.0.0 与扩展 package.json 4.9.9 的版本语义需澄清 | evals/package.json |
| R8 | 低 | **示例无测试**：examples 合计仅 1 个测试文件（multi-agent 为 0） | apps/examples |

## 2. 与近期工作线的关联

- git log 近期提交（V17/V18/V21、framer-motion chunk 修复、消息历史分页）与 doc/ V11–V21 报告完全对应，说明 doc/ 是活跃维护的工作日志而非归档。
- 当前工作区状态显示 SDK 迁移仍在推进中（SdkController.ts 修改中）；rollout loader 尚未退役，即 next bundle 未达 100%。
- `.clinerules/sdk-migration.md` 与 `standalone/cline-core.ts` 表明 VS Code 扩展向 core 迁移是既定路线，R2 的复杂度问题部分依赖该迁移化解。

## 3. 下一步审阅建议清单

1. **审阅 R1**：确认评测迁移（到 apps/cli SDK CLI）的时间表；建议在灰度放量前恢复最小冒烟 CI。
2. **审阅 R5**：检查工作区未提交变更是否应随 `90b31f389` 一并提交或回滚。
3. **审阅 R6**：补齐 V18–V20 报告或在其位置放置指针文档；更新 evals README 计数。
4. **审阅 API 面**：core 的 975 行 barrel 导出面很大（含 telemetry/posthog 子路径），0.0.x 阶段宜收敛公共 API 再放大版本。
5. **审阅双扩展过渡**：legacy-extension 分支与 next bundle 的 manifest 一致性约束（views/configuration/walkthroughs 必须一致否则 stitch 失败）是否有 CI 强制。
6. **可选**：统一测试框架策略（建议以 Vitest 为主轴）；为 examples/vscode 补充关键 RPC 链路测试。

## 4. 本轮扫描产物索引

```
doc/scan/
├── README.md                          ← 本系列导航
├── 00-project-overview.md             总览
├── 01-sdk-packages.md                 SDK 六包
├── 02-apps-vscode.md                  主力 VS Code 扩展
├── 03-apps-cli.md                     CLI
├── 04-apps-hub-examples-rollout.md    hub / examples / rollout
├── 05-evals.md                        评测基础设施
├── 06-docs-inventory.md               文档盘点（37 篇内部 + 4 篇官方）
└── 07-findings-and-recommendations.md 本文件
```
