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

---

# 第二阶段（同日续）：架构稳定前提下的深化修复

> 约束：不做任何跨模块结构改动；每步均有验证门；R2/R3 仍按路线图推迟。

## Phase-2 提交清单

| # | Commit | 风险项 | 类型 | 内容 | 验证 |
|---|---|---|---|---|---|
| P2-1 | `31493f765` | R7 | build | **evals 工具链现代化**：裁剪 4 个零使用依赖（better-sqlite3 原生模块/tiktoken/chalk/commander）+ ts-node → 仅留 dotenv；TS ^4.9.4→^5.9.3、@types/node→^25.3.5、加 tsx devDep；锁文件重生成（净 -277 行）；替换断链 tsconfig（根目录无 tsconfig.json，旧 extends 形同虚设）为独立配置（ES2022+bundler）；顺带修复暴露的 harbor 指标命名契约断裂（camelCase→snake_case 适配器，smoke-runner 输出格式不变）；工作流同步（analysis npm ci + tsc 门 + 本地 tsx） | `tsc --noEmit` exit 0；runner 于 tsx 下完整加载至 CLI 守卫早退；js-yaml 解析 workflow exit 0 |
| P2-2 | （本提交） | R6 | docs | V19 缺口结案：逐文件 `--follow` 取证证实 V19 加固 squash 进 V18 提交 `5a6862d5a`（session-messages-jsonl.ts 648 行仅存于该提交，含 VSIX 标记 subarray）；v17-v21-index 对应行更新 | git log --all --follow 取证记录 |

## Phase-2 关键发现

1. **evals/tsconfig.json 此前 extends 不存在的根 tsconfig**——所有历史类型检查对该目录实际无效。本次独立配置后首次获得真实类型门禁，并立即捕获 harbor 的指标契约 bug（若未修，未来 analysis JSON 报告的 metrics 字段将静默错位）。
2. **V19 结案**消除了"存在丢失工作"的担忧——是标签缺失而非代码缺失。
3. better-sqlite3 从 evals 依赖树移除后，CI 安装不再触发原生编译，冒烟工作流的失败面显著缩小。

## Phase-2 后剩余项（不变）

- R2/R3/R8-examples-vscode：维持第一阶段路线图。
- 冒烟工作流首跑仍待仓库 secret `CLINE_API_KEY` 配置后人工触发。

## 最终验证（P2-2 之后补记）

| 验证项 | 命令 | 结果 |
|---|---|---|
| 全库类型检查 | `bun run types`（= `bun --parallel -F '*' typecheck`） | ✅ 15 个包的 typecheck 任务全部通过（core/cli/vscode/rollout/sdk/shared/llms/agents/ui/code/hub/menubar/plugin/examples×2），exit 0 |

至此 §2 验证表中悬置引用的"最终验证"闭合：两阶段全部提交在最终代码状态下均通过类型门禁。

---

# 第三阶段（同日再续）：R8 收官与新发现 R9

> 约束不变：小提交、可单独回退、每步验证门。本轮以"测试安全网"为主线推进 R8 路线图项，过程中发现并登记新风险 R9。

## Phase-3 提交清单

| # | Commit | 风险项 | 类型 | 内容 | 验证 |
|---|---|---|---|---|---|
| P3-1 | `c23aa38e4` | R8 | test | **examples/vscode RPC 链路端到端测试**：进程内启动真实 hub WebSocket server（临时 discovery 文件 + 端口 0）+ 桩 RuntimeHost，覆盖扩展实际依赖的 `ClineCore backendMode=hub` 全链路——HubSessionClient startRuntimeSession→`session.create` / sendRuntimeSession→`session.send_input` / abortRuntimeSession→`run.abort` + getSession 与广播事件观测（session.created/run.started/run.completed）；HubRuntimeHost startSession/runTurn/abort 含 manifest 断言。新增 vitest.config.ts 与 test 脚本 | vitest 3/3 ×2；tsc exit 0 |
| P3-2 | `180eab591` | R9 | fix | **MCP stdio spawn win32 引号缺陷**：shell:true 下 Node 不加引号拼接命令，含空格的可执行路径（如 `C:\Program Files\nodejs\node.exe`）被 cmd 截断导致 MCP server 无法启动。仅对含空白片段加引号 | runtime-builder MCP 集成用例于 Windows 由红转绿；core 全量单测 1395 pass/0 fail |
| P3-3 | `4b398b139` | R9 | test | legacy bash 回退与 AgentExtension 两用例依赖 POSIX shell，win32 永远失败；`it.skipIf(win32)` 平台门控 | 同上（1395 pass / 7 skip / 0 fail） |
| P3-4 | `52d21f38f` | R9 | build | 重型套件预算放宽：core/llms/cli vitest 配置 testTimeout/hookTimeout→30s（基线取证：原始聚合集在并行下即产生 5s 假超时；cli main.test 在九套件并行下连自设的 15s 也超出） | 多轮全量运行零超时级失败 |
| P3-5 | `0bbb36e50` | R8+R9 | test | **desktop-app 测试收编**：16 个 vitest 文件此前无通用 test 脚本、从未被任何门禁执行且已腐烂（sidecar 能力两用例必败：单测内冷加载整个 @cline/core 图超出默认 5s）。动态导入提升至 beforeAll + 单文件预算 60s + 补 `test` 脚本 | `bun run test` ×2 → 16 files/59 tests 全绿 |
| P3-6 | （本提交） | R6/R9 | docs | 本节 | — |

## Phase-3 关键发现（新登记 R9）

1. **根聚合脚本 `bun run test` 三重缺陷（维持原样未动，留作路线图）**：
   - `--parallel` 同时冷启动 9 套件互相饿死——基线取证显示**原始集合本身就红**（llms gateway 5s 假超时随机出现），非本轮引入；
   - sdk 包的 `test` 脚本含 e2e 变体（core 为 `test:unit && test:e2e`），聚合器语义不可控；
   - 覆盖缺口：webview-ui(48 文件/376 测试)、desktop-app(16)、examples/vscode(3)、multi-agent、rollout 均不在聚合范围。
   - 建议路径：聚合器重构为 unit-only 过滤 + 受控并行度/分组串行，先纳入已验证全绿的 webview-ui。
2. **Windows 平台缺口两处**：MCP spawn 引号 bug 已修（P3-2）；legacy bash hooks 产品层无 win32 支持待产品决策（P3-3 仅门控测试）。
3. **未被门禁执行的套件必然腐烂**：desktop-app 即实例（P3-5）；webview-ui 独立运行仅 ~37s 且全绿，是聚合器重构时最安全的首批收编对象。

## Phase-3 后剩余项

- R2/R3 大迁移路线图不变（webview-ui 实际已是 Vitest，R3 真正碎片在 apps/vscode/src 的 Mocha24/bun66/Vitest82 三套并存，影响面大仍推迟）。
- R8-examples-vscode **本轮收官**（98 文件从 1 个测试增至覆盖核心 RPC 链路的 3 个集成用例）。
- 新增路线图：根聚合器重构（见上）、legacy bash hooks 的 win32 产品策略、冒烟工作流首跑仍待 secret。

## Phase-3 验证记录汇总

| 验证项 | 结果 |
|---|---|
| examples/vscode `bun run test` | ✅ 3/3 ×2 次 |
| desktop-app `bun run test` | ✅ 59/59 ×2 次 + 并行大跑 1 次 |
| core `test:unit` 全量（含 MCP 修复后） | ✅ 1395 pass / 7 平台跳过 / 0 fail（41.7s） |
| llms/cli/webview-ui/hub 等（并行大跑） | ✅ 无超时类失败残留 |
| biome lint（全部改动文件） | ✅ 无新增告警（输出均为 apps/cli 存量 warning） |
| gitleaks 提交钩子 | ✅ 全部通过 |

---

# 第四阶段：聚合器取证与增量收编

> 前置发现改变了第三阶段的路线图判断：`.github/workflows/sdk-test.yml` 在 ubuntu 上执行的就是根 `bun run test`（Windows 矩阵仅跑 sdk glob）——该脚本是 **CI 载体**，不能按原计划直接重构。

## Phase-4 提交清单

| # | Commit | 风险项 | 类型 | 内容 | 验证 |
|---|---|---|---|---|---|
| P4-1 | `1c3a21b8f` | R9 | build | 新增 `test:extended` 确定性入口（显式 `&&` 串行链）：webview-ui → desktop-app → multi-agent → rollout → examples/vscode；desktop-app vitest 预算对齐 P3-4。默认 `test` 一字未动 | `test:extended` 端到端全绿 ×2（合计 477 用例）；desktop-app 单独 59/59 |
| P4-2 | （本提交） | R6/R9 | docs | 本节 | — |

## Phase-4 取证结论（R9 扩充）

1. **CI 载体约束**：根 `test` 被 sdk-test.yml 消费 → 覆盖缺口改用增量入口解决，CI 语义零变更。
2. **bun 多过滤器仍有并发重叠**：`bun -F a -F b ... test` 不加 `--parallel` 也非严格串行——五套件并发下 desktop-app 冷导入可超 60s hook 预算（同代码单独运行仅 18s）。显式 `&&` 链是唯一构造性串行方案。
3. **cli 测试套件存在 Windows 平台债（登记，未修）**：`/tmp/cline-worktree` POSIX 路径、plugin.test npm 安装 5 例失败、doctor 进程枚举失败，且队列中存在未定位的硬挂起点（二分定位到 doctor 之后）。复现：`cd apps/cli && bun run test:unit`。这些是 POSIx 导向的存量用例，需按 P3-3 模式逐个平台门控或产品适配。
4. **本机负载数据**：同一提交状态下各套件耗时随整机负载波动可达 2-5 倍（webview-ui 37s→175s），并行聚合在本机永远不可靠；**单独运行是本机上唯一可信的门禁信号**，所有已提交修复均以单独运行验证。

## Phase-4 后剩余项

- cli Windows 平台债清单化与门控（P4 取证 #3）。
- 默认 `test` 的覆盖缺口维持现状（CI ubuntu 上语义不变）；若维护者愿意，可将 `test:extended` 并入 sdk-test.yml 或独立 workflow。
- R2/R3 大迁移、bash hooks win32 产品策略、冒烟工作流首跑：不变。
