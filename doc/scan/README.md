# 项目全库扫描报告集（2026-08-26）

本目录为对 Cline monorepo 的完整扫描产物，按模块拆分为 8 份报告，供下一步审阅使用。

## 报告索引

| # | 文件 | 内容 | 
|---|---|---|
| 00 | [00-project-overview.md](./00-project-overview.md) | 项目定位、monorepo 结构、技术栈、全库规模汇总（≈66 万行）、版本状态、关键结论速览 |
| 01 | [01-sdk-packages.md](./01-sdk-packages.md) | sdk/ 六包：shared→llms→agents→core 分层架构、各包 API 面与职责、规模对比 |
| 02 | [02-apps-vscode.md](./02-apps-vscode.md) | 主力 VS Code 扩展 claude-dev v4.9.9：贡献点、依赖、源码结构、四套测试体系、SDK 迁移现状 |
| 03 | [03-apps-cli.md](./03-apps-cli.md) | CLI v3.0.44：五种运行模式、OpenTUI TUI、连接器、多平台二进制分发 |
| 04 | [04-apps-hub-examples-rollout.md](./04-apps-hub-examples-rollout.md) | cline-hub 仪表盘、examples 示例集、vscode-rollout A/B 灰度发布机制 |
| 05 | [05-evals.md](./05-evals.md) | 三层评测金字塔、8 个冒烟场景、cline-bench 12 任务、当前 CI 断档状态 |
| 06 | [06-docs-inventory.md](./06-docs-inventory.md) | doc/(V11–V21 性能攻坚) 与 docs/(重构 v3–v9 审计链) 共 37 篇内部文档盘点 + 根级官方文档 + .clinerules |
| 07 | [07-findings-and-recommendations.md](./07-findings-and-recommendations.md) | 架构健康度评估、8 项风险债务（R1–R8）、下一步审阅建议清单 |

## 快速入口

- 只看结论 → `07-findings-and-recommendations.md`
- 了解整体 → `00-project-overview.md`
- 按模块深审 → 对应分报告
- 修复落地情况 → [../remediation-log-2026-08-26.md](../remediation-log-2026-08-26.md)（R1/R4/R5/R6/R8 已实施，含逐项回退命令）

## 扫描方法说明

- 结构与规模统计排除 node_modules/dist/build/out 及 gRPC 生成代码（apps/vscode/generated 另行标注）
- 行数为 .ts/.tsx 物理行数近似值
- 模块细节由并行探索代理采集，交叉核对自 package.json / README / git log
