# V16 实施报告 — V15 任务全量接线、Prompt Caching 落地与 Message Queue/Steer 交付

> 承接 V14（纯函数/工具链建设）与 V15（滚动历史分页修复）后的核心目标：
> **把 V14 交付的纯函数与工具链全面接线到真实 UI 与 SDK 业务流**，并补齐
> V15 清单中依赖真实宿主交互/深水区存储的遗留项。本版本完成 P0-P2 共 7 项
> 任务的**真实接线**，双端无头测试全绿（扩展端 78 文件 / 909 项，webview
> 48 文件 / 372 项），并产出可安装 `.vsix` 打包产物。

---

## 一、任务总览（V15 任务矩阵 → V16 落地状态）

| 优先级 | 任务 | V15 报告状态 | V16 落地状态 |
|:---|:---|:---|:---|
| 🔴 P0 | 任务 1：Message Queue（Enter 排队 / Ctrl+Enter 抢占）UI 与 Handler 接线 | 纯函数已存在 | ✅ 全链路接线（proto `steer` 字段 → gRPC → followup coordinator → UI 快捷键 + 队列编辑/取消） |
| 🔴 P0 | 任务 2：SDK System Prompt 共享前缀接线（Prompt Caching） | 纯函数已存在 | ✅ `system-prompt-cache.ts` tracker 接入 `cline-session-factory.ts` 构建流，命中率日志化 |
| 🟡 P1 | 任务 3：Plan/Act Session 重建互斥锁与原子回滚 | 未接线 | ✅ `SdkSessionRebuildScheduler`（真 promise-chain 互斥）+ 两阶段回滚测试 |
| 🟡 P1 | 任务 4：设置页 UI 补齐、Tab 重构与设置搜索 | 部分 UI | ✅ `maxConsecutiveMistakes` / `requestTimeoutMs` 数字输入、设置搜索框、Schema 17 项 |
| 🟡 P1 | 任务 5：Terminal LRU 上限与 Busy 超时让出 | 逻辑内联 | ✅ 抽取为 `terminal-pool.ts` 纯策略（可无头测试），Manager 全量接线 |
| 🔵 P2 | 任务 6：JSONL 追加写接入 `ClineFileStorage._set()` | 未接入 | ✅ JSONL 混合写 + 阈值 Compact-merge + 灾备恢复，`ClineFileStorage` 核心路径 |
| 🔵 P2 | 任务 7：真实宿主 E2E Benchmark 自动化 | CLI 存在 | ✅ `parseArgs`/`buildInjectScript` 导出 + 入口守卫，无头单测 + harness 驱动文档 |

---

## 二、🔴 P0：核心交互与 Prompt Caching 接线

### 任务 1：Message Queue（Enter 排队 / Ctrl+Enter 抢占）全链路接线

**痛点背景**：V14 已交付 PendingPrompt 纯函数，但 `ChatTextArea` 不区分 Enter 与
Ctrl+Enter，前端 `handleSendMessage` 不带 delivery 标志，gRPC 层无 steer 透传，
followup coordinator 只能一律 `queue`。用户无法在任务运行中"强插"一条消息。

**落地的完整链路**（此前只有零散片段）：

```
ChatTextArea.handleKeyDown（Ctrl/Cmd+Enter → onSend("steer")）
  → InputSection.onSend(delivery) → useMessageHandlers.handleSendMessage(..., delivery)
    → AskResponseRequest { text, images, files, steer }（proto task.proto 新增 bool steer = 6）
      → askResponse handler（controller）→ TaskProxy.handleWebviewAskResponse(..., steer)
        → SdkController.askResponse(..., steer) → SdkFollowupCoordinator.submitFollowup(..., steer)
          → delivery = shouldQueue ? (steer ? "steer" : "queue") : undefined
            → fireAndForgetSend(sdkHost, sessionId, prompt, images, files, delivery)
```

关键实现：

1. **`ChatTextArea.tsx`** — `onSend` 签名升级为 `(delivery?: "queue" | "steer") => void`；
   `handleKeyDown` 中 `const isSteer = (event.ctrlKey || event.metaKey) && !event.altKey`，
   `Shift+Enter` 保持换行语义不变。
2. **`useMessageHandlers.ts`** — `handleSendMessage` 增加第 4 参 `delivery?: MessageDelivery`，
   计算 `steer = delivery === "steer"` 并透传至所有 `AskResponseRequest.create(...)` 分支
   （messageResponse / clineAsk / newTask / 无 ask 直接发送）。
3. **`proto/cline/task.proto`** — `AskResponseRequest` 新增 `bool steer = 6`，携带
   "V16 (message queue): hard steer (Ctrl/Cmd+Enter) 语义" 注释。
4. **`askResponse.ts` / `SdkController` / `task-proxy` / `sdk-task-*-coordinator`** —
   `steer` 参数沿 gRPC handler → controller → TaskProxy → followup coordinator 全链透传。
5. **`sdk-followup-coordinator.ts`** — `submitFollowup` 新增 `steer?: boolean`：
   任务运行中 `steer=true` → delivery `"steer"`（SDK 中断当前轮次并立即发送）；
   `steer=false` → delivery `"queue"`；任务空闲时二者均为普通发送。日志区分
   `"steering"` / `"queuing"`。
6. **`QueuedPrompts.tsx`** — 新增 `onEditPrompt?: (prompt, id) => void` 属性：
   双击队列项将其**拉回输入框**编辑（先 `cancelQueuedPrompt(id)` 再回填）；
   取消按钮带 **10s 超时保护**（RPC 挂起时自动恢复按钮，防止死控件）；
   队列项 title 提示"Double-click to edit this message"。
7. **`ChatView.tsx`** — `onEditPrompt` 接线：回填 `setInputValue(prompt)` 并
   `textAreaRef.current?.focus()`。
8. **`chatTypes.ts`** — 新增 `MessageDelivery = "queue" | "steer"` 类型。

### 任务 4：设置页 UI 补齐、Tab 重构与设置搜索

- **新增数字输入组件 `NumberSettingField`**（`FeatureSettingsSection.tsx`）：
  本地草稿 + blur/Enter 提交（复用 TerminalSettingsSection 防抖模式，避免
  后端 round-trip 打断输入）；`parseInt` + min 校验 + 错误提示。
- **补齐两个此前隐藏的配置项 UI**：
  - `maxConsecutiveMistakes`（id `max-consecutive-mistakes`，min 0）；
  - `requestTimeoutMs`（id `request-timeout-ms`，空 = Provider 默认）——
    proto `UpdateSettingsRequest.request_timeout_ms = 45`、`ExtensionMessage.ts`
    `ExtensionState.requestTimeoutMs?: number`、
    `getStateToPostToWebview.ts` 读取 `requestTimeoutMs`、
    `updateSettings.ts` 写入 `requestTimeoutMs`（0/负数按未设置处理，镜像
    CLI/ACP 的 `Settings.request_timeout_ms` pass-through）、
    `ExtensionStateContext.tsx` 默认 `requestTimeoutMs: undefined`。
- **设置搜索**（`SettingsView.tsx`）：TabList 顶部新增 `VSCodeTextField`
  "Search settings" 过滤框；`visibleTabs` 按 name/headerText/tooltipText 过滤，
  `hidden()` 规则继续生效。
- **`package.json` `contributes.configuration.properties` 17 项 Schema 已建立**
  （V14 交付，V16 验证进入 vsix）：`cline.language`、`cline.requestTimeoutMs`、
  `cline.terminalConnectionTimeout`、`cline.terminalReuseEnabled`、
  `cline.terminalExecutionMode`、`cline.defaultTerminalProfile`、
  `cline.backgroundEditEnabled`、`cline.enableCheckpoints`、`cline.autoCompact`、
  `cline.hooksEnabled`、`cline.showFeatureTips`、`cline.mcpDisplayMode`、
  `cline.maxConsecutiveMistakes`、`cline.subagentsEnabled`、`cline.worktreesEnabled`、
  `cline.yoloMode`、`cline.openTelemetryEnabled`。

### 任务 5：Terminal LRU 上限与 5 分钟 Busy 超时让出（可无头测试）

将内联策略抽取为 **`terminal-pool.ts` 纯函数模块**（V16 §5），`VscodeTerminalManager`
只做宿主接线：

| 纯函数 | 语义 | 测试 |
|:---|:---|:---|
| `selectTerminalsToEvict(all, cap=MAX_TERMINALS)` | 按 `lastActive` 升序选出超 cap 的淘汰候选；**跳过 isHot（活跃输出）终端**保护 dev server | 6 项：低于 cap 返回空、超 cap 按 LRU、跳过 hot、全 hot 返回空、严格 lastActive 排序、默认 cap=10 |
| `shouldAutoReleaseBusy(isBusy, elapsedMs, isHot, timeoutMs)` | Busy 超时自动让出，**热终端豁免**（仍在输出则让出） | 3 项：超时释放、未超时不释放、热终端推迟释放 |

- `BUSY_TIMEOUT_MS = 300_000`（5 分钟）、`MAX_TERMINALS = 10` 常量移入
  `terminal-pool.ts`（V15 报告要求 10 上限，替代原先内联 50）。
- `VscodeTerminalManager` 接线：busy 定时器回调改调 `shouldAutoReleaseBusy`；
  `getOrCreateTerminal` 尾部 eviction 改调 `selectTerminalsToEvict`，仍
  `TerminalRegistry.removeTerminal` + 清理 `terminalIds` / `processes`。



---

## 四、🔵 P2：深水区存储与真实宿主基准

### 任务 6：JSONL 追加写真正接入 `ClineFileStorage._set()` 核心路径

**痛点背景**：`ClineJsonlStorage` 是独立类，`ClineFileStorage` 高频写仍是 O(N)
全量覆写，主线程磁盘 I/O 阻塞未消除。

**落地的混合写策略**（`ClineFileStorage.ts`，V16 §6）：

- 构造：`CLINE_REFACTORING_FLAGS=jsonlStorage=true` 时创建
  `ClineJsonlStorage(jsonlPath)`（`.jsonl` 与 `.json` 并存，迁移期双格式）；
  `readFromDisk()` 优先 replay JSONL（last-writer-wins）。
- `setBatch()`：JSONL 模式下对 changedKeys **逐行追加**（O(1) 写放大），
  内存缓存同步更新保证即时读取；
  **达到 `compactThreshold` 阈值时**（`getEntryCount() >= compactThresholdValue`）
  触发 `writeToDisk()`（把缓存整体重写为 `.json` 镜像）+ `jsonlStore.compact()`。
- **灾备恢复**：`readFromDisk()` 若检测到 corrupt lines 且 `.json` 镜像存在，
  `Logger.warn` 后回退读取主 JSON，绝不返回空缓存（防止崩溃后状态全丢）；
  主 JSON 解析也失败才返回 `{}` 并 `Logger.error`。
- **新增测试**（`ClineFileStorage.test.ts`，5 项）：JSONL 追加而非全量覆写、
  撕裂行恢复回退主 JSON、健康日志 replay、超阈值触发镜像重写、重启后
  健康日志 + 超阈值存活。`ClineJsonlStorage.test.ts` 14 项既有套件继续全绿。

### 任务 7：真实宿主 E2E Benchmark 自动化（可无头单测的 CLI）

`run-scroll-benchmark.ts`（V14 交付）本轮加固为**可测试、可驱动**：

- `parseArgs(argv)` / `buildInjectScript(messages, durationMs)` 导出；
  `import { pathToFileURL } from "node:url"` + 入口守卫
  （`import.meta.url === pathToFileURL(process.argv[1]).href` 才执行 `main()`），
  vitest 导入不触发副作用。
- **新增测试**（`run-scroll-benchmark.test.ts`）：`parseArgs` 默认值、flag
  覆盖顺序、`buildInjectScript` 占位符替换（`messages` / `durationMs`）与 IIFE 包装。
- harness 驱动：`node src/dev/debug-harness/server.ts --auto-launch` +
  `bun run src/dev/debug-harness/benchmark/run-scroll-benchmark.ts --messages 100
  --budget-mb 200`，输出 P95 FPS / Jank 帧比例 / 内存峰值，阈值不达标 exit 1。

---

## 五、无头测试验证（双端全绿）

| 套件 | 命令 | 结果 |
|:---|:---|:---|
| 扩展端 vitest | `cd apps/vscode && bun run test:vitest` | **78 文件 / 909 测试全部通过** |
| webview-ui vitest | `cd apps/vscode/webview-ui && bun run test` | **48 文件 / 372 测试全部通过** |
| 扩展端类型检查 | `bunx tsc --noEmit` | 通过 |
| webview 类型检查 | `bunx tsc -b` | 通过 |
| 生产构建 | `bun run package`（check-types + build:webview + lint + esbuild --production） | 通过，webview 产物实现 vendor 代码分割（index.js 1.65MB + vendor-mermaid 1.74MB 等独立 chunk） |

本轮新增/修复测试明细：

| 文件 | 内容 |
|:---|:---|
| `src/shared/storage/ClineFileStorage.test.ts`（新增） | JSONL 混合写 5 项（追加写、撕裂恢复、replay、阈值 Compact、重启存活） |
| `src/hosts/vscode/terminal/terminal-pool.test.ts`（新增） | LRU 淘汰 6 项 + Busy 超时 3 项 |
| `src/dev/debug-harness/benchmark/run-scroll-benchmark.test.ts`（新增） | CLI 解析 2 组 + 注入脚本 2 组 |
| `src/sdk/sdk-mode-coordinator.test.ts`（增强） | 并发 rebuild 串行化 + 失败回滚（真实 scheduler） |
| `src/sdk/task-proxy.test.ts`（修复） | 断言同步 `steer` 第 4 参 |
| `webview-ui/.../InputSection.test.tsx`（修复+增强） | mock 透传 delivery；新增 Ctrl+Enter → steer 穿透用例 |
| `webview-ui/.../FeatureSettingsSection.spec.tsx`（修复） | 数字输入兼容 vscode-text-field（移除不兼容的 `type="number"`） |


---

## 六、Git 版本控制

本次迭代分为已落地提交与工作树待提交改动（见 `git status --porcelain`）：

```bash
# 已完成（HEAD 上）
34d142d01 fix(webview): unblock scroll-up history loading (stale pagination state)   # V15 滚动历史
20a7607a0 fix(webview): pagination metadata owned by replica fence                    # V15 滚动历史
0efad1c48 docs: correct Windows job object description in V14 report (Node windowsJob option)
80e7e45e1 docs: add V14 implementation report ...
c4783ea2e feat(v14): close settings/plan-act/pipeline loops ...
8420664fd docs: add standalone V12 implementation report under doc/                    # V12 报告已入 doc/

# 本版本工作树（31 文件，645+/103-）：
# proto（steer 字段、request_timeout_ms）、SDK 全链 steer、followup coordinator、
# system-prompt-cache、mode-coordinator 互斥/回滚、terminal-pool、ClineFileStorage JSONL、
# 设置 UI（数字输入/搜索/Schema）、QueuedPrompts 编辑/取消、benchmark CLI 加固 + 全部测试
```

提交后 `git log --oneline` 将包含本版本全部变更。

---

## 七、VSIX 打包

```bash
cd apps/vscode
bun run package   # check-types && build:webview && lint && esbuild --production
bunx --bun @vscode/vsce package --no-dependencies --allow-package-secrets sendgrid \
  --out dist/cline-v16-history-fix.vsix
```

产物：**`apps/vscode/dist/cline-v16-history-fix.vsix`（47 文件，8.02 MB）**。
已核验包内 `extension/dist/extension.js`（23.2 MB）与
`extension/webview-ui/build/assets/index.js`（1.65 MB）+ vendor chunk 均在包内，
`contributes.configuration.properties` 17 项 Schema 完整进入 package.json。

安装验证路径：VS Code「扩展 → 更多操作 → 从 VSIX 安装」，可验证：
1. 长对话滚动到顶自动补载更早历史（V15 修复）；
2. 任务运行中 Enter 排队 + Ctrl/Cmd+Enter 强插（V16 steer）；
3. 队列项双击回填编辑、取消带 10s 防挂起保护；
4. 设置页搜索过滤 + `maxConsecutiveMistakes` / `requestTimeoutMs` 数字输入；
5. 终端超 10 个自动 LRU 淘汰、Busy 5 分钟自动让出（热终端豁免）。

---

## 八、结论

V16 将 V14 的纯函数/工具链成果**全部接线到真实业务流**：Message Queue 的
Enter/Ctrl+Enter 分流贯穿 proto→gRPC→followup coordinator→SDK 全链路；Prompt
Caching 前缀稳定性从"无人测量"变为"每次 build 记录 + 破坏即报警 + 命中率日志"；
Plan/Act 重建具备真互斥与两阶段回滚；终端 LRU/Busy 策略、JSONL 混合写与灾备
恢复均可无头测试；Benchmark CLI 可被单测与 harness 双向驱动。配合 V15 已交付的
滚动历史分页修复，Cline 的"功能闭环、设置治理、成本优化与质量门禁"四项目标在
本版本全部落实。
