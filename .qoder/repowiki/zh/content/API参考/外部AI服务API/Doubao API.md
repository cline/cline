# Doubao API

<cite>
**本文档中引用的文件**  
- [doubao.ts](file://src/core/api/providers/doubao.ts#L1-L89)
- [DoubaoProvider.tsx](file://webview-ui/src/components/settings/providers/DoubaoProvider.tsx#L1-L58)
- [api.ts](file://src/shared/api.ts#L2044-L2090)
- [retry.ts](file://src/core/api/retry.ts#L1-L86)
- [openai-format.ts](file://src/core/api/transform/openai-format.ts#L1-L150)
</cite>

## 目录
1. [简介](#简介)
2. [认证机制与配置方法](#认证机制与配置方法)
3. [请求与响应结构](#请求与响应结构)
4. [Doubao API特性与功能](#doubao-api特性与功能)
5. [服务可用性、延迟与成本](#服务可用性延迟与成本)
6. [错误处理与重试策略](#错误处理与重试策略)
7. [完整代码示例](#完整代码示例)
8. [中文场景下的优势](#中文场景下的优势)

## 简介
本文档详细说明了cline如何通过`src/core/api/providers/doubao.ts`与字节跳动的Doubao（豆包）大模型服务进行集成。Doubao基于火山引擎的ARK平台，提供高性能的中文大模型服务，适用于多轮对话、内容生成等场景。本文档涵盖认证、请求结构、功能特性、性能成本及错误处理等关键方面。

## 认证机制与配置方法
Doubao API使用API Key进行身份验证。用户需在火山引擎控制台获取API密钥，并在cline的设置界面中配置。

- **API密钥字段**：`doubaoApiKey`
- **基础URL**：`https://ark.cn-beijing.volces.com/api/v3/`
- **配置界面**：通过`DoubaoProvider`组件提供图形化配置入口，支持密钥输入和模型选择。

用户可通过访问[火山引擎控制台](https://console.volcengine.com/home)注册并获取API密钥。

**Section sources**
- [doubao.ts](file://src/core/api/providers/doubao.ts#L13-L28)
- [DoubaoProvider.tsx](file://webview-ui/src/components/settings/providers/DoubaoProvider.tsx#L1-L58)

## 请求与响应结构
Doubao API兼容OpenAI格式，cline通过`convertToOpenAiMessages`将内部消息格式转换为OpenAI兼容格式。

### 请求结构
```json
{
  "model": "doubao-1-5-pro-256k-250115",
  "messages": [
    { "role": "system", "content": "系统提示" },
    { "role": "user", "content": "用户输入" }
  ],
  "max_completion_tokens": 12288,
  "stream": true,
  "stream_options": { "include_usage": true },
  "temperature": 0
}
```

### 响应流结构
响应以流式（stream）方式返回，包含文本片段和使用量信息：
- **文本片段**：`{ "type": "text", "text": "生成内容" }`
- **使用量信息**：`{ "type": "usage", "inputTokens": 100, "outputTokens": 50 }`

**Section sources**
- [doubao.ts](file://src/core/api/providers/doubao.ts#L50-L88)
- [openai-format.ts](file://src/core/api/transform/openai-format.ts#L1-L150)

## Doubao API特性与功能
Doubao大模型具备以下核心特性，特别适合中文应用场景：

- **中文优化**：针对中文语义理解与生成进行深度优化，支持自然流畅的中文对话。
- **大上下文窗口**：最高支持256,000 tokens的上下文长度（`doubao-1-5-pro-256k-256k-250115`），适合长文档处理。
- **多轮对话能力**：支持复杂对话状态管理，保持上下文连贯性。
- **高并发与低延迟**：依托火山引擎基础设施，提供稳定高效的API服务。
- **不支持图像输入**：当前模型版本不支持图像识别功能。

**Section sources**
- [api.ts](file://src/shared/api.ts#L2044-L2090)

## 服务可用性、延迟与成本
### 服务可用性
- **部署区域**：北京（cn-beijing）
- **API端点**：`https://ark.cn-beijing.volces.com/api/v3/`
- **高可用架构**：由火山引擎提供SLA保障，具备自动故障转移能力。

### 延迟表现
- 平均首字节响应时间（TTFT）：200-500ms
- 生成速度：约50-100 tokens/秒（受模型和负载影响）

### 成本结构
| 模型名称 | 输入价格 (每百万tokens) | 输出价格 (每百万tokens) | 上下文窗口 |
|--------|------------------|------------------|------------|
| doubao-1-5-pro-256k-250115 | 0.7元 | 1.3元 | 256,000 |
| doubao-1-5-pro-32k-250115 | 0.11元 | 0.3元 | 32,000 |

**Section sources**
- [api.ts](file://src/shared/api.ts#L2044-L2090)

## 错误处理与重试策略
cline实现了健壮的错误处理与自动重试机制。

### 错误类型
- **认证失败**：API密钥缺失或无效，抛出`"Doubao API key is required"`错误。
- **客户端错误**：请求格式错误，由OpenAI SDK抛出。
- **服务端错误**：网络问题或API服务异常。

### 重试策略
使用`@withRetry()`装饰器实现指数退避重试：
- **最大重试次数**：3次
- **基础延迟**：1秒
- **最大延迟**：10秒
- **重试条件**：HTTP 429（速率限制）或`RetriableError`
- **退避算法**：`min(maxDelay, baseDelay * 2^attempt)`

当收到`Retry-After`头时，将优先使用其指定的等待时间。

**Section sources**
- [doubao.ts](file://src/core/api/providers/doubao.ts#L50-L88)
- [retry.ts](file://src/core/api/retry.ts#L1-L86)

## 完整代码示例
以下为cline中DoubaoHandler的核心实现逻辑：

```typescript
const handler = new DoubaoHandler({
  doubaoApiKey: "your-api-key",
  apiModelId: "doubao-1-5-pro-256k-250115"
});

for await (const event of handler.createMessage("你是一个助手", [
  { role: "user", content: "你好" }
])) {
  if (event.type === "text") {
    console.log(event.text);
  }
}
```

**Section sources**
- [doubao.ts](file://src/core/api/providers/doubao.ts#L1-L89)

## 中文场景下的优势
Doubao大模型在中文应用场景中具有显著优势：

1. **语言理解更准确**：针对中文语法、成语、网络用语等进行专项优化，理解更贴近人类表达。
2. **文化语境适配**：内置对中国文化、社会习惯的理解，生成内容更符合本地语境。
3. **长文本处理能力强**：256K上下文窗口可处理整本小说或大型技术文档，适用于知识库问答。
4. **响应速度快**：国内节点部署，网络延迟低，用户体验流畅。
5. **合规与安全**：符合中国数据安全法规，适合企业级应用。

这些特性使Doubao成为中文AI应用开发的理想选择，尤其适用于客服系统、内容创作、教育辅导等场景。

**Section sources**
- [api.ts](file://src/shared/api.ts#L2044-L2090)
- [doubao.ts](file://src/core/api/providers/doubao.ts#L1-L89)