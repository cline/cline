# API参考

<cite>
**本文档中引用的文件**  
- [account.proto](file://proto/cline/account.proto)
- [file.proto](file://proto/cline/file.proto)
- [task.proto](file://proto/cline/task.proto)
- [workspace.proto](file://proto/host/workspace.proto)
- [window.proto](file://proto/host/window.proto)
- [anthropic.ts](file://src/core/api/providers/anthropic.ts)
- [openai.ts](file://src/core/api/providers/openai.ts)
- [dify.ts](file://src/api/providers/dify.ts)
- [host-bridge-client-manager.ts](file://src/hosts/external/host-bridge-client-manager.ts)
</cite>

## 目录
1. [gRPC服务接口](#grpc服务接口)
2. [外部AI服务集成](#外部ai服务集成)
3. [VS Code Host Bridge API](#vs-code-host-bridge-api)

## gRPC服务接口

本节基于 `proto/cline/` 目录下的 `.proto` 文件，详细描述了 `AccountService`、`FileService` 和 `TaskService` 三个核心gRPC服务的接口定义。

### AccountService

`AccountService` 提供账户管理与认证状态相关的操作。

#### RPC方法

- **accountLoginClicked**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `String`
  - **描述**: 处理用户点击登录链接的事件。生成安全的nonce，存储于密钥管理中，并在外部浏览器中打开认证URL。

- **accountLogoutClicked**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `Empty`
  - **描述**: 处理用户点击登出按钮的事件。清除API密钥和用户状态。

- **subscribeToAuthStatusUpdate**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `stream AuthState`
  - **描述**: 订阅认证状态更新事件（当认证状态改变时触发）。

- **authStateChanged**
  - **请求类型**: `AuthStateChangedRequest`
  - **响应类型**: `AuthState`
  - **描述**: 处理来自Firebase上下文的认证状态变更。更新全局状态中的用户信息并返回更新后的值。

- **getUserCredits**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `UserCreditsData`
  - **描述**: 获取用户所有信用数据（余额、使用记录、支付记录）。

- **getOrganizationCredits**
  - **请求类型**: `GetOrganizationCreditsRequest`
  - **响应类型**: `OrganizationCreditsData`
  - **描述**: 获取指定组织的信用数据。

- **getUserOrganizations**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `UserOrganizationsResponse`
  - **描述**: 获取用户所属的所有组织信息。

- **setUserOrganization**
  - **请求类型**: `UserOrganizationUpdateRequest`
  - **响应类型**: `Empty`
  - **描述**: 设置用户当前所属的组织。

- **openrouterAuthClicked**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `Empty`
  - **描述**: 触发OpenRouter认证流程。

- **getRedirectUrl**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `String`
  - **描述**: 返回Webview可用来重定向回用户IDE的链接。

#### 消息类型

- **UserInfo**
  - `uid` (string): 用户唯一ID
  - `display_name` (string, 可选): 显示名称
  - `email` (string, 可选): 邮箱
  - `photo_url` (string, 可选): 头像URL
  - `app_base_url` (string, 可选): Cline应用基础URL

- **UserCreditsData**
  - `balance` (UserCreditsBalance): 当前余额
  - `usage_transactions` (repeated UsageTransaction): 使用记录列表
  - `payment_transactions` (repeated PaymentTransaction): 支付记录列表

- **UsageTransaction**
  - `ai_inference_provider_name` (string): AI提供商名称
  - `ai_model_name` (string): 模型名称
  - `ai_model_type_name` (string): 模型类型
  - `completion_tokens` (int32): 完成Token数
  - `cost_usd` (double): 花费（美元）
  - `created_at` (string): 创建时间
  - `credits_used` (double): 消耗积分
  - `generation_id` (string): 生成ID
  - `organization_id` (string): 组织ID
  - `prompt_tokens` (int32): 提示Token数
  - `total_tokens` (int32): 总Token数
  - `user_id` (string): 用户ID

**Section sources**
- [account.proto](file://proto/cline/account.proto#L1-L135)

### FileService

`FileService` 提供与文件操作相关的功能。

#### RPC方法

- **copyToClipboard**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 将文本复制到剪贴板。

- **openFile**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 在编辑器中打开文件。

- **openImage**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 在系统查看器中打开图片。

- **openMention**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 打开提及项（文件、路径、Git提交、问题、终端或URL）。

- **deleteRuleFile**
  - **请求类型**: `RuleFileRequest`
  - **响应类型**: `RuleFile`
  - **描述**: 删除规则文件（全局或工作区）。

- **createRuleFile**
  - **请求类型**: `RuleFileRequest`
  - **响应类型**: `RuleFile`
  - **描述**: 创建规则文件（全局或工作区）。

- **searchCommits**
  - **请求类型**: `StringRequest`
  - **响应类型**: `GitCommits`
  - **描述**: 在工作区中搜索Git提交。

- **selectFiles**
  - **请求类型**: `BooleanRequest`
  - **响应类型**: `StringArrays`
  - **描述**: 从文件系统中选择图片和其他文件，返回数据URL和路径。

- **getRelativePaths**
  - **请求类型**: `RelativePathsRequest`
  - **响应类型**: `RelativePaths`
  - **描述**: 将URIs转换为工作区相对路径。

- **searchFiles**
  - **请求类型**: `FileSearchRequest`
  - **响应类型**: `FileSearchResults`
  - **描述**: 在工作区中进行模糊匹配文件搜索。

- **toggleClineRule**
  - **请求类型**: `ToggleClineRuleRequest`
  - **响应类型**: `ToggleClineRules`
  - **描述**: 切换Cline规则（启用或禁用）。

- **toggleCursorRule**
  - **请求类型**: `ToggleCursorRuleRequest`
  - **响应类型**: `ClineRulesToggles`
  - **描述**: 切换Cursor规则（启用或禁用）。

- **toggleWindsurfRule**
  - **请求类型**: `ToggleWindsurfRuleRequest`
  - **响应类型**: `ClineRulesToggles`
  - **描述**: 切换Windsurf规则（启用或禁用）。

- **refreshRules**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `RefreshedRules`
  - **描述**: 刷新所有规则切换状态（Cline、External和Workflows）。

- **openTaskHistory**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 打开任务的对话历史文件。

- **toggleWorkflow**
  - **请求类型**: `ToggleWorkflowRequest`
  - **响应类型**: `ClineRulesToggles`
  - **描述**: 切换工作流的启用状态。

- **ifFileExistsRelativePath**
  - **请求类型**: `StringRequest`
  - **响应类型**: `BooleanResponse`
  - **描述**: 检查文件是否存在于项目中。

- **openFileRelativePath**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 通过相对路径在编辑器中打开文件。

- **openFocusChainFile**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 打开或创建一个聚焦链检查清单Markdown文件进行编辑。

**Section sources**
- [file.proto](file://proto/cline/file.proto#L1-L186)

### TaskService

`TaskService` 提供任务管理功能。

#### RPC方法

- **cancelTask**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `Empty`
  - **描述**: 取消当前正在运行的任务。

- **clearTask**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `Empty`
  - **描述**: 清除当前任务。

- **getTotalTasksSize**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `Int64`
  - **描述**: 获取所有任务的总大小。

- **deleteTasksWithIds**
  - **请求类型**: `StringArrayRequest`
  - **响应类型**: `Empty`
  - **描述**: 删除指定ID的多个任务。

- **newTask**
  - **请求类型**: `NewTaskRequest`
  - **响应类型**: `Empty`
  - **描述**: 创建一个包含文本和可选图片的新任务。

- **showTaskWithId**
  - **请求类型**: `StringRequest`
  - **响应类型**: `TaskResponse`
  - **描述**: 显示指定ID的任务。

- **exportTaskWithId**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 将指定ID的任务导出为Markdown。

- **toggleTaskFavorite**
  - **请求类型**: `TaskFavoriteRequest`
  - **响应类型**: `Empty`
  - **描述**: 切换任务的收藏状态。

- **getTaskHistory**
  - **请求类型**: `GetTaskHistoryRequest`
  - **响应类型**: `TaskHistoryArray`
  - **描述**: 获取过滤后的任务历史。

- **askResponse**
  - **请求类型**: `AskResponseRequest`
  - **响应类型**: `Empty`
  - **描述**: 发送对先前“ask”操作的响应。

- **taskFeedback**
  - **请求类型**: `StringRequest`
  - **响应类型**: `Empty`
  - **描述**: 记录任务反馈（点赞/点踩）。

- **taskCompletionViewChanges**
  - **请求类型**: `Int64Request`
  - **响应类型**: `Empty`
  - **描述**: 在视图中显示任务完成的变更差异。

- **executeQuickWin**
  - **请求类型**: `ExecuteQuickWinRequest`
  - **响应类型**: `Empty`
  - **描述**: 执行一个快速任务（包含命令和标题）。

- **deleteAllTaskHistory**
  - **请求类型**: `EmptyRequest`
  - **响应类型**: `DeleteAllTaskHistoryCount`
  - **描述**: 删除所有任务历史。

#### 消息类型

- **NewTaskRequest**
  - `metadata` (Metadata): 元数据
  - `text` (string): 任务文本
  - `images` (repeated string): 图片列表
  - `files` (repeated string): 文件列表

- **TaskResponse**
  - `id` (string): 任务ID
  - `task` (string): 任务内容
  - `ts` (int64): 时间戳
  - `is_favorited` (bool): 是否收藏
  - `size` (int64): 大小
  - `total_cost` (double): 总成本
  - `tokens_in` (int32): 输入Token数
  - `tokens_out` (int32): 输出Token数
  - `cache_writes` (int32): 缓存写入次数
  - `cache_reads` (int32): 缓存读取次数

**Section sources**
- [task.proto](file://proto/cline/task.proto#L1-L116)

## 外部AI服务集成

`cline` 通过 `src/core/api/providers/` 目录下的适配器与多种外部AI服务进行通信。

### 集成服务列表

- Anthropic
- OpenAI
- Dify
- Google Gemini
- Mistral
- Ollama
- Together AI
- Hugging Face
- AWS Bedrock
- Azure OpenAI
- 以及其他数十个提供商

### 通信机制

所有AI服务的通信都通过 `src/core/api/providers/` 目录下的TypeScript适配器实现。这些适配器遵循统一的接口，封装了特定于提供商的认证、请求和响应处理逻辑。

#### 认证方式

- **API Key**: 大多数服务（如OpenAI、Anthropic）使用API密钥进行认证。密钥通常通过环境变量或用户设置进行配置。
- **OAuth**: 部分服务（如Google Gemini）可能使用OAuth流程。
- **自定义认证**: 特定服务（如Dify）可能有其独特的认证机制。

#### 请求/响应格式

- **请求格式**: 适配器将标准化的内部请求对象转换为符合目标AI服务API规范的HTTP请求。这通常包括模型名称、提示文本、参数（如temperature、max_tokens）等。
- **响应格式**: 适配器接收原始的HTTP响应（通常是JSON），并将其解析为统一的内部响应格式，以便上层应用处理。

#### 错误处理

- **重试机制**: `src/core/api/retry.ts` 提供了基于指数退避的重试逻辑，用于处理网络错误和临时性服务故障。
- **错误转换**: 适配器将特定于提供商的错误代码和消息转换为应用内部的标准化错误类型。
- **超时**: 所有请求都设置了合理的超时时间，防止长时间挂起。

##### 示例：调用OpenAI

```typescript
// 使用OpenAI适配器
import { OpenAIProvider } from './openai';

const provider = new OpenAIProvider(apiKey);
const response = await provider.createChatCompletion({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

##### 示例：调用Anthropic

```typescript
// 使用Anthropic适配器
import { AnthropicProvider } from './anthropic';

const provider = new AnthropicProvider(apiKey);
const response = await provider.createMessage({
  model: 'claude-3-opus-20240229',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

**Section sources**
- [anthropic.ts](file://src/core/api/providers/anthropic.ts#L1-L50)
- [openai.ts](file://src/core/api/providers/openai.ts#L1-L50)
- [dify.ts](file://src/api/providers/dify.ts#L1-L30)

## VS Code Host Bridge API

`cline` 扩展通过 `hostbridge` 与VS Code的原生功能进行交互。该桥接由 `src/hosts/vscode/hostbridge/` 目录下的客户端和服务器端组件实现。

### 核心服务

#### WorkspaceService

`WorkspaceService` 提供对工作区和项目资源的访问。

- **getWorkspacePaths**
  - **请求**: `GetWorkspacePathsRequest`
  - **响应**: `GetWorkspacePathsResponse`
  - **描述**: 返回工作区的顶级目录列表。
  - **示例**: 获取当前项目根路径。

- **saveOpenDocumentIfDirty**
  - **请求**: `SaveOpenDocumentIfDirtyRequest`
  - **响应**: `SaveOpenDocumentIfDirtyResponse`
  - **描述**: 如果文档已打开且有未保存的更改，则保存该文档。
  - **示例**: 在执行任务前自动保存相关文件。

- **getDiagnostics**
  - **请求**: `GetDiagnosticsRequest`
  - **响应**: `GetDiagnosticsResponse`
  - **描述**: 获取工作区中的诊断信息（如错误、警告）。
  - **示例**: 分析代码问题以提供修复建议。

- **openProblemsPanel**
  - **请求**: `OpenProblemsPanelRequest`
  - **响应**: `OpenProblemsPanelResponse`
  - **描述**: 使问题面板可见并聚焦。
  - **示例**: 引导用户查看编译错误。

- **openInFileExplorerPanel**
  - **请求**: `OpenInFileExplorerPanelRequest`
  - **响应**: `OpenInFileExplorerPanelResponse`
  - **描述**: 在文件资源管理器面板中打开并选择文件或目录。
  - **示例**: 在资源管理器中高亮显示新创建的文件。

- **openClineSidebarPanel**
  - **请求**: `OpenClineSidebarPanelRequest`
  - **响应**: `OpenClineSidebarPanelResponse`
  - **描述**: 打开并聚焦Cline侧边栏面板。
  - **示例**: 显示任务历史或设置。

**Section sources**
- [workspace.proto](file://proto/host/workspace.proto#L1-L93)

#### WindowService

`WindowService` 提供对编辑器窗口和UI元素的控制。

- **showTextDocument**
  - **请求**: `ShowTextDocumentRequest`
  - **响应**: `TextEditorInfo`
  - **描述**: 在IDE编辑器中打开文本文档。
  - **示例**: `showTextDocument({ path: "./src/main.ts" })`

- **showOpenDialogue**
  - **请求**: `ShowOpenDialogueRequest`
  - **响应**: `SelectedResources`
  - **描述**: 显示文件打开对话框。
  - **示例**: 让用户选择要上传的文件。

- **showMessage**
  - **请求**: `ShowMessageRequest`
  - **响应**: `SelectedResponse`
  - **描述**: 显示通知消息。
  - **示例**: `showMessage({ type: "INFORMATION", message: "任务完成！" })`

- **showInputBox**
  - **请求**: `ShowInputBoxRequest`
  - **响应**: `ShowInputBoxResponse`
  - **描述**: 提示用户输入。
  - **示例**: 获取用户对任务的命名。

- **showSaveDialog**
  - **请求**: `ShowSaveDialogRequest`
  - **响应**: `ShowSaveDialogResponse`
  - **描述**: 显示文件保存对话框。
  - **示例**: 让用户选择导出文件的位置。

- **openFile**
  - **请求**: `OpenFileRequest`
  - **响应**: `OpenFileResponse`
  - **描述**: 打开文件。
  - **示例**: `openFile({ file_path: "/path/to/file.txt" })`

- **openSettings**
  - **请求**: `OpenSettingsRequest`
  - **响应**: `OpenSettingsResponse`
  - **描述**: 打开主机设置UI。
  - **示例**: `openSettings({ query: "cline.apiKey" })` 聚焦到Cline API密钥设置。

- **getOpenTabs**
  - **请求**: `GetOpenTabsRequest`
  - **响应**: `GetOpenTabsResponse`
  - **描述**: 返回已打开的标签页。
  - **示例**: 获取当前所有打开的文件路径。

- **getVisibleTabs**
  - **请求**: `GetVisibleTabsRequest`
  - **响应**: `GetVisibleTabsResponse`
  - **描述**: 返回可见的标签页。
  - **示例**: 获取当前编辑器组中可见的文件。

- **getActiveEditor**
  - **请求**: `GetActiveEditorRequest`
  - **响应**: `GetActiveEditorResponse`
  - **描述**: 返回当前活动编辑器的信息。
  - **示例**: 获取当前正在编辑的文件路径。

**Section sources**
- [window.proto](file://proto/host/window.proto#L1-L163)