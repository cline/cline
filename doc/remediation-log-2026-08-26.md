# 修复实施日志（Remediation Log）· 2026-08-26

> 依据：`doc/scan/00–07` 全库扫描报告（2026-08-26）
> 分支：`scan-remediation/2026-08-26`（基于 main @ `90b31f389`）
> 原则：每项修复独立成 commit、消息内标注风险编号 [R#]、可单独 `git revert`；本文件是全部变更的追溯清单。

## 1. 提交清单与回退方式

| # | Commit | 风险项 | 类型 | 内容 | 单独回退命令 |
|---|---|---|---|---|---|
| 1 | `a8d4e781c` | R5 | chore | WIP 检查点：SdkController currentTaskItem 合成回退、ChatView task 派生修复（分页回弹根因）、vscodeignore 排除调试产物、v21 报告补记 | `git revert a8d4e781c` |
| 2 | `1c114e83a` | R6 | docs | evals README/ARCHITECTURE 场景计数 5→8 并列举 06–08 用途；新增 `doc/v17-v21-index.md` 提交追溯索引（显式标注 V19 无提交缺口、V20=`f1c2068ac`） | `git revert 1c114e83a` |
| 3 | `ce735956e` | R6 | chore | 删除已跟踪但零引用的调试残留 `tmp-msg-handler.ts`（461 行）；ToolUseRow.vsix 本就 gitignore，保持本地 | `git revert ce735956e` |
| 4 | `86c343e51` | R1 | ci | 新增 `.github/workflows/cline-evals-smoke.yml`：手动 dispatch 冒烟回归（模型/场景/次数可参数化，CLINE_API_KEY 密钥守卫，结果 artifact 上传）；evals README CI 章节同步登记 | `git revert 86c343e51` |
| 5 | `d58e9f019` + `f1823d391` | R8 | test | multi-agent 示例：`server.listen` 加 `import.meta.main` 守卫（导入不再绑端口）、导出 AGENT_ROLES/createAgentConfig、新增 bun:test 3 用例、package.json 增加 test/typecheck 脚本 | 分别 revert 两个 sha |
| 6 | `06925d0b8` | R4 | docs | CLI DEVELOPMENT.md 增加 OpenTUI/Zig 安装失败排查节（症状识别、恢复步骤、SDK-only 逃生通道） | `git revert 06925d0b8` |
| 7 | （本提交） | 全部 | docs | 本日志 + scan 索引指针更新 | `git revert <sha>` |

## 2. 验证记录

| 验证项 | 命令 | 结果 |
|---|---|---|
| multi-agent 测试 | `bun test`（apps/examples/multi-agent） | ✅ 3 pass / 0 fail |
| multi-agent 类型 | `tsc --noEmit` | ✅ exit 0 |
| Biome 检查 | `bun biome check apps/examples/multi-agent/src/` | ✅ 无错误 |
| 提交钩子 | husky(gitleaks) × 7 次提交 | ✅ no leaks found |
| 全库类型检查 | `bun run types` | 见下方"最终验证" |

**未验证/需线上验证项**：
- `cline-evals-smoke.yml` 仅做了语法与契约核对（运行器 env 变量名、`which cline` 平台限制→限定 ubuntu），未实际触发 dispatch（需仓库配置 `CLINE_API_KEY` secret）。建议首次手动触发一次小规模验证（trials=1，scenario=01-create-file）。

## 3. 遗留项路线图（本次刻意不做，防止不可控大改）

| 项 | 为何推迟 | 建议路径 |
|---|---|---|
| R2 复杂度集中（core 13 万行 / vscode 32 万行） | 架构级重构，无法以可回退的小提交安全完成 | 沿 `.clinerules/sdk-migration.md` 既定迁移推进；每季度用 knip/depcruise 度量耦合面；vscode-rollout 灰度达 100% 后退役 legacy bundle |
| R3 测试框架四套并存 | 迁移 225+ 测试文件影响面过大 | 以 Vitest 为主轴，按 app 分期：先 webview-ui(48) → vscode src Mocha(177) → 收编 Bun test；Playwright/tui-test 因领域特殊性保留 |
| R7 evals 技术栈陈旧（TS4.9+ts-node） | 升级将重写 evals/package-lock.json，churn 大且需完整冒烟回归护航 | 与 R1 工作流首跑合并为独立 PR：升级 typescript@5.x、ts-node→tsx、对齐根工作区脚本 |
| R8 其余示例（examples/vscode 等） | 现有 98 文件仅 1 测试，补测应聚焦 RPC 链路 | 为 StartRuntimeSession/SendRuntimeSession/AbortRuntimeSession 增加集成测试后再扩展 |
| V19 缺口核实 | 需要历史仓库考古（可能 squash 于 V18 提交） | 在 v17a 第八节补充指向实际 diff 的链接或"未落地"结论（见 `doc/v17-v21-index.md` §2） |

## 4. 回退策略总览

- **单项回退**：上表逐条 `git revert <sha>`——各 commit 无交叉文件依赖（唯一交叠是 evals/README.md 被 commit 2 与 4 先后修改，若需回退 commit 2 请连同 4 一并 revert 或手工保留 CI 段落）。
- **整体回退**：`git checkout main && git branch -D scan-remediation/2026-08-26`（未合并前零影响）。
- **合并后回退**：按 commit 逐个 revert，或 `git revert --mainline 1 -m 1 <merge-sha>` 整体撤销。
