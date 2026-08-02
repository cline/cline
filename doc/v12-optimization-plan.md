# V12 性能优化方案 — 长轮次对话卡顿 & Webview 视图卡死

## 问题分析

### 症状

1. **长轮次对话后卡顿**：随着消息数量增加（>50 条），ChatRowList 的滚动、展开/折叠操作出现明显延迟（500ms+）
2. **Webview 视图卡死**：在极端情况下（>100 条消息），Webview 完全无响应，CPU 占用 >90%
3. **内存持续增长**：Conversation 越长，Webview 堆内存越大，回收不及时

### 根本原因

通过 v11 重构（ToolUseRow 提取）已解决部分问题，但 ChatRowContent 组件本身仍有以下瓶颈：

1. **ChatRowContent 内部无 memo**
   - 每个 ChatRow 渲染都会重新创建 `ChatRowContent` 内部函数和对象（useMemo 依赖对象引用变化）
   - `ChatRowContent` 在每次消息更新时都会全部重新计算

2. **Message 对象引用不稳定**
   - `ExtensionStateContext` 每次更新都会创建新的消息数组
   - `message.text` 的 JSON 解析每次都会产生新对象

3. **大量条件判断无法短路**
   - `ChatRowContent` 中的 `if/else` 链每次都会完整遍历
   - `conditionalRulesInfo`, `askOptions`, `tool` 等分支判断无法通过 React memo 跳过

4. **Webview 层消息频率过高**
   - `postMessage` 在流式输出时每 50-100ms 更新一次
   - 每次消息更新触发全量状态传递

## V12 优化方案

### 方案 1：ChatRowContent 内部组件的 `React.memo` 包裹

**现状**：ChatRowContent 是一个 `memo` 组件，但内部的 `MarkdownRow`, `ToolUseRow` 等子组件各有不同的 memo 策略。

**优化**：
- `UserMessage` 使用 `React.memo`（按 `text`, `images`, `files` 浅比较）
- `MarkdownRow` 使用 `React.memo`（按 `message`, `isExpanded`, `onToggleExpand` 浅比较，但 `message` 对象引用不稳定）
- 所有行组件统一 memo 策略

**预期收益**：减少 ~30% 不必要的子组件渲染

### 方案 2：消息列表虚拟化（VirtualList）

**现状**：`ChatRowList` 渲染全部消息，即使只有最后几条可见。

**优化**：实现固定窗口虚拟化
```typescript
// ChatRowList.tsx
const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 })
const containerRef = useRef<HTMLDivElement>(null)
// 只渲染 visibleRange 范围内的 ChatRow
// 使用 IntersectionObserver 或滚动事件驱动
```

**预期收益**：无论对话多长（100, 500, 1000+ 条），DOM 节点数恒定，内存占用大幅降低

**注意事项**：
- 需要正确处理自动滚动到最新消息
- 展开/折叠操作需要在虚拟化上下文中保留状态
- VS Code Webview 使用 Chromium，虚拟列表兼容性好

### 方案 3：`atoms` / 细粒度状态订阅

**现状**：`ExtensionStateContext` 更新时，所有消费者重新渲染。

**优化**：引入 `useSyncExternalStore` 或类似 `jotai` 的原子状态管理
```typescript
// 替代方案：将高频变动的状态（messageList）与低频变动的状态（theme,settings）分离
// ChatRowList 只订阅 messages 变化
// SettingsPanel 只订阅 settings 变化
```

**预期收益**：设置变更/主题切换不再触发消息列表重渲染

### 方案 4：流式消息增量更新

**现状**：每次流式消息更新，整个消息数组通过 postMessage 传递。

**优化**：
```typescript
// 增量更新协议
type DeltaMessage = {
  type: "delta"
  messageIndex: number   // 更新哪条消息
  text?: string          // 增量文本
  say?: string
  partial?: boolean
}
```

**预期收益**：减少 ~80% 的消息序列化/反序列化开销

### 方案 5：ChatRowContent 拆分为独立 Lazy 组件

**现状**：所有 ChatRow 类型（text, tool, ask, api_req 等）都在 ChatRow.tsx 中。

**优化**：按类型拆分为懒加载组件
```typescript
const ToolRow = lazy(() => import("./rows/ToolRow"))
const TextRow = lazy(() => import("./rows/TextRow"))
const AskRow = lazy(() => import("./rows/AskRow"))
```

**预期收益**：初始加载减少 50% 的 JS 体积

### 方案 6：高频消息去抖（Debounce）

**现状**：流式输出时 postMessage 频率过高，中间帧渲染浪费。

**优化**：
```typescript
// Webview 端使用 debounce 合并渲染
const debouncedMessages = useMemo(() => {
  return debounce(messages, 50)
}, [messages])
// 或使用 requestAnimationFrame 节流
```

**预期收益**：减少 ~50% 的渲染帧数，显著降低 CPU 占用

## 实施优先级

| 优先级 | 方案 | 收益/工作量比 | 预估工作量 |
|--------|------|-------------|-----------|
| P0 | 方案 2：消息列表虚拟化 | 🟢 极高 | 2-3 天 |
| P0 | 方案 4：流式消息增量更新 | 🟢 极高 | 3-5 天 |
| P1 | 方案 3：细粒度状态订阅 | 🟡 高 | 5-7 天 |
| P1 | 方案 1：子组件 memo 统一 | 🟡 中 | 1-2 天 |
| P2 | 方案 6：高频消息去抖 | 🔴 低 | 0.5 天 |
| P2 | 方案 5：Lazy Loading | 🔴 低 | 1-2 天 |

## 性能验证指标

1. **滚动帧率**：长对话（100+ 条）列表滚动保持 >30fps
2. **首次渲染时间**：Webview 首次打开 < 500ms
3. **流式渲染延迟**：流式输出时 Webview 更新延迟 <200ms
4. **内存占用**：长对话 Webview 堆内存 < 200MB
5. **展开/折叠响应**：点击展开/折叠 < 50ms 响应

## 与现有模式的兼容性

- 所有优化方案不应改变当前的消息传递协议（proto）
- 不应改变 StateManager/Controller 的后端架构
- 虚拟化方案需要兼容当前的 auto-scroll 逻辑（`useAutoScroll`）
- 增量更新需要保持与当前全量更新的向后兼容

---

## 实施状态（V12 收官更新）

> 以下为 V12 全部 6 个方案的落实情况。已交付实现共 12 个提交（含本分支 P0–P3
> 的 7 个前置提交与本轮收尾的 5 个提交），测试与构建状态见 `doc/v13-final-report.md`。

| 优先级 | 方案 | 状态 | 交付内容 |
|--------|------|------|---------|
| P0 | 方案 2：消息列表虚拟化 | ✅ 已完成 | Virtuoso 虚拟列表 + `increaseViewportBy` 缩减为 500/300px + Footer 版 ThinkingLoader + 向上翻页（`loadHistoryBatch` RPC + `applyBatchPrepend` reducer） |
| P0 | 方案 4：流式消息增量更新 | ✅ 已完成 | 后端 `sendStateDelta`（append/update/replace_all）+ version 间隙自愈（gap-detection → `requestFullSync`）+ 收敛式 replica reducer（epoch/seq 围栏） |
| P1 | 方案 3：细粒度状态订阅 | ✅ 已完成 | 高频消息状态拆分为 `MessagesStateContext`（`useMessagesState`），流式更新不再触发 settings/theme 消费者重渲染，反之亦然；`MainExtensionState` 类型剥离消息字段 |
| P1 | 方案 1：子组件 memo 统一 | ✅ 已完成 | ToolUseRow / MessageRenderer / ChatRow / MarkdownRow memo + `UserMessage` 补全 memo（自定义比较器，忽略不稳定的 `sendMessageFromChatRow`） |
| P2 | 方案 6：高频消息去抖 | ✅ 已完成 | `messageFrameScheduler.ts` 帧合并调度器（rAF + 隐藏页面 setTimeout 兜底），同一帧内多次 delta/partial 合并为一次 `setReplicaMessages` |
| P2 | 方案 5：Lazy Loading | ✅ 已完成 | `MermaidBlock`/`McpResponseDisplay`/`SearchResultsDisplay` 用 `React.lazy` + Suspense 延迟初始化（mermaid 运行时 ~1MB 仅在渲染图表时初始化）；ask 分支提取为 `ChatAskRow.tsx` |

### 附带修复（构建恢复）

`tsc -b`（webview 严格构建）在 P0–P3 提交上已失败，本轮一并修复：

- ChatRow 缺失的 lucide 图标导入（`LoaderCircleIcon` 等 4 个）
- `backgroundEditEnabled` 布尔收窄；`taskHistory` 可空防护（WelcomeSection/HistoryPreview/HistoryView）
- `loadHistoryBatch` 改用 `currentTaskItem.id`（字符串 ULID）而非数字 `task.ts`
- `TaskHeader.stories.tsx` 移除已迁走的 `clineMessages`
- `refactoring-flags` 单测与 `deltaStatePush` 默认值对齐

### 说明

- 构建配置 `vite.config.ts` 使用 `inlineDynamicImports: true`，故方案 5 的懒加载
  不减小包体字节数，实际收益为**重型库/组件延迟初始化**（mermaid、MCP 响应、
  搜索结果渲染器仅在实际出现时才加载执行）。
- 方案 6 的合并粒度为一帧（16ms），对用户可感知的流式文本延迟无影响。
