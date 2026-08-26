# 文档盘点报告（doc/ + docs/ + 根级文档）

> 扫描日期：2026-08-26 · 范围：doc/ 10 篇、docs/ 24+3 篇、根级 4 篇、.clinerules/

---

## 1. 两套内部文档体系的演进脉络

所有内部技术报告均为中文，版本编号在两个目录间**连续**：

```
docs/（2026/7/16–7/27）                      doc/（2026/8/3–8/4）
├─ 领域专项分析 v1/v2 对：                    ├─ docs/reports/v10–v11 分析的落地：
│  concurrency / deep-analysis /             │  v11 ToolUseRow 提取
│  logging / webview / network / io          │  v12 六项优化 plan+report
├─ 重构迭代审计链 v3→v9：                     │  v13 收官 → v14 设置治理
│  每篇审计上篇"宣称 vs 实际"                  │  v15 分页修复 → v16 全量接线
│  （v7 报 71%，v8 复核降为 61%）              │  v17/v17a JSON 阻塞与启动崩溃分析
└─ 专题调查：plan-act / settings-menu /       └─ v21 分页回弹/计费显示/Auto Compact 配置
   terminal-proliferation / plugin-view-rescale
```

## 2. doc/ 清单（10 篇）—— 性能攻坚 V11–V21 系列

| 文件 | 主题 | 行数 | 修改时间 |
|---|---|---:|---|
| v11-tool-extraction-summary.md | ChatRow 14 种工具渲染提取为 ToolUseRow | 67 | 8/3 |
| v12-optimization-plan.md | 三大症状（滚动延迟/卡死 CPU>90%/内存增长）六项方案 | 170 | 8/3 |
| v12-optimization-report.md | V12 六方案实施结果 | 119 | 8/3 |
| v13-final-report.md | V11/V12 收官跟踪 | 102 | 8/3 |
| v14-implementation-report.md | 设置治理/成本优化/Windows 基准；核对 V13 七个盲点 | 131 | 8/3 |
| v15-implementation-report.md | 对话历史分页锁定修复 | 125 | 8/3 |
| v16-implementation-report.md | 全量接线/Prompt Caching/消息队列 Steer | 233 | 8/3 |
| v17-webview-json-blocking-analysis.md | JSON 序列化/reducer O(N²) 同步阻塞主线程结论 | 191 | 8/3 |
| v17a-startup-log-analysis.md | 启动崩溃排查（V20 修正根因：vendor-motion chunk 循环依赖） | 287 | 8/4 |
| v21-implementation-report.md | 分页回弹/$0.00 计费根因/Auto Compact 可配置(50–100%)/CI 双平台 | 259 | 8/4 |

注：V18–V20 无独立报告文件，但 git log 显示对应提交存在（`5a6862d5a feat(storage): JSONL session-message persistence (V18)` 等）。

## 3. docs/ 清单（顶层 24 篇）

### 领域专项分析（v1 + v2 成对）
| 文件 | 行数 | 要点 |
|---|---:|---|
| concurrency-report.md / -v2 | 757/595 | v1 列 11 个关键设计失误；v2 按 Node 最佳实践做低侵入方向修正 |
| deep-analysis.md / -v2 | 522/892 | 长上下文性能陷阱、网络架构缺陷、内存泄漏三域深挖 |
| logging-report.md / -v2 | 518/540 | 日志体系缺口；v2 改为最大化利用 VS Code 原生 API |
| webview-analysis.md / -v2 | 433/477 | Webview 重开加载失败根因；v2 标注已修/剩余风险 |
| io-report.md | 520 | 文件系统与存储 I/O 全景 |
| network-report.md | 686 | 网络操作与工具链全景 |

### 重构迭代审计链（v3→v9）
refactoring-v3(180)/v4(200)/v4.1(215)/v5(211)/v6(319)/v7(203)/v8(302)/v9(285)。
特征：每篇对照上一版做"宣称 vs 实际"偏差审查；v4.1 引入跨平台(Windows)修订；v9 为 Plan/Act 全链路专项。

### 专题调查
plan-act-mode-report(833)、settings-menu-report(284)、terminal-proliferation-report(211)、plugin-view-switch-rescale-analysis(276)、webview-rendering-performance-report(209)、message-queue-implementation(616)。

### docs/reports/ 子目录（3 篇，Code Review AI 出品）
v10-compaction-hardcoded-analysis(226)、v10-view-switch-analysis(226)、v11-long-conversation-performance-analysis(343)——衔接 doc/ 系列源头。

## 4. 根级官方文档（英文）

| 文件 | 要点 |
|---|---|
| CONTRIBUTING.md (209 行) | 功能贡献须先开 Issue 获批；本地开发流程（git-lfs/bun/protobuf/F5 调试） |
| SECURITY.md (25 行) | 仅修补最新 minor；漏洞经 Bugcrowd 私下披露，备选 security@cline.bot |
| CODE_OF_CONDUCT.md (76 行) | 标准 Contributor Covenant |
| CHANGELOG.md (2395 行) | 当前 4.0.0：扩展迁移共享 SDK 会话层、ClinePass 订阅、Customize 市场（Skills/MCP/Plugins）、消息队列、providers.json 通用化等 |

## 5. .clinerules/ —— AI 助手仓库规则集

**根级 8 规则**：general.md（12.7KB 部落知识踩坑库）、cline-overview.md（27.2KB 架构总览）、bun-and-node.md（Bun 管包/Node 运行分工）、debug-harness.md（HTTP 控制调试器）、network.md（扩展端禁全局 fetch 与默认 axios）、protobuf-development.md（gRPC 端点开发流程）、sdk-migration.md（src/sdk 适配层说明）、storage.md（~/.cline/data 文件型 JSON 存储，三宿主共用）。

**hooks/**：README.md（13.8KB hooks 机制文档）。
**workflows/**（7 个）：address-pr-comments、find-pr-reviewers、git-branch-analysis、hotfix-release、pr-review、release、writing-documentation(21.8KB 技术写作规范)。

## 6. 观察

1. **语言/受众错位**：中文内部报告（37 篇）vs 英文官方社区文档并存；doc/+docs/ 是本地研究/改造产物，非上游内容。
2. **方法论一致**："诊断报告 → v2 方向修正 → 实施报告 → 下篇审计上篇兑现度"，形成可追溯闭环；但 v7(71%)→v8(61%) 的复核降级说明早期完成度声明偏乐观。
3. **编号断档**：doc/ 缺 V18–V20 独立报告（仅有 git 提交），审阅时需结合 CHANGELOG 与 git log 补齐。
4. **evals 文档滞后**：README 称 5 个冒烟场景，实际磁盘 8 个。
