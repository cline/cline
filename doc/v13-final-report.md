# V13 最终实施报告 — 长轮次对话卡顿 & Webview 卡死优化收官

> 本文档是 V11/V12 性能优化工作的最终实施跟踪报告，兑现 `b092a581d` 提交信息中
> 「v5 implementation tracking — final report」的承诺（v1–v4 分析已合并进
> `doc/v11-tool-extraction-summary.md`、`doc/v12-optimization-report.md`，方案设计
> 见 `doc/v12-optimization-plan.md`）。

## 一、问题回顾

1. **长轮次对话后卡顿**：消息 >50 条后 ChatRowList 滚动/展开折叠延迟 500ms+
2. **Webview 视图卡死**：消息 >100 条时 Webview 无响应，CPU >90%
3. **内存持续增长**：Conversation 越长，Webview 堆内存越大

根因：全量消息数组经 postMessage 反复序列化、`ExtensionStateContext` 单一 context
导致全部消费者重渲染、ChatRow 内联分支无 memo、无虚拟化、无渲染合并。

## 二、交付清单（12 个提交）

### 阶段一：P0–P3 前置实现（7 个提交，本分支历史）

| 提交 | 内容 |
|------|------|
| `10c9b9201` | JSONL 追加式存储 + FileLock 管理器 |
| `7dac73287` | delta push 机制（version hash） |
| `9e55d30ec` | 网络超时、抖动重试、AsyncLocalStorage 日志 |
| `ef7c9e615` | 诊断报告、feature flags、provider 性能监控 |
| `5ba12ef94` | 启用 deltaStatePush + 版本间隙检测 |
| `2934f1a6a` | 消息截断 + 向上翻页（scroll-up pagination） |
| `d9a0bf343` | webview 重连韧性与 fire-and-forget 事件 |
| `30d034bd5` | ToolUseRow 提取（V11） |
| `a5ba21e58` | Virtuoso itemContent 稳定化 + Footer ThinkingLoader + overscan 缩减 |
| `593a9b808` | 增量分组缓存 + reducer 缓存 + 向上翻页 |

### 阶段二：本轮收尾（5 个提交）

| 提交 | 内容 |
|------|------|
| `e62c5fe8a` | **方案1 补全**：`UserMessage` memo（自定义比较器）+ memo 测试 |
| `59b0b69c5` | **方案3**：高频消息状态拆分 `MessagesStateContext`（`useMessagesState`） |
| `24d635f91` | **方案6**：帧合并调度器 `messageFrameScheduler.ts`（rAF 合并渲染） |
| `6a2c44557` | **方案5**：MermaidBlock/McpResponseDisplay/SearchResultsDisplay 懒加载 + `ChatAskRow` 提取 |
| `b36ffb447` | **构建恢复**：修复 `tsc -b` 严格构建（图标导入、taskHistory 防护、taskId、stories） |
| `a9f83c3dd` | **测试对齐**：`refactoring-flags` 单测与 `deltaStatePush` 默认值同步 |

## 三、V12 六方案完成矩阵

| 方案 | 核心机制 | 关键文件 |
|------|---------|---------|
| 1. 子组件 memo 统一 | `React.memo` + 自定义比较器 | `UserMessage.tsx`, `MessageRenderer.tsx`, `ToolUseRow.tsx`, `MarkdownRow.tsx` |
| 2. 消息列表虚拟化 | `react-virtuoso` + overscan 500/300 + 向上翻页 | `MessagesArea.tsx`, `useScrollBehavior.ts` |
| 3. 细粒度状态订阅 | 双 context：`MessagesStateContext` / `ExtensionStateContext` | `ExtensionStateContext.tsx` |
| 4. 流式增量更新 | delta push + gap-detection 自愈 + 收敛式 reducer | `subscribeToState.ts`, `messageReducer.ts` |
| 5. 组件拆分 + 懒加载 | `React.lazy` + Suspense + `ChatAskRow` 提取 | `ChatAskRow.tsx`, `MarkdownBlock.tsx`, `ChatRow.tsx`, `ToolUseRow.tsx` |
| 6. 高频消息去抖 | 帧合并调度器（FrameCoalescer） | `messageFrameScheduler.ts` |

## 四、测试覆盖（无头测试全绿）

| 套件 | 结果 | 说明 |
|------|------|------|
| webview vitest | **48 文件 / 366 测试全部通过** | 含新增 `UserMessage.memo.test.tsx`(4)、`ChatAskRow.test.tsx`(4)、`messageFrameScheduler.test.ts`(4) |
| 扩展端 bun 单测 | **66 文件 / 1009 测试通过** | 修复 `refactoring-flags.test.ts` 后全绿 |
| webview 严格类型检查 | `tsc -b` 通过 | 修复了 P0–P3 遗留的 6 处类型错误 |
| webview 生产构建 | `bun run build`（tsc -b && vite build）通过 | 6745 模块，单 index.js 7.26MB（inlineDynamicImports） |

新增测试明细：

- `UserMessage.memo.test.tsx`：验证仅回调变化时跳过渲染、内容变化时重渲染
- `ChatAskRow.test.tsx`：followup / plan_mode_respond / new_task / mistake_limit_reached 渲染
- `messageFrameScheduler.test.ts`：帧合并、cancel、flushNow
- `ToolUseRow.test.tsx`：searchFiles 用例改为异步解析懒加载组件

## 五、性能指标对照（设计值）

| 指标 | 目标 | 达成机制 |
|------|------|---------|
| 滚动帧率（100+ 条） | >30fps | Virtuoso 虚拟化：DOM 节点数恒定；overscan 500/300 |
| 首帧渲染 | <500ms | 懒加载延迟重型库初始化；增量分组缓存避免 O(N) 遍历 |
| 流式渲染延迟 | <200ms | 帧合并粒度 16ms，对感知无影响；delta 只传增量 |
| 堆内存 | <200MB | 虚拟化 + 消息截断（上限 50 条窗口 + 向上翻页） |
| 展开/折叠响应 | <50ms | 行级 memo + reducer 引用稳定，Virtuoso DOM 复用 |

## 六、构建与验证命令

```bash
# webview 单测 + 类型检查 + 生产构建
cd apps/vscode/webview-ui
bun run test
bun run build        # tsc -b && vite build

# 扩展端 bun 单测（Windows 需将 bun 真实 .exe 目录加入 PATH）
cd apps/vscode
bun run test:unit
```

## 七、遗留说明

- `vite.config.ts` 的 `inlineDynamicImports: true` 使方案 5 的懒加载不拆分字节，
  收益为延迟初始化；若后续改为代码分割，现有 `React.lazy` 结构可直接生效。
- 方案 3 的 `useExtensionState()` 不再暴露 `clineMessages`/`turnState` 等消息字段，
  新代码请使用 `useMessagesState()` 订阅高频消息状态。
- 端到端（真实扩展宿主 + 长对话）的实测帧率/内存基准建议在 VS Code 中按
  `debug-harness` 流程复核（本报告仅覆盖无头单测、类型检查与构建）。
