# VS Code 插件调试指南

## 1. 调试环境配置

### 1.1 launch.json 配置
在项目的 `.vscode/launch.json` 中添加以下配置：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "npm: watch"
    },
    {
      "name": "Extension Tests",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--extensionTestsPath=${workspaceFolder}/out/test/suite/index"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "npm: watch"
    }
  ]
}
```

### 1.2 tasks.json 配置
在 `.vscode/tasks.json` 中添加：

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "problemMatcher": "$tsc-watch",
      "isBackground": true,
      "presentation": {
        "reveal": "never"
      },
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

## 2. 断点调试方法

### 2.1 源代码断点
1. 在 `src/core/Cline.ts` 中设置断点：
```typescript
// 示例断点位置
class Cline {
  async startTask(task?: string, images?: string[]): Promise<void> {
    // 在这里设置断点
    debugger; // 也可以使用 debugger 语句
    this.clineMessages = [];
    this.apiConversationHistory = [];
    // ...
  }
}
```

### 2.2 关键调试点
1. 任务初始化
```typescript
// src/core/Cline.ts
constructor(
  provider: ClineProvider,
  apiConfiguration: ApiConfiguration,
  // ...
) {
  // 设置断点观察初始化过程
  debugger;
}
```

2. 消息处理
```typescript
// 消息处理断点
async recursivelyMakeClineRequests(
  userContent: UserContent,
  includeFileDetails: boolean = false,
): Promise<boolean> {
  // 设置断点观察消息处理流程
  debugger;
}
```

3. 工具执行
```typescript
// 工具执行断点
async executeCommandTool(command: string): Promise<[boolean, string]> {
  // 设置断点观察工具执行过程
  debugger;
}
```

## 3. 调试技巧

### 3.1 使用 VS Code 调试控制台
1. 启动调试
   - 按 F5 或点击调试面板中的"开始调试"
   - 选择 "Extension" 配置

2. 调试控制
   - F5: 继续
   - F10: 单步跳过
   - F11: 单步进入
   - Shift+F11: 单步跳出
   - F9: 切换断点

### 3.2 观察变量
1. 在调试视图中观察：
   - Local: 局部变量
   - Watch: 监视表达式
   - Call Stack: 调用栈
   - Breakpoints: 断点列表

2. 添加监视表达式：
```typescript
// 示例监视表达式
this.apiConversationHistory.length
this.clineMessages
this.currentStreamingContentIndex
```

### 3.3 条件断点
在代码行号右键，选择"添加条件断点"：

```typescript
// 条件断点示例
this.consecutiveMistakeCount >= 3
this.isStreaming === true
this.abort === true
```

## 4. 常见调试场景

### 4.1 任务生命周期调试
```typescript
// 设置断点观察任务状态变化
async startTask() { /* 断点 */ }
async resumeTaskFromHistory() { /* 断点 */ }
async abortTask() { /* 断点 */ }
```

### 4.2 消息流调试
```typescript
// 观察消息流转
async say() { /* 断点 */ }
async ask() { /* 断点 */ }
async presentAssistantMessage() { /* 断点 */ }
```

### 4.3 工具调用调试
```typescript
// 工具调用流程
async handleToolExecution() { /* 断点 */ }
async validateToolParams() { /* 断点 */ }
async processToolResult() { /* 断点 */ }
```

## 5. 日志调试

### 5.1 添加日志点
在代码中添加日志：

```typescript
console.log('[Cline]', 'Task started:', { taskId: this.taskId });
console.debug('[Tool]', 'Executing command:', command);
console.error('[Error]', 'API request failed:', error);
```

### 5.2 使用 VS Code 输出面板
1. 查看输出
   - 在输出面板选择 "Cline Extension"
   - 过滤日志信息

2. 保存日志
   - 右键输出面板
   - 选择"保存输出"

## 6. 性能调试

### 6.1 使用 Performance API
```typescript
// 添加性能标记
performance.mark('taskStart');
// ... 执行任务
performance.mark('taskEnd');
performance.measure('taskDuration', 'taskStart', 'taskEnd');
```

### 6.2 内存泄漏调试
1. 使用 Chrome DevTools
2. 观察内存使用
3. 分析内存快照

## 7. 故障排除

### 7.1 常见问题
1. 断点不命中
   - 检查源映射配置
   - 确认代码已编译
   - 重新启动调试会话

2. 调试器断开连接
   - 检查 launch.json 配置
   - 确认 VS Code 版本兼容性
   - 清理缓存并重新启动

### 7.2 调试清单
- [ ] 确认 TypeScript 编译正确
- [ ] 验证源映射配置
- [ ] 检查断点位置
- [ ] 确认调试配置正确
- [ ] 验证扩展激活事件 