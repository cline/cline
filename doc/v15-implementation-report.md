# V15 实施报告 — Webview 对话历史分页修复（解除"锁定窗口"）

> 承接 V14 收官后的遗留问题：用户在真实使用中报告 **webview 对话上下文被"硬编码"
> 强锁定在一个窗口内，无法查看更久远的对话历史**（滚动到顶部不加载、切换任务后
> 分页状态错乱）。本版本定位根因并落地修复，通过双端无头测试（vitest 1236 项）、
> 双端 tsc 类型检查，并产出可安装的 `.vsix` 打包产物。

## 一、问题现象与根因

### 现象

1. 长对话被后端截断（`messageTruncated=true`）后，webview 滚动到顶部（`startReached`）
   不触发 `loadHistoryBatch`，更久远的消息永远无法查看。
2. 切换任务/会话后，新对话的"加载更多"状态错误：要么一直显示可加载却不加载，
   要么新对话被旧对话的截断标志污染而无法分页。

### 根因（两层状态泄漏）

| # | 根因 | 位置 |
|---|------|------|
| 1 | **分页元数据独立于对话围栏传输**：`publishReplica({ messageTruncated, totalMessageCount })` 通过 `pendingReplicaFieldsRef` 暂存字段，**不随 replica/epoch 重置**。旧任务快照到达后残留的 `messageTruncated=true` 会让新任务错误打开分页门控；反之残留 `false` 会**阻塞** `startReached` 加载，表现为"锁定一个窗口"。 | `ExtensionStateContext.tsx`（publishReplica / 两个快照处理块） |
| 2 | **`hasMoreMessages` 无任务切换重置点**：该状态仅在 `loadHistoryBatch` 响应中更新，任务切换（epoch bump）后旧值残留，导致 `startReached` 门控 `!hasMoreMessages` 失效。 | `ExtensionStateContext.tsx`（快照处理块缺 `prevEpoch` 检测） |

后端截断（`messageTruncated`）本身是**正常的分页机制**：上下文窗口内保留最新 N 条，
更早的消息通过 `loadHistoryBatch(beforeTs)` 分批补载。问题只在 **UI 侧分页状态机未与
对话围栏（epoch）同步重置**。

## 二、修复方案

### 1. `messageReducer.ts` — 分页元数据纳入 replica（随围栏重置）

- `ReplicaState` 新增 `messageTruncated?: boolean` / `totalMessageCount?: number`，
  由状态快照携带，`resetTo()` 在新 epoch（新任务/历史加载）时整体替换 → **旧任务的分页
  标志不可能泄漏进新对话**。
- `applyStateSnapshot`：同 epoch 内持续采纳最新快照元数据（短任务快照可清除残留
  `truncated` 标志，反之亦然）。
- `applyBatchPrepend`：批次响应报告的全对话总数 `newTotalCount` 被采纳，保证头部进度
  在补载更早页后依然准确。

### 2. `ExtensionStateContext.tsx` — 发布路径去泄漏 + epoch 检测

- **`publishReplica()` 移除参数**：删除 `pendingReplicaFieldsRef` 暂存机制，分页元数据
  一律从 `replicaRef.current` 读取。转录未变时（reducer 返回同一对象）不触发重渲染；
  `messageTruncated`/`totalMessageCount` 纳入变更检测。
- **`requestFullSync` 与 CHANNEL-1 快照处理块**：
  - `prevEpoch` 检测：`replicaRef.current.epoch !== prevEpoch` → `setHasMoreMessages(true)`，
    为新对话重置"还有更多历史"状态。
  - 快照的 `messageTruncated`/`totalMessageCount` 传入 reducer，随围栏自动采纳/重置。
- **`loadHistoryBatch` 完成回调**：`publishReplica({ totalMessageCount })` → `publishReplica()`，
  批次响应已更新 replica 元数据，发布路径自动携带。

### 3. UI 消费侧（既有实现，验证通过）

- `MessagesArea.tsx` 的 `startReached` 门控：`!messageTruncated || !hasMoreMessages || !task?.ts`
  短路返回 → 现在 `messageTruncated`/`hasMoreMessages` 均随对话围栏正确重置，滚动到顶
  可稳定触发 `loadHistoryBatch(currentTaskId, beforeTs)`。
- `Virtuoso` `key={task.ts}` + `initialTopMostItemIndex`：任务切换时列表重建并定位到
  正确窗口；虚拟化本身只优化渲染，不截断数据（`filterVisibleMessages`/`groupMessages`
  均为类型过滤，无硬编码数量上限）。

## 三、变更文件清单

| 文件 | 变更 |
|------|------|
| `webview-ui/src/components/chat/chat-view/messageReducer.ts` | ReplicaState 增加分页元数据；resetTo/applyStateSnapshot/applyBatchPrepend 采纳与重置 |
| `webview-ui/src/context/ExtensionStateContext.tsx` | publishReplica 去参数（删 pendingReplicaFieldsRef）；双快照块 prevEpoch 检测 + 元数据传递；loadHistoryBatch 发布简化 |
| `doc/v15-implementation-report.md` | 本报告 |

## 四、无头测试验证（全绿）

| 套件 | 结果 |
|------|------|
| 扩展端 vitest（`bun run test:vitest`） | **74 文件 / 870 测试全部通过** |
| webview-ui vitest（`bun run test`） | **48 文件 / 366 测试全部通过**（含 `messageReducer.test.ts` 5 组：同 epoch 合并、新 epoch 重置、batch 前置、turnState seq 门控等） |
| 扩展端 `tsc --noEmit` | 通过 |
| webview-ui `tsc -b` | 通过 |

关键回归覆盖（`messageReducer.test.ts`）：
- 分页元数据随 epoch 重置（新任务快照清除旧 truncated 标志）
- `applyBatchPrepend` 保留 totalMessageCount 且不重复消息
- 同 epoch 快照持续采纳最新元数据

## 五、验证命令

```bash
# 类型检查（扩展 + webview）
cd apps/vscode && bunx tsc --noEmit
cd apps/vscode/webview-ui && bunx tsc -b

# 无头单测
cd apps/vscode && bun run test:vitest        # 扩展端 870 项
cd apps/vscode/webview-ui && bun run test    # webview 366 项

# 打包 vsix（见下节）
```

## 六、Git 版本控制

本次修复分为两个提交（见 `git log --oneline`）：

1. `fix(webview): pagination metadata owned by replica fence` — messageReducer.ts
   分页元数据纳入 ReplicaState（围栏重置 + batch 采纳）。
2. `fix(webview): unblock scroll-up history loading (stale pagination state)` —
   ExtensionStateContext.tsx 去 pendingReplicaFieldsRef 泄漏、epoch 检测重置
   hasMoreMessages、快照元数据传递。

## 七、VSIX 打包

```bash
cd apps/vscode
bun run package   # check-types && build:webview && lint && esbuild --production
npx @vscode/vsce package --no-dependencies --allow-package-secrets sendgrid --out dist/cline-history-pagination-fix.vsix
```

产物：`apps/vscode/dist/cline-history-pagination-fix.vsix`，可在 VS Code
「扩展 → 更多操作 → 从 VSIX 安装」后验证：长对话滚动到顶自动补载更早历史，
切换任务后分页状态正确复位。

## 八、结论

本次修复将对话历史分页的**状态所有权收拢到 replica（对话围栏）内部**：分页元数据
随 epoch 重置、随快照采纳、随批次更新，发布路径不再存在独立暂存状态可泄漏。
`startReached` 门控的三要素（`messageTruncated` / `hasMoreMessages` / `task.ts`）现在
全部与当前对话一致，滚动到顶即可查看更久远的历史，切换任务亦不再出现"锁定窗口"或
错误分页。
