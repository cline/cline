# V21 实施报告 — 历史分页回弹修复、历史对话计费显示修复、Auto Compact 阈值用户可配置

> 承接 V20（webview chunk 循环依赖修复，空白面板定论）。V21 完成三件事：
> ① 历史消息上拉加载回弹修复；② 历史对话计费显示失效（$0.00）根因修复；
> ③ Auto Compact 触发阈值从硬编码 90% 改为用户可配置（设置页 50-100%）。

---

## 一、任务总览

| 优先级 | 问题 | 根因 | 修复状态 |
|:---|:---|:---|:---|
| 🔴 P0 | 问题2：历史对话计费显示失效（$0.00） | `readPersistedMessagesFile` V18 默认 `limit:50` → `isTruncated=false` → 分页永不触发 → 50 条外消息（含 `api_req_started` 计费行）不可达；次因 `mergeMessagesBatch` Phase 3 无条件替换 | ✅ 全量读取恢复（limit 改显式 opt-in）+ seq 新鲜度守卫回归 |
| 🟡 P1 | 问题1：历史消息上拉加载回弹 | `MessagesArea` 缺稳定 key / prepend 后滚动定位失败 | ✅ 稳定 task key + `computeItemKey` + prepend 不滚底 + in-flight 锁 |
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

## 四、🟡 P1：问题3 — Auto Compact 阈值用户可配置

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

## 五、验证状态

| 项 | 结果 |
|:---|:---|
| SDK 类型检查（`bunx tsc --noEmit` @cline/core） | ✅ |
| SDK 单测 global-settings / compaction（核心） | ✅ 14 + 56 全绿 |
| 扩展端类型检查（`bunx tsc --noEmit`） | ✅ |
| 扩展端单测 cline-session-factory / sdk-compaction / sdk-session-config-builder | ✅ 57 + 5 + 3 全绿 |
| webview 类型检查 | ✅ |
| webview 单测 FeatureSettingsSection | ✅ 14 全绿 |
| webview 构建（`bun run build:webview`） | ✅ 32.86s |
| 扩展 bundle（`bun esbuild.mjs`） | ✅ `compactionTriggerRatio`/`autoCompactThreshold` 已入包 |
| `vsce package` 全流程（prepublish: check-types + webview build + lint + esbuild --production） | ✅ 52 files / 8,338,172 B |
| 真实 VSCodium 启动 e2e | ⚠️ 扩展宿主正常激活（`saoudrizwan.claude-dev` onLanguage 激活，exthost 日志零错误）；Playwright `firstWindow()` 在本机持续超时（环境性窗口捕获问题，V20 时可用），未取得 webview 页面级断言 |

> 注：`@cline/core` 全量 `test:unit` 的 20 项失败（hub/daemon、hook-file-hooks、
> runtime-builder 等）为**既有失败**（stash 后复跑同样失败），与本轮改动无关。

---

## 六、产物

- 打包：`apps/vscode/dist/cline-v21-auto-compact-threshold.vsix`（8,338,172 B，52 files）
- 验收：vsce 全流程（类型检查 + lint + webview 构建 + 生产 bundle）通过；
  VSCodium 实启动扩展激活无错误；webview 页面级 e2e 待环境恢复窗口捕获后复跑
