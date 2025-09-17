# SAP AI Core API

<cite>
**本文档中引用的文件**  
- [sapaicore.ts](file://src/core/api/providers/sapaicore.ts)
- [getSapAiCoreModels.ts](file://src/core/controller/models/getSapAiCoreModels.ts)
- [SapAiCoreProvider.tsx](file://webview-ui/src/components/settings/providers/SapAiCoreProvider.tsx)
</cite>

## 目录
1. [简介](#简介)
2. [认证机制与配置方法](#认证机制与配置方法)
3. [请求与响应结构](#请求与响应结构)
4. [模型列表管理](#模型列表管理)
5. [企业级功能](#企业级功能)
6. [错误处理与网络配置](#错误处理与网络配置)
7. [完整代码示例](#完整代码示例)
8. [集成价值](#集成价值)

## 简介
cline 是一个集成开发环境扩展，通过 `src/core/api/providers/sapaicore.ts` 文件与 SAP AI Core 平台进行通信。该文档详细说明了 cline 如何利用 SAP AI Core 提供的 API 调用部署在平台上的机器学习模型，并涵盖认证、配置、请求/响应结构、模型管理、企业级功能、错误处理等方面的内容。

**Section sources**
- [sapaicore.ts](file://src/core/api/providers/sapaicore.ts#L0-L1043)

## 认证机制与配置方法
cline 使用 OAuth 2.0 客户端凭证（Client Credentials）流程进行身份验证。用户需在配置中提供以下信息：
- **AI Core Client Id**：SAP AI Core 客户端 ID
- **AI Core Client Secret**：SAP AI Core 客户端密钥
- **AI Core Base URL**：SAP AI Core 基础 URL
- **AI Core Auth URL**：SAP AI Core 认证 URL
- **AI Core Resource Group**：资源组名称

这些凭据通过 `SapAiCoreHandler` 类的 `authenticate()` 方法发送至 `/oauth/token` 端点以获取访问令牌。令牌具有有效期，系统会在过期后自动重新获取。

配置界面由 `SapAiCoreProvider.tsx` 实现，允许用户输入上述参数并动态加载可用模型。

**Section sources**
- [sapaicore.ts](file://src/core/api/providers/sapaicore.ts#L321-L380)
- [getSapAiCoreModels.ts](file://src/core/controller/models/getSapAiCoreModels.ts#L0-L39)
- [SapAiCoreProvider.tsx](file://webview-ui/src/components/settings/providers/SapAiCoreProvider.tsx#L128-L189)

## 请求与响应结构
cline 支持多种模型类型（如 Anthropic、OpenAI、Gemini），每种模型类型的请求结构略有不同。

### Anthropic 模型请求示例（JSON）
```json
{
  "inferenceConfig": {
    "maxTokens": 8192,
    "temperature": 0.0
  },
  "system": [
    { "text": "You are a helpful assistant." },
    { "cachePoint": { "type": "default" } }
  ],
  "messages": [
    {
      "role": "user",
      "content": [
        { "text": "Hello, how are you?" },
        { "cachePoint": { "type": "default" } }
      ]
    },
    {
      "role": "assistant",
      "content": [
        { "text": "I'm doing well, thank you!" }
      ]
    }
  ]
}
```

### OpenAI 模型请求示例（JSON）
```json
{
  "stream": true,
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello, how are you?" }
  ],
  "max_tokens": 8192,
  "temperature": 0.0,
  "stream_options": { "include_usage": true }
}
```

### 响应流处理
响应以流式方式处理，支持文本和用量信息：
```json
{ "type": "text", "text": "Partial response..." }
{ "type": "usage", "inputTokens": 100, "outputTokens": 50 }
```

**Section sources**
- [sapaicore.ts](file://src/core/api/providers/sapaicore.ts#L484-L750)

## 模型列表管理
cline 通过 `getSapAiCoreModels.ts` 文件中的 `getSapAiCoreModels()` 函数获取 SAP AI Core 上的可用模型列表。

流程如下：
1. 使用提供的凭据调用 `getToken()` 获取访问令牌。
2. 使用令牌向 `/v2/lm/deployments` 发起 GET 请求，获取所有运行中的部署。
3. 过滤出 `targetStatus` 为 "RUNNING" 的部署，并提取模型名称和版本。
4. 检查是否存在 `scenarioId` 为 "orchestration" 的部署，以确定是否支持编排模式。
5. 返回包含模型名称、部署 ID 和编排可用性的响应。

前端组件 `SapAiCoreModelPicker` 显示这些模型供用户选择。

**Section sources**
- [getSapAiCoreModels.ts](file://src/core/controller/models/getSapAiCoreModels.ts#L41-L147)
- [SapAiCoreProvider.tsx](file://webview-ui/src/components/settings/providers/SapAiCoreProvider.tsx#L98-L126)

## 企业级功能
SAP AI Core 提供以下企业级功能：

### 模型治理
- **编排模式（Orchestration Mode）**：启用后可访问所有可用模型，无需单独部署。此功能通过 `OrchestrationClient` 实现，使用 `llm` 和 `templating` 配置定义管道。
- **资源组隔离**：通过 `AI-Resource-Group` 头部实现多租户资源隔离。

### 审计与追踪
- 所有 API 请求均包含 `AI-Client-Type: Cline` 标识，便于审计。
- 请求日志记录在客户端和服务端，支持故障排查。

### 缓存支持
- 对于 Claude 4 等支持缓存的模型，cline 在消息末尾添加 `cachePoint` 以启用提示缓存，提升性能并降低成本。

**Section sources**
- [sapaicore.ts](file://src/core/api/providers/sapaicore.ts#L484-L534)
- [SapAiCoreProvider.tsx](file://webview-ui/src/components/settings/providers/SapAiCoreProvider.tsx#L148-L164)

## 错误处理与网络配置
### 错误处理
- **404 错误**：返回详细的错误信息，如 `404 Not Found: ${error.response.data}`。
- **无响应错误**：当请求发出但未收到响应时，抛出“服务器未返回响应”错误。
- **请求设置错误**：捕获并报告请求配置问题。

### 网络配置要求
- 必须能够访问 SAP AI Core 的 Base URL 和 Token URL。
- 需要支持 HTTPS 和流式响应（`responseType: "stream"`）。
- 推荐配置超时和重试机制以应对网络波动。

**Section sources**
- [sapaicore.ts](file://src/core/api/providers/sapaicore.ts#L728-L750)

## 完整代码示例
以下是一个在 cline 中配置和使用 SAP AI Core API 的简化示例：

```typescript
// 创建处理器实例
const handler = new SapAiCoreHandler({
  sapAiCoreClientId: "your-client-id",
  sapAiCoreClientSecret: "your-client-secret",
  sapAiCoreTokenUrl: "https://your-auth-url",
  sapAiCoreBaseUrl: "https://your-api-url",
  sapAiResourceGroup: "default",
  apiModelId: "anthropic--claude-3.5-sonnet",
  sapAiCoreUseOrchestrationMode: true
});

// 发起流式请求
for await (const chunk of handler.createMessage("You are a helpful assistant.", [
  { role: "user", content: "Hello, how are you?" }
])) {
  if (chunk.type === "text") {
    console.log(chunk.text);
  } else if (chunk.type === "usage") {
    console.log(`Tokens: ${chunk.inputTokens} in, ${chunk.outputTokens} out`);
  }
}
```

**Section sources**
- [sapaicore.ts](file://src/core/api/providers/sapaicore.ts#L0-L1043)

## 集成价值
在企业 SAP 环境中集成 SAP AI Core API 具有以下价值：
- **统一 AI 平台**：集中管理所有 AI 模型和部署，确保合规性和安全性。
- **无缝开发体验**：开发者可在 IDE 内直接调用企业级 AI 模型，提升生产力。
- **治理与审计**：通过资源组、编排模式和日志记录实现严格的模型访问控制和操作审计。
- **成本优化**：利用提示缓存等功能降低推理成本。
- **灵活扩展**：支持多种模型供应商（Anthropic、OpenAI、Gemini），便于未来扩展。

**Section sources**
- [sapaicore.ts](file://src/core/api/providers/sapaicore.ts#L0-L1043)
- [getSapAiCoreModels.ts](file://src/core/controller/models/getSapAiCoreModels.ts#L0-L149)
- [SapAiCoreProvider.tsx](file://webview-ui/src/components/settings/providers/SapAiCoreProvider.tsx#L0-L261)