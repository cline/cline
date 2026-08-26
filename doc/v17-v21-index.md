# V11–V21 性能攻坚系列 · 提交追溯索引

> 创建日期：2026-08-26 · 由全库扫描（doc/scan/06）发现的追溯缺口 R6 触发
> 目的：将 doc/ 报告编号与 git 提交一一对应；对无提交记录的编号显式标注缺口。

## 1. 版本链 → 提交映射（git 取证结果）

| 版本 | 报告文件 | 对应提交 | 状态 |
|---|---|---|---|
| V11 | `doc/v11-tool-extraction-summary.md` | ToolUseRow 提取（早于下列窗口） | ✅ 有报告 |
| V12 | `doc/v12-optimization-plan.md` / `-report.md` | `c17ce46ef` docs、`e62c5fe8a`/`59b0b69c5`/`24d635f91`/`6a2c44557` perf(chat) 系列 | ✅ |
| V13 | `doc/v13-final-report.md` | `8420664fd`/`c17ce46ef` docs 收官 | ✅ |
| V14 | `doc/v14-implementation-report.md` | `c4783ea2e` feat(v14)、`80e7e45e1`/`0efad1c48` docs | ✅ |
| V15 | `doc/v15-implementation-report.md` | 随 `cf245ac78`（V16 文档）提及"V15 tasks wired end-to-end"，独立 feat 提交未见标签 | ⚠️ 无独立标签 |
| V16 | `doc/v16-implementation-report.md` | `3ab12a9dc`…`68d82284b` task1–6、`c3a1cfe98` task7、`cf245ac78` docs | ✅ |
| V17 | `doc/v17-webview-json-blocking-analysis.md` | `83bbbf938` fix(webview): OOB version 门控 + scroll-up 修复 (V17) | ✅ |
| V17a | `doc/v17a-startup-log-analysis.md` | 分析文档，随 `8da42613d` 入库；其初判结论后被 V20 修正 | ✅（含修正注记） |
| V18 | —（无独立报告） | `5a6862d5a` feat(storage): JSONL session-message persistence, full-read + tail-window (V18) | ⚠️ 有提交无报告 |
| V19 | —（无独立报告） | **未找到带标签提交**。v17a 第八节描述其范围："消除超大 JSONL 读取的死循环/句柄耗尽隐患"。V18→V21 提交历史直接相邻，推测加固工作并入 V18 提交或未单独成 commit | ❌ 缺口 |
| V20 | —（无独立报告） | `f1c2068ac` fix(build): stop splitting framer-motion vendor chunk（即 v17a 第九节"chunk 循环依赖"定论的修复），但提交信息未标 V20 | ⚠️ 有修复无标签 |
| V21 | `doc/v21-implementation-report.md` | `6aa7b1b73` feat(compaction): auto-compact 阈值可配置 (V21)、`8316906c0` bump 4.9.9 | ✅ |
| 后续 | （本索引创建时） | `c2fbf6508` refactor、`90b31f389` fix(分页收尾)、`a8d4e781c` chore(checkpoint [R5]) | — |

## 2. 缺口说明与结论

1. **V19 是真实缺口**：既有工作描述（v17a §八）、又有 VSIX 验证记录（v17a 行 212），却无可识别提交。若该工作确实落地，应补一条指向实际 diff 的链接；若是计划未实施，应在 v17a 中标注。
2. **V20 修复存在但未打标**：`f1c2068ac` 即 V20 修复本体，建议后续引用时以该哈希为准。
3. 本索引基于 `git log --reverse 5a6862d5a~1..6aa7b1b73` 仅含两个相邻提交的事实得出"V19 无独立提交"结论；如存在 squash 或 rebase 历史，此结论需复核。

## 3. 维护建议

- 后续攻坚轮次沿用 `(VN)` 提交标签 + 独立报告双轨制（V16 的 task-N 细粒度是最佳实践）。
- 每轮收官时在本索引追加一行，避免再次出现编号断档。
