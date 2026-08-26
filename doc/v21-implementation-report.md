# V21 实施报告 — 历史分页回弹修复、历史对话计费显示修复、Auto Compact 阈值用户可配置

> 承接 V20（webview chunk 循环依赖修复，空白面板定论）。V21 完成六件事：
> ① 历史消息上拉加载回弹修复；② 历史对话计费显示失效（$0.00）根因修复；
> ③ Auto Compact 触发阈值从硬编码 90% 改为用户可配置（设置页 50-100%）；
> ④ 追加：历史消息滚到头永不触发加载的根因修复（ts 游标域不匹配）；
> ⑤ 追加：CI 双平台回归失败修复（Ubuntu JSONL 解析、Windows SQLite WAL）；
> ⑥ 追加：问题4 上线后复核 —— 前端回弹主因定位（列表重挂载）+ 旧 SDK 任务
>    `currentTaskItem` 兜底合成，滚动查看历史不再回弹。

---

## 一、任务总览

| 优先级 | 问题 | 根因 | 修复状态 |
|:---|:---|:---|:---|
| 🔴 P0 | 问题2：历史对话计费显示失效（$0.00） | `readPersistedMessagesFile` V18 默认 `limit:50` → `isTruncated=false` → 分页永不触发 → 50 条外消息（含 `api_req_started` 计费行）不可达；次因 `mergeMessagesBatch` Phase 3 无条件替换 | ✅ 全量读取恢复（limit 改显式 opt-in）+ seq 新鲜度守卫回归 |
| 🟡 P1 | 问题1：历史消息上拉加载回弹 | `MessagesArea` 缺稳定 key / prepend 后滚动定位失败 | ✅ 稳定 task key + `computeItemKey` + prepend 不滚底 + in-flight 锁 |
| 🔴 P0（追加） | 问题4：历史消息滚到头**永不触发**加载 | `ClineMessage.ts` 为进程内单调计数器，每次磁盘回读（`getClineMessages`）都重新铸造 → 快照与 `loadHistoryBatch` 的 ts 域不一致 → `beforeIndex === -1` → 空批次 + `hasMore=false` 永久锁死；次因 `currentTaskItem` 从 top-100 切片查找，旧任务打开时取不到 | ✅ `loadHistoryBatch` 改读**当前打开任务的内存 transcript**（同一铸造域）；`currentTaskItem` 改为全量列表查找 + 打开任务兜底合成 |
| 🟡 P1（追加） | 问题6：滚动查看历史仍触发回弹 / 旧 SDK 任务固定上限 | `ChatView` 用 `messages.at(0)` 派生 task → prepend 后 `task.ts` 变化 → `virtuosoKey` 变更 → react-virtuoso **整表重挂载** → `initialTopMostItemIndex` 滚回底部；旧任务超出 `listHistory(100)` 窗口时 `currentTaskItem` 仍可能缺省 → taskId `""` 分页短路 | ✅ `task` 改为 `find(say==="task")` 优先（prepend 稳定）；`currentTaskItem` 在合并列表漏取时用打开任务的首条 task 消息合成 |
| 🟢 P2（追加） | 问题5：CI 双平台回归失败 | Ubuntu：V18 JSONL `.messages.json` 被旧测试按整文件 `JSON.parse`；Windows：`HubServerTransport` 惰性建 `SqliteCronStore` → 测试进程并发开 `~/.cline/data/db/cron.db` WAL → 磁盘 I/O 错误 | ✅ 新增 `messages-artifact.ts` 共享助手（自动识别 JSONL/旧 JSON）；测试全部改用 `dbPath: ":memory:"` |
| 🟡 P1 | 问题3：Auto Compact 阈值不可配置 | `COMPACTION_TRIGGER_RATIO=0.9` 硬编码，SDK 配置无字段 | ✅ 全链路用户可配置（proto → 设置 → global-settings → SDK triggerRatio → 触发计算） |

---

## 二、🔴 P0：问题2 — 历史对话计费显示失效

### 2.1 根因链（V18 未提交改动引入）

```
readPersistedMessagesFile(默认 limit:50)   ← V18 引入，仅读 JSONL 尾部 50 行
  → getClineMessages 只剩 50 条
    → getStateToPostToWebview isTruncated = 50 > 50 = false
      → UI 分页（loadHistoryBatch）永不触发
        → SdkController.loadHistoryBatch 收到 beforeIndex === -1、hasMore = false
          → 50 条之外的历史消息永久不可达
            → api_req_started / usage 计费行被截断 → 历史对话计费显示 $0.00
```

### 2.2 修复

1. **`runtime-host-support.ts` `readPersistedMessagesFile`**：恢复全量读取。
   `limit` 从默认值 `50` 改为显式 opt-in（调用方传入才截断），V18 引入的
   默认截断行为移除 —— 分页元数据（`isTruncated`/`beforeIndex`）重新依赖
   真实文件行数计算。
2. **`messageReducer.ts` `mergeMessagesBatch`**：Phase 3 恢复"逐 ts seq
   新鲜度守卫" —— 同一时间戳的消息按 `seq` 比较，仅保留更高 `seq` 的版本；
   修复无条件替换导致的后加载旧批次覆盖新批次问题（V18 回归）。

### 2.3 测试

- `runtime-host-support.test.ts`：新增全量读取（默认）与显式 `limit` 用例。
- `messageReducer.test.ts`：seq 新鲜度守卫回归用例（同 ts 高 seq 保留、低 seq 丢弃）。
- `persistence-service.test.ts` / `session-messages-jsonl.test.ts`：JSONL 读写边界回归。

---

## 三、🟡 P1：问题1 — 历史消息上拉加载回弹

### 3.1 症状

历史对话上拉加载更多后，列表回弹回底部/丢失滚动位置，重复请求加载。

### 3.2 修复（`MessagesArea.tsx` + `useScrollBehavior.ts`）

1. **稳定 task key**：列表 key 绑定 task 身份而非批次内容，避免重挂载。
2. **`computeItemKey`**：消息级稳定 key，prepend 旧批次时保持既有项身份。
3. **prepend 不滚底**：顶部插入历史消息时保持当前视口锚点，不触发自动滚底。
4. **in-flight 锁**：同一方向加载请求进行中时拒绝重复触发，防止抖动回弹。

---

## 四、🔴 P0（追加）：问题4 — 历史消息滚到头永不触发加载

### 4.1 症状

V21 打包版实测：长对话**向上滚动到顶不加载更早消息**（回弹问题修复后仍无法翻页），
`ExtensionStateContext` 日志出现 `loadHistoryBatch` 空批次响应后 `hasMoreMessages=false`，
此后滚动到顶的门控 `!hasMoreMessages` 永久短路。

### 4.2 根因链（双链叠加）

**主因 — ts 游标域不匹配（每次磁盘回读都重新铸造 ts）：**

```
ClineMessage.ts 不是墙钟，而是进程级 MessageIdMinter 的单调计数器（message-id-minter.ts）
  → showTaskWithId 加载历史：getClineMessages → sdkMessagesToClineMessages 铸造 1..N（快照域）
  → 滚动到顶：loadHistoryBatch → getClineMessages 再次磁盘回读 → 同一批消息铸造 N+1..2N（新域）
    → beforeTs（快照域，如 51）< 新域所有值（如 201..400）→ findIndex(m.ts < beforeTs) === -1
      → 返回空批次 + hasMore=false → 前端 setHasMoreMessages(false) → 门控永久短路
```

已验证：对同一批持久化消息用同一 minter 连续翻译两次，ts 分别为 `[1..7]` 与 `[8..14]`，
两次铸造成的 ts 无任何交集（回归测试 `sdk-task-history.test.ts` 固化该断言）。

**次因 — `currentTaskItem` 从 top-100 切片查找：**

`getStateToPostToWebview` 中 `currentTaskItem = processedTaskHistory.find(...)`，
而 `processedTaskHistory` 是 `slice(0, 100)` 的窗口。打开**早于最近 100 条**的旧任务时
`currentTaskItem === undefined` → webview 以 `""` 调 `loadHistoryBatch` → 后端空批次短路，
分页在未发出请求前就已失效。

### 4.3 修复

1. **`sdk-task-history.ts` 新增 `resolvePaginationSourceMessages()`**：分页游标必须作用在
   **当前打开任务的内存 transcript**（`MessageStateHandler`）上 —— 它与 webview 快照同属
   一次翻译铸造，ts 域直接可比；磁盘回读仅作为任务未打开时的兜底（如切任务后滞留的
   在途请求）。
2. **`SdkController.loadHistoryBatch`**：改用该解析器（`this.task?.taskId === taskId` 时
   读 `this.task.messageStateHandler.getClineMessages()`），否则回退 `getClineMessages()`。
3. **`SdkController.getStateToPostToWebview`**：`currentTaskItem` 改为在**全量**合并列表
   （`fullTaskHistory`，切片前）中查找；`taskHistory` 字段仍保留 top-100 窗口。

### 4.4 测试

- `sdk-task-history.test.ts` 新增 5 用例：打开任务命中/未打开/任务不匹配/无 transcript
  四种源选择分支 + ts 域不稳定根因守卫（35 项全绿）。
- `sdk-task-control-coordinator` / `message-translator` / `task-proxy` 回归 136 项全绿。

---

## 五、🟢 P2（追加）：问题5 — CI 双平台回归失败修复

### 5.1 症状

- **Ubuntu**：`per-turn-metrics.live.test.ts` / `messages-contract.live.test.ts` 失败 ——
  `.messages.json` 自 V18 起是 JSONL（首行 `{"header":...}` + 每行 `{"message":...}`），
  旧测试仍按整文件 `JSON.parse`。
- **Windows**：`settings.test.ts` / `fetch-wiring.test.ts` 失败 —— `HubServerTransport`
  构造时惰性创建 `HubScheduleService` → `SqliteCronStore` 打开真实
  `~/.cline/data/db/cron.db`，并行测试进程竞争 WAL（`PRAGMA journal_mode = WAL`）抛磁盘
  I/O 错误。

### 5.2 修复

1. **新增 `apps/cli/src/tests/helpers/messages-artifact.ts`**：`findMessagesArtifacts` +
   `readMessagesArtifact`，自动识别 JSONL 与旧版 pretty-printed JSON 两种格式；
   两个 live 测试改由共享助手读取。
2. **`settings.test.ts`（3 处）/ `fetch-wiring.test.ts`（2 处）**：`HubServerTransport`
   全部补 `scheduleOptions: { dbPath: ":memory:" }`（沿用 `boundary.test.ts` 先例），
   隔离 SQLite 状态。

### 5.3 测试

- `settings.test.ts` + `fetch-wiring.test.ts` 7/7 通过；CLI 类型检查通过；
  bun 冒烟验证 JSONL / 旧 JSON 双格式解析正确。

---

## 六、🟡 P1（追加）：问题6 — 滚动查看历史仍回弹 / 旧 SDK 任务固定上限复核修复

### 6.1 症状

问题4 修复后复测，**固定上限**依旧（顶部无法拉取更早内容），且**用滚轮查看对话记录
也触发回弹**（用户原文"会谈"，即回弹）：滚到顶部加载旧批次后，列表瞬间弹回底部。

### 6.2 根因（前端复核定位）

1. **列表重挂载回弹（主因）**：`ChatView.tsx` 以 `messages.at(0)` 派生 `task`，而
   `MessagesArea` 的 `virtuosoKey = currentTaskItem?.id ?? task.ts ?? "no-task"`。向上
   prepend 旧批次后 `messages[0]` 变成**最旧消息**（常为 `text`/`tool` 行，无 ts），
   `task.ts` 变化 → react-virtuoso 以 `key={virtuosoKey}` **整表重挂载** → 重新执行
   `initialTopMostItemIndex`（滚到底部）。react-virtuoso 4.12.3 对 prepend 本有自动
   滚动补偿，但重挂载让该补偿失效 —— 这是"回弹"的真正机制。
2. **固定上限残余（次因）**：`currentTaskItem` 在全量合并列表中查找，但 `listHistory(100)`
   之外的旧 SDK 任务（或 ts/title 非法被 `item.ts && item.task` 过滤的记录）仍可能缺省 →
   webview 以 `""` 调 `loadHistoryBatch` → 后端空批次短路，分页静默失效。

### 6.3 修复

1. **`ChatView.tsx`**：`task` 派生改为 `messages.find((m) => m.say === "task") ?? messages.at(0)`。
   首条 task 消息在 prepend 后保持不变，`task.ts` 稳定 → `virtuosoKey` 不变 → 列表不
   重挂载，由 virtuoso 的向上 prepend 补偿接管，滚动位置保持。
2. **`SdkController.getStateToPostToWebview`**：`currentTaskItem` 在全量列表漏取时，
   用**打开任务的首条 task 消息**兜底合成（`id: this.task.taskId`），保证任务打开期间
   `currentTaskItem` 恒存在，`loadHistoryBatch` 的 taskId 永不退化 `""`。

### 6.4 测试

- 扩展端类型检查通过；`sdk-task-history` 35/35、`sdk-task-control-coordinator` /
  `message-translator` / `task-proxy` 136/136 全绿（问题4 回归不受影响）。
- webview 类型检查通过；全量 48 文件 / 376 用例全绿（含 messageReducer、消息工具链）。

---

## 七、🟡 P1：问题3 — Auto Compact 阈值用户可配置

### 4.1 改动链路（自上而下）

```
设置页 Auto Compact Threshold（50-100%，NumberSettingField，min/max 校验）
  → UpdateSettingsRequest.auto_compact_threshold = 46（percent，state.proto）
    → updateSettings.ts：校验 50-100 → setCompactionTriggerRatioGlobally(percent/100)
      → global-settings.json compactionTriggerRatio（ratio 0-1，schema 校验越界值丢弃）
        → cline-session-factory.ts：readCompactionTriggerRatioGlobally() → CoreCompactionConfig.triggerRatio
          → compaction.ts：triggerRatio = userCompaction?.triggerRatio ?? COMPACTION_TRIGGER_RATIO(0.9)
            → requestTriggerTokens = maxInputTokens * triggerRatio（触发/诊断/遥测全部使用用户值）
```

### 4.2 关键实现

1. **SDK `config.ts`**：`CoreCompactionConfig.triggerRatio?: number`（0-1，注释回退默认）。
2. **SDK `compaction.ts`**：resolve `triggerRatio`（>0 且 <1 才采纳，否则回退 0.9），
   `requestTriggerTokens`、`thresholdRatio` 诊断、`thresholdTrigger` 日志全部使用用户值。
3. **SDK `global-settings.ts`**：`compactionTriggerRatio` 字段
   （`z.preprocess` 校验 0<r<1，越界丢弃而非抛错，防手改配置文件破坏）；
   `readCompactionTriggerRatioGlobally()` / `setCompactionTriggerRatioGlobally()` 导出。
4. **proto `state.proto`**：`UpdateSettingsRequest.auto_compact_threshold = 46`
   （double，percent 语义，注释 50-100）；`bun run protos` 已再生成。
5. **`getStateToPostToWebview.ts`**：ratio ×100 转 percent 下发 webview（未配置为 `undefined`）。
6. **`ExtensionMessage.ts`**：`autoCompactThreshold?: number`（percent）。
7. **`updateSettings.ts`**：非有限数 / <50 / >100 抛错；合法值 ÷100 写全局设置。
8. **`cline-session-factory.ts`**：`useAutoCondense` 开启时把 `triggerRatio` 并入 compaction 配置。
9. **UI `FeatureSettingsSection.tsx`**：策略下拉下方新增阈值输入（`min=50 max=100`，
   `NumberSettingField` 新增 `max` 校验；空值回退显示 90 但不上送）。
10. **`TaskHeader.tsx` / `ContextWindow.tsx`**：移除死代码 `useAutoCondense={false}`
    硬编码（PR #9348 已删点击设阈值 UI，prop 未在渲染中使用）。

### 4.3 测试

- `global-settings.test.ts`：ratio 读写 + 越界（0 / 1.5）丢弃用例。
- `compaction.test.ts`：`triggerRatio: 0.5` + 4000 预算 → 2000 触发（默认 0.9 为 3600），
  断言 `thresholdRatio=0.5`。
- `cline-session-factory.test.ts`：0.8 阈值透传为 `triggerRatio: 0.8`；
  未配置时 compaction 对象不含 triggerRatio。
- `FeatureSettingsSection.spec.tsx`：阈值渲染/提交/越界拒绝（+3 用例，共 14 全绿）。
- `cline-core-vitest-stub.ts`：补齐 `read/setCompactionTriggerRatioGlobally`（含越界丢弃）。

---

## 八、验证状态

| 项 | 结果 |
|:---|:---|
| SDK 类型检查（`bunx tsc --noEmit` @cline/core） | ✅ |
| SDK 单测 global-settings / compaction（核心） | ✅ 14 + 56 全绿 |
| 扩展端类型检查（`bunx tsc --noEmit`） | ✅ |
| 扩展端单测 cline-session-factory / sdk-compaction / sdk-session-config-builder | ✅ 57 + 5 + 3 全绿 |
| 扩展端单测 sdk-task-history（新增 5 用例） | ✅ 35 全绿 |
| 扩展端单测 sdk-task-control-coordinator / message-translator / task-proxy 回归 | ✅ 136 全绿 |
| CLI 单测 settings / fetch-wiring（SQLite 隔离修复） | ✅ 7 全绿 |
| webview 类型检查 | ✅ |
| webview 单测全量（48 文件，含 messageReducer / 消息工具链） | ✅ 376 全绿 |
| webview 构建（`bun run build:webview`） | ✅ 32.86s |
| 扩展 bundle（`bun esbuild.mjs`） | ✅ `compactionTriggerRatio`/`autoCompactThreshold` 已入包 |
| `vsce package` 全流程（prepublish: check-types + webview build + lint + esbuild --production） | ✅ 52 files / 8,338,172 B |
| 真实 VSCodium 启动 e2e | ⚠️ 扩展宿主正常激活（`saoudrizwan.claude-dev` onLanguage 激活，exthost 日志零错误）；Playwright `firstWindow()` 在本机持续超时（环境性窗口捕获问题，V20 时可用），未取得 webview 页面级断言 |

> 注：`@cline/core` 全量 `test:unit` 的 20 项失败（hub/daemon、hook-file-hooks、
> runtime-builder 等）为**既有失败**（stash 后复跑同样失败），与本轮改动无关。

---

## 九、产物

- 打包：`apps/vscode/dist/cline-v21-auto-compact-threshold.vsix`（8,338,172 B，52 files）
- 验收：vsce 全流程（类型检查 + lint + webview 构建 + 生产 bundle）通过；
  VSCodium 实启动扩展激活无错误；webview 页面级 e2e 待环境恢复窗口捕获后复跑；
  CI（Ubuntu JSONL / Windows SQLite）修复后双平台测试通过。
