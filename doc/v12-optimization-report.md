# V12 优化实施报告 — 长轮次对话卡顿 & Webview 卡死优化

> 本报告为 V12 六个优化方案的**实施结果**（与 `doc/v12-optimization-plan.md` 的
> 方案设计对应）。前置：v11 ToolUseRow 提取（`doc/v11-tool-extraction-summary.md`）；
> 全局收官：`doc/v13-final-report.md`。

## 一、目标回顾

1. **长轮次对话后卡顿**（>50 条消息滚动/展开折叠延迟 500ms+）
2. **Webview 视图卡死**（>100 条消息无响应，CPU >90%）
3. **内存持续增长**（Conversation 越长，Webview 堆内存越大）

根因：全量消息数组反复序列化、`ExtensionStateContext` 单一 context 导致全部消费者
重渲染、ChatRow 内联分支无 memo、无虚拟化、无渲染合并。

## 二、六方案完成矩阵

| 优先级 | 方案 | 状态 | 核心机制 | 关键文件 |
|--------|------|------|---------|---------|
| P0 | 2. 消息列表虚拟化 | ✅ 已完成 | `react-virtuoso` + overscan 500/300 + Footer 版 ThinkingLoader + 向上翻页 | `MessagesArea.tsx`, `useScrollBehavior.ts`, `messageReducer.ts` |
| P0 | 4. 流式消息增量更新 | ✅ 已完成 | 后端 `sendStateDelta`（append/update/replace_all）+ version 间隙自愈（gap-detection → `requestFullSync`）+ 收敛式 replica reducer | `subscribeToState.ts`, `messageReducer.ts` |
| P1 | 3. 细粒度状态订阅 | ✅ 已完成 | 高频消息状态拆分为 `MessagesStateContext`（`useMessagesState`）；`MainExtensionState` 类型剥离消息字段 | `ExtensionStateContext.tsx` |
| P1 | 1. 子组件 memo 统一 | ✅ 已完成 | ToolUseRow / MessageRenderer / ChatRow / MarkdownRow memo + `UserMessage` 补全 memo（自定义比较器） | `UserMessage.tsx`, `MessageRenderer.tsx`, `ToolUseRow.tsx`, `MarkdownRow.tsx` |
| P2 | 6. 高频消息去抖 | ✅ 已完成 | `messageFrameScheduler.ts` 帧合并调度器（rAF + 隐藏页 setTimeout 兜底），同帧多次 delta 合并为一次渲染 | `messageFrameScheduler.ts` |
| P2 | 5. 组件拆分 + 懒加载 | ✅ 已完成 | `React.lazy` + Suspense 延迟初始化重型库/组件；ask 分支提取为 `ChatAskRow` | `ChatAskRow.tsx`, `MarkdownBlock.tsx`, `ChatRow.tsx`, `ToolUseRow.tsx` |

## 三、各方案交付详情

### 方案 1：子组件 memo 统一（P1）

- 行组件统一 `React.memo`：`ToolUseRow`、`MessageRenderer`、`ChatRow`、`MarkdownRow`
- `UserMessage` 补全 memo，使用**自定义比较器**：忽略从不调用的不稳定回调
  `sendMessageFromChatRow`，避免每次流式更新破坏浅比较
- 新增 `UserMessage.memo.test.tsx`（4 例）：验证仅回调变化时跳过渲染、内容变化时重渲染

### 方案 2：消息列表虚拟化（P0）

- 采用 `react-virtuoso` 虚拟列表，DOM 节点数恒定，不随消息总数增长
- `increaseViewportBy` 缩减为 500px（底部）/ 300px（顶部），降低预渲染开销
- ThinkingLoader 改为 Footer 挂载（`components/chat/ChatViewFooter.tsx`），避免在
  每条消息后追加 loader 触发全列表重排
- **向上翻页**：`loadHistoryBatch` RPC 按需加载更早批次，`applyBatchPrepend` reducer
  前插历史，消息窗口上限约 50 条（配合消息截断，见方案 4 附录）
- Virtuoso `itemContent` 稳定化：`itemContent` 不再每次渲染重新创建，配合
  `computeItemKey` 稳定 key

### 方案 3：细粒度状态订阅（P1）

- 新增 `MessagesStateContext` + `useMessagesState()`，高频变动的消息状态（消息数组、
  turnState、版本信息）与低频状态（settings/theme/API 配置）分属两个 context
- 流式更新不再触发 settings/theme 消费者重渲染，反之亦然
- `MainExtensionState` 类型 = 剥离 `clineMessages`/`turnState` 等消息字段的
  `ExtensionState` 子集，`ExtensionStateContext` 的值不再重复携带消息数据
- reducer 移出 `setState` 回调，配合引用相等跳过空操作更新

### 方案 4：流式消息增量更新（P0）

- 后端 `sendStateDelta`：append（新增消息）/ update（改某条消息）/ replace_all（全量兜底）
- version 间隙自愈：webview 检测到版本号跳变（gap-detection）→ `requestFullSync`
  拉取全量，防撕裂
- 收敛式 replica reducer：epoch/seq 围栏，防止乱序 delta 覆盖新状态
- 附录（P1 消息截断）：`messageTruncation` 上限 50 条窗口，配合方案 2 向上翻页

### 方案 5：组件拆分 + 懒加载（P2）

- `MermaidBlock`、`McpResponseDisplay`、`SearchResultsDisplay` 改用 `React.lazy` +
  Suspense：mermaid 运行时（~1MB）仅在渲染图表时初始化，MCP 响应/搜索结果渲染器
  仅在实际出现时加载
- ask 分支（审批/追问/完成结果/计划模式/新任务）从 `ChatRow.tsx` 提取为独立的
  `ChatAskRow.tsx`（memo 包裹），ChatRow 再缩减约 130 行
- 新增 `ChatAskRow.test.tsx`（4 例）：followup / plan_mode_respond / new_task /
  mistake_limit_reached 渲染

### 方案 6：高频消息去抖（P2）

- 新增 `messageFrameScheduler.ts` 帧合并调度器（FrameCoalescer）：同一帧（16ms）内
  多次 delta/partial 合并为一次 `setReplicaMessages`
- 页面隐藏时自动降级为 setTimeout 兜底（rAF 在后台标签页暂停）
- 新增 `messageFrameScheduler.test.ts`（4 例）：帧合并、cancel、flushNow
- 合并粒度对用户可感知的流式文本延迟无影响

## 四、附带修复（构建恢复）

`tsc -b`（webview 严格构建）在 P0–P3 提交上已失败，实施本轮方案时一并修复：

- ChatRow 缺失的 lucide 图标导入（`LoaderCircleIcon` 等 4 个）
- `backgroundEditEnabled` 布尔收窄；`taskHistory` 可空防护（WelcomeSection /
  HistoryPreview / HistoryView）
- `loadHistoryBatch` 改用 `currentTaskItem.id`（字符串 ULID）而非数字 `task.ts`
- `TaskHeader.stories.tsx` 移除已迁走的 `clineMessages`
- `refactoring-flags` 单测与 `deltaStatePush` 默认值（已翻转 true）对齐

## 五、测试覆盖（无头测试全绿）

| 套件 | 结果 | 说明 |
|------|------|------|
| webview vitest | **48 文件 / 366 测试全部通过** | 含新增 `UserMessage.memo.test.tsx`(4)、`ChatAskRow.test.tsx`(4)、`messageFrameScheduler.test.ts`(4) |
| 扩展端 bun 单测 | **66 文件 / 1009 测试通过** | 修复 `refactoring-flags.test.ts` 后全绿 |
| webview 严格类型检查 | `tsc -b` 通过 | 修复 P0–P3 遗留的 6 处类型错误 |
| webview 生产构建 | `bun run build`（tsc -b && vite build）通过 | 单 index.js ~7.26MB（inlineDynamicImports） |

## 六、性能指标对照（设计值）

| 指标 | 目标 | 达成机制 |
|------|------|---------|
| 滚动帧率（100+ 条） | >30fps | Virtuoso 虚拟化 + overscan 500/300 |
| 首帧渲染 | <500ms | 懒加载延迟重型库初始化；增量分组缓存避免 O(N) 遍历 |
| 流式渲染延迟 | <200ms | 帧合并粒度 16ms；delta 只传增量 |
| 堆内存 | <200MB | 虚拟化 + 消息截断（50 条窗口 + 向上翻页） |
| 展开/折叠响应 | <50ms | 行级 memo + reducer 引用稳定，Virtuoso DOM 复用 |

## 七、遗留说明

- `vite.config.ts` 使用 `inlineDynamicImports: true`，方案 5 懒加载的收益为
  **延迟初始化**而非包体减小；若后续改为代码分割，现有 `React.lazy` 结构可直接生效
- 方案 3 后新代码请使用 `useMessagesState()` 订阅消息状态，`useExtensionState()`
  不再暴露 `clineMessages`/`turnState`
- 端到端（真实扩展宿主 + 长对话）的实测帧率/内存基准建议按 `debug-harness` 流程
  复核（本报告仅覆盖无头单测、类型检查与构建）
