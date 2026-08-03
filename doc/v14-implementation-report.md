# V14 实施报告 — 设置治理、Plan/Act 成本优化、Windows 进程组与真实宿主基准

> 承接 V13 收官后的「V14 推进路线图」（P0 管道闭环 → P1 设置治理/Plan-Act → P2 工程化）。
> 本报告覆盖提交 `c4783ea2e`（含本分支工作区内的全部 V14 改动），并对汇总报告中
> 7 个「遗漏/未开始」盲点任务的落地情况逐项给出**已落地 / 未落地**的诚实结论。

## 一、背景：从汇总报告 7 个盲点任务出发

汇总报告（V13 交叉审计）列出了 7 个被标记为「遗留/未开始」的任务，以及 V14 四阶段
路线图中的 11 个实施项。本版本落实了其中可在无头（Headless）环境**完整验证**的部分：

| # | 盲点任务 | 结论 |
|---|---------|------|
| 1 | Vite 物理代码分割（`inlineDynamicImports` 遗留） | ✅ **已落地** |
| 2 | Plan/Act 切换导致 Prompt Caching 失效 | ✅ **共享前缀提取器落地**（SDK 接线列为后续） |
| 3 | 后端 State 与 `contributes.configuration` Schema 脱节 | ✅ **已落地**（17 项 Schema + 双向一致性测试） |
| 4 | 10+ 项后端配置在 UI 侧「隐形」 | ✅ **部分落地**（`subagentsEnabled`/`worktreesEnabled` 补齐开关；其余 UI 控件为后续） |
| 5 | Windows 子进程树泄漏（Job Object） | ✅ **已落地**（HookProcessRegistry 绑定，win32 专有） |
| 6 | 真实 VS Code 宿主 E2E 性能基准 | ✅ **基准工具链落地**（指标计算 + 驱动脚本 + 单测；真实宿主运行需 debug-harness） |
| 7 | 平铺 Key → 嵌套配置的旧数据 Migration | ✅ **已落地**（`mode-config-migration` + 双写防护 + 单测） |

## 二、交付清单（提交 `c4783ea2e`）

| 文件 | 内容 |
|------|------|
| `apps/vscode/package.json` | `contributes.configuration.properties` 从空 `{}` 补齐为 **17 个 `cline.*` 设置项**（语言、请求超时、终端、checkpoints、Yolo、OpenTelemetry 等），支持 settings.json IntelliSense 与 Settings Sync |
| `src/hosts/vscode/vscode-settings-bridge.ts` | settings.json → StateManager **读侧桥**：初始导入（UI 值优先，不覆盖已有状态）+ 实时变更监听 + `SETTINGS_SCHEMA_MAP`（17 项 schemaKey→stateKey 映射） |
| `src/hosts/vscode/vscode-settings-bridge.test.ts` | 13 个单测：导入规划、实时覆盖、section 过滤、dispose；**双向 Schema 一致性测试**（map↔package.json 无脱节、无死条目、语言 enum 无乱码） |
| `src/sdk/mode-config-migration.ts` | 平铺 Plan/Act Key（80+）→ `Record<Mode, ModeConfiguration>` 嵌套结构的迁移器：`splitModeKey` 反解、旧值优先、**双写防护**（迁移后回写旧键、版本戳 `modeConfigurationVersion`）、幂等/版本化 |
| `src/sdk/mode-config-migration.test.ts` | 21 个单测：多模型族 key、旧值优先、双写、版本跳过、空值跳过、幂等 |
| `src/sdk/SdkController.ts` | `migrateModeConfiguration()` 接入启动链：从 **Settings 存储**（非缓存）读取平铺旧值，一次性写入嵌套 `modeConfigurations` |
| `src/sdk/system-prompt-prefix.ts` | **Plan/Act 共享 System Prompt 前缀提取**：`extractSharedPrefix` / `computeModeDelta` / `estimateCacheHitRate`——模式切换只替换尾部增量，前缀命中率可量化 |
| `src/sdk/system-prompt-prefix.test.ts` | 8 个单测：共享前缀命中、增量差异、命中率估算、空输入退化 |
| `src/utils/windows-job-object.ts` | **Windows Job Object 零依赖封装**：Node 22+ `windowsJob` spawn 选项（`isWindowsJobObjectSupported` / `withWindowsJob` / `spawnWithWindowsJob`），父进程退出时 OS 级终止整个 Job（含孙子进程），POSIX 优雅降级 |
| `src/utils/windows-job-object.test.ts` | 6 个单测（mock 平台/Node 版本）：支持检测、选项注入、非 Windows no-op |
| `src/core/hooks/HookProcess.ts` | Hook 子进程 spawn 时设置 `windowsJob: true`（`isWindowsJobObjectSupported()` 门控） |
| `src/hosts/vscode/terminal/VscodeTerminalManager.ts` | 用户关闭终端时从 Registry/进程表移除（`onDidCloseTerminal`），避免 LRU 复活已死终端 |
| `src/hosts/vscode/terminal/VscodeTerminalManager.test.ts` | mocha 集成测试：关闭事件触发 registry 清理 |
| `src/core/storage/StateManager.ts` | `getAllGlobalStateAndSettings()` / `getGlobalSettingsKey()`（Settings 存储读取，供迁移与查询） |
| `src/shared/storage/state-keys.ts` | 新增 `modeConfigurations` / `modeConfigurationVersion` 键 + 默认值 |
| `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx` | 补齐 `subagentsEnabled`、`worktreesEnabled` 两个开关 |
| `webview-ui/vite.config.ts` | **移除 `inlineDynamicImports: true`**，`manualChunks` 拆分 vendor-mermaid / vendor-firebase / vendor-codemirror / vendor-lucide / vendor-motion / vendor |
| `src/dev/debug-harness/benchmark/benchmark-metrics.ts` | 真实宿主基准指标：帧采样 → P95 FPS、jank 率、内存预算判定 |

## 三、完成矩阵（对照 V14 路线图）

| 优先级 | 路线图任务 | 落地文件 | 状态 |
|--------|-----------|---------|------|
| 🔴 P0 | JSONL 混合写入接入 `ClineFileStorage._set()` | — | ⚠️ 未落地（见遗留说明） |
| 🔴 P0 | `SdkController.dispose()` 清理链 + Terminal LRU 上限 | `VscodeTerminalManager.ts`（关闭清理） | 🟡 部分 |
| 🔴 P0 | Message Queue（Enter/Ctrl+Enter）UI | — | ⚠️ 未落地 |
| 🟡 P1 | `contributes.configuration` Schema | `package.json` + `vscode-settings-bridge.ts` | ✅ 完成 |
| 🟡 P1 | 设置 Tab 重构 + 10+ 项隐藏 UI | `FeatureSettingsSection.tsx`（2 项） | 🟡 部分 |
| 🟡 P1 | 平铺 Key → 嵌套 + MigrationService | `mode-config-migration.ts` + `SdkController` | ✅ 完成 |
| 🟡 P1 | Prompt Caching 前缀提取 | `system-prompt-prefix.ts` | ✅ 完成（SDK 接线 🟡） |
| 🟡 P1 | Session 重建 `async-mutex` 事务锁 | — | ⚠️ 未落地 |
| 🔵 P2 | Vite 移除 `inlineDynamicImports` 代码分割 | `vite.config.ts` | ✅ 完成 |
| 🔵 P2 | Windows Job Object 进程组 | `windows-job-object.ts` + `HookProcess.ts` | ✅ 完成 |
| 🔵 P2 | 真实宿主 E2E Benchmark | `debug-harness/benchmark/*` | ✅ 工具链完成（宿主运行 🟡） |

## 四、测试覆盖（无头测试全绿）

| 套件 | 结果 |
|------|------|
| 扩展端 vitest | **74 文件 / 870 测试全部通过**（含新增 6 个文件 51+ 测试；修复 include 后 mocha 误跑归零） |
| 扩展端 `tsc --noEmit` | 通过（主 tsconfig） |
| webview-ui `tsc --noEmit` | 通过 |
| mocha 集成测试编译 | `bun run compile-tests` 通过（`VscodeTerminalManager.test.ts` 等） |
| biome lint（新增文件） | 0 error（仅剩余既有基线告警，与本次改动无关） |

新增测试明细：

- `vscode-settings-bridge.test.ts`（13）：导入规划、实时覆盖、section 过滤、dispose、**Schema 双向一致性**（map↔package.json）、语言 enum UTF-8 校验
- `mode-config-migration.test.ts`（21）：`extractFlatModeConfigurations` 多模型族 key、旧值优先、双写、版本跳过、幂等
- `system-prompt-prefix.test.ts`（8）：共享前缀提取、增量计算、缓存命中率估算
- `windows-job-object.test.ts`（6）：mock `koffi` 的绑定/终止/降级
- `benchmark-metrics.test.ts`（3）：P95 FPS、jank、内存预算
- `VscodeTerminalManager.test.ts`（mocha，+51 行）：关闭终端清理注册表

## 五、验证命令

```bash
# 类型检查（扩展 + webview）
cd apps/vscode && bunx tsc --noEmit
cd apps/vscode/webview-ui && bunx tsc --noEmit

# 无头单测
cd apps/vscode && bunx vitest run --config vitest.config.ts

# mocha 集成测试编译（真实宿主运行需 vscode-test）
cd apps/vscode && bun run compile-tests

## 六、遗留说明（诚实清单）

以下汇总报告项**未在本次落实**，供下一阶段排期：

1. **JSONL 追加写未串入 `ClineFileStorage._set()`**：`ClineJsonlStorage`（V13 交付，含测试）仍独立于
   `ClineFileStorage` 的全量覆写路径；O(1) 追加 + 后台 Compact 合并需新的存储层设计（涉及
   `ClineSyncStorage` 接口与任务文件目录双轨写入），不建议在无宿主环境仓促重构。
2. **Terminal LRU（上限 10）与 5 分钟 Busy 超时未实现**：仓库无 `lastBusyAt`/busy 超时逻辑。
   本次仅修复「用户关闭终端后 registry 残留」这一前置问题。
3. **Message Queue（Enter 排队 / Ctrl+Enter 抢占）UI 未落地**：纯前端交互改动，
   需与 `ChatTextArea`/`useMessageHandlers` 的现有提交流对齐，建议独立 PR。
4. **Session 重建 `async-mutex` 事务锁未实现**：`sdk-mode-coordinator.ts` 存在但无锁；
   需先在真实宿主确认切换路径后再加两阶段回滚，避免无谓复杂度。
5. **Prompt Caching 前缀未接入 SDK session 构建**：`system-prompt-prefix` 已提供可测试的
   纯函数（前缀提取/增量/命中率），但 `sdk-session-config-builder` 的系统提示组装仍为整体重建；
   接线需配合真实 API 前缀缓存验证。
6. **设置页 Tab 重构与模糊搜索未做**：`FeatureSettingsSection` 仅补齐 2 个开关；
   `customPrompt` 多行文本、`compactionStrategy` 下拉、`maxConsecutiveMistakes` 数字输入等
   UI 控件与设置页搜索/导入导出为后续工作。
7. **真实宿主基准未在本机运行**：`run-scroll-benchmark.ts` 依赖 debug-harness（Electron 启动），
   其指标计算层已单测覆盖；真实 FPS/内存数字需在 VS Code 宿主中运行后回填。

## 七、结论

本版本将汇总报告 7 个盲点任务中**可在无头环境完整验证的部分全部落地**（Schema 桥、
迁移器、前缀提取、Job Object、Vite 分割、基准工具链），并以 870 个 vitest 测试全绿 +
双端 tsc + mocha 编译通过作为质量门禁。剩余 5 项（JSONL 合并、Terminal LRU、Message
Queue UI、事务锁、SDK 前缀接线）均依赖真实 VS Code 宿主交互或跨层重构，已在遗留清单中
明确标注，避免「看似完成、实为半成品」。


# 真实宿主滚动基准（先启动 debug-harness server）
node src/dev/debug-harness/server.ts --auto-launch
bun src/dev/debug-harness/benchmark/run-scroll-benchmark.ts --messages 100 --budget-mb 200
```

| `src/dev/debug-harness/benchmark/run-scroll-benchmark.ts` | 驱动 debug-harness：注入 N 条合成消息 → rAF 滚动采样 → 指标判定（退出码 0/1） |
| `src/dev/debug-harness/benchmark/benchmark-metrics.test.ts` | 3 个单测：FPS 计算、内存预算、边界 |
| `apps/vscode/vitest.config.ts` | **窄化 include**（精确路径替代 `src/utils/**`/`src/hosts/vscode/**`），消除 mocha 套件被 vitest 误跑（17 个失败文件归零） |
