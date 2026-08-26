# evals/ 扫描报告 —— 评测基础设施

> 扫描日期：2026-08-26 · 路径：`evals/`（medium 级别扫描）

---

## 1. 三层评测金字塔

| 层级 | 位置 | 耗时 | 内容 |
|---|---|---|---|
| Layer 1 契约测试 | `src/core/api/transform/__tests__/`（apps/vscode 内） | 秒级 | 无 LLM 调用：thinking trace、tool call 解析、provider 格式转换；另有 52 个系统提示快照测试 |
| Layer 2 冒烟测试 | `evals/smoke-tests/` | 分钟级 | 精选场景 × 模型 × 3 trials，计算 pass@k |
| Layer 3 E2E | `evals/e2e/` + `evals/cline-bench/` | 小时级 | 生产级编码任务，Docker/Daytona 经 Harbor 执行，夜间 CI |

**指标体系**：pass@k（至少一次成功）、pass^k（全部成功）、Flakiness（通过率熵）；3 次试验 → 全过=pass / 全败=fail / 混合=flaky。

## 2. 当前状态（重要）

- **冒烟测试部分禁用**：评测框架正迁移到新的 SDK CLI（apps/cli）；场景文件保留，运行器仍可用
- 旧自动回归工作流 `.github/workflows/cline-evals-regression.yml` 已移除
- PR 门禁仅跑契约测试；夜间 E2E CI 尚未实现（README 明示 TODO）
- TODO 还有：原生工具调用冒烟测试（`native_tool_call_enabled` 支持 Claude 4 native tools）
- 默认测试模型：claude-sonnet-4 / gpt-4o / gemini-2.5-pro（经 Cline provider 路由，用 `cline auth` 凭证）

## 3. 目录结构与代码

| 目录 | 用途 |
|---|---|
| `smoke-tests/` | 主运行器 run-smoke-tests.ts + scenarios/ |
| `e2e/` | run-cline-bench.ts（Harbor 运行器包装） |
| `cline-bench/` | **git 子模块**，SWE-bench 风格真实任务集 |
| `analysis/` | 独立包 `@cline/analysis`：metrics/classifier/cli/parsers(harbor)/reporters(md+json)/schemas/patterns(失败模式 YAML) |
| `benchmarks/` | 已弃用，仅剩 tool-precision/DEPRECATED.md |

代码规模：仅 **15 个 .ts 文件**（smoke 1 + e2e 1 + analysis 13），轻量编排型目录。
依赖：evals 根包（cline-evals v2.0.0）用 better-sqlite3/chalk/commander/dotenv/tiktoken + ts-node + TS 4.9（较旧）；analysis 包 ESM + tsx + vitest + TS 5。

## 4. 冒烟场景（8 个，文档写 5 个——滞后）

01-create-file、02-edit-file、03-read-summarize、04-multi-file、05-typescript-function、06-apply-patch、07-edit-gemini、08-openai-compat-gpt-oss-edit。
每场景含 config.json（prompt、期望文件/内容），可选 template/ 与 workspace/。06–08 为特定模型/provider 能力扩展场景。

## 5. cline-bench 任务集（12 个）

真实用户会话提炼的生产级 bug 修复任务，任务命名 `<ULID>-<slug>`，每任务标准结构：
- instruction.md（agent 输入）、task.toml（Harbor 配置）
- environment/Dockerfile（初始损坏状态容器）
- solution/solve.sh（Oracle 参考答案）
- tests/（pytest 验证套件）

执行：Harbor 框架（Python 3.13 + uv + Docker 本地 / Daytona 云端），模型格式 `provider:model-id`，适配器 `-a cline-cli` 或 `-a oracle`。

## 6. 观察

1. **评测是当前最薄弱环节**：Layer 2 CI 断档、Layer 3 夜间 CI 未建——在 SDK 迁移与 A/B 灰度并行的关键期，缺少回归安全网。
2. 文档计数滞后于实际（5 vs 8 场景），建议随迁移一并更新。
3. evals 根包技术栈陈旧（TS 4.9 + ts-node），与 monorepo 主线（Bun/Vitest/TS 5.9）割裂。
