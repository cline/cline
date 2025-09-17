# Anthropic API

<cite>
**本文档中引用的文件**
- [anthropic.ts](file://src/core/api/providers/anthropic.ts)
- [api.ts](file://src/shared/api.ts)
- [retry.ts](file://src/core/api/retry.ts)
- [AnthropicProvider.tsx](file://webview-ui/src/components/settings/providers/AnthropicProvider.tsx)
</cite>

## 目录
1. [简介](#简介)
2. [认证与配置](#认证与配置)
3. [请求与响应结构](#请求与响应结构)
4. [消息格式转换](#消息格式转换)
5. [Anthropic特有功能](#anthropic特有功能)
6. [错误处理与重试策略](#错误处理与重试策略)
7. [完整代码示例](#完整代码示例)
8. [与其他提供商的差异](#与其他提供商的差异)

## 简介
cline通过`src/core/api/providers/anthropic.ts`文件与Anthropic服务进行通信，实现了完整的API集成。该集成支持Claude系列模型，包括claude-3-opus-20240229等先进模型，提供了强大的AI功能。本文档详细解释了cline如何与Anthropic服务交互，涵盖了认证机制、请求格式、消息转换、特有功能和错误处理等关键方面。

## 认证与配置
cline使用API密钥对Anthropic服务进行认证。在`AnthropicHandler`类的构造函数中，需要提供API密钥作为选项参数。如果未提供API密钥，`ensureClient`方法会抛出错误。

```typescript
constructor(options: AnthropicHandlerOptions) {
	this.options = options
}

private ensureClient(): Anthropic {
	if (!this.client) {
		if (!this.options.apiKey) {
			throw new Error("Anthropic API key is required")
		}
		// 创建Anthropic客户端
	}
}
```

用户可以在设置界面中配置Anthropic API，包括API密钥和自定义基础URL。系统还支持为不同模式（计划模式和执行模式）配置不同的模型。

**Section sources**
- [anthropic.ts](file://src/core/api/providers/anthropic.ts#L0-L44)
- [AnthropicProvider.tsx](file://webview-ui/src/components/settings/providers/AnthropicProvider.tsx#L38-L74)

## 请求与响应结构
cline向Anthropic API发送的请求遵循特定的JSON结构。对于支持长上下文窗口的模型（如claude-sonnet-4-20250514:1m），请求中会包含特殊的beta头信息。

```typescript
const stream = await client.messages.create(
	{
		model: modelId,
		thinking: reasoningOn ? { type: "enabled", budget_tokens: budget_tokens } : undefined,
		max_tokens: model.info.maxTokens || 8192,
		temperature: reasoningOn ? undefined : 0,
		system: [
			{
				text: systemPrompt,
				type: "text",
				cache_control: { type: "ephemeral" },
			},
		],
		messages: messages.map((message, index) => {
			// 消息处理逻辑
		}),
		stream: true,
	},
	(() => {
		// 1m上下文窗口beta头
		if (enable1mContextWindow) {
			return {
				headers: {
					"anthropic-beta": "context-1m-2025-08-07",
				},
			}
		} else {
			return undefined
		}
	})(),
)
```

响应以流式方式处理，包含多种事件类型，如`message_start`、`content_block_start`、`content_block_delta`等，允许实时处理模型输出。

**Section sources**
- [anthropic.ts](file://src/core/api/providers/anthropic.ts#L46-L150)

## 消息格式转换
cline将内部消息格式转换为Anthropic兼容的格式，包括系统提示、消息历史和工具调用的处理。系统提示被包装在数组中，并可选择性地添加缓存控制。

```typescript
system: [
	{
		text: systemPrompt,
		type: "text",
		cache_control: { type: "ephemeral" },
	},
]
```

对于消息历史，cline会识别最后两个用户消息并标记为临时的，以实现缓存优化。消息内容可以是字符串或包含文本和图像的块数组。

```typescript
messages: messages.map((message, index) => {
	if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
		return {
			...message,
			content:
				typeof message.content === "string"
					? [
							{
								type: "text",
								text: message.content,
								cache_control: {
									type: "ephemeral",
								},
							},
						]
					: message.content.map((content, contentIndex) =>
							contentIndex === message.content.length - 1
								? {
										...content,
										cache_control: {
											type: "ephemeral",
										},
									}
								: content,
						),
		}
	}
	return message
})
```

**Section sources**
- [anthropic.ts](file://src/core/api/providers/anthropic.ts#L70-L140)

## Anthropic特有功能
cline充分利用了Anthropic的高级功能，包括长上下文窗口和高级推理能力。

### 长上下文窗口
通过`CLAUDE_SONNET_4_1M_SUFFIX`常量，cline支持100万token的上下文窗口。当模型ID以`:1m`结尾时，会自动启用`context-1m-2025-08-07` beta头。

```typescript
export const CLAUDE_SONNET_4_1M_SUFFIX = ":1m"
```

用户可以在设置界面中切换200K和1M上下文窗口模型，以平衡性能和成本。

### 高级推理能力
对于支持推理的模型（如包含"3-7"或"4-"的模型ID），cline可以启用扩展思考功能，允许模型在响应前进行更深入的推理。

```typescript
const budget_tokens = this.options.thinkingBudgetTokens || 0
const reasoningOn = !!((modelId.includes("3-7") || modelId.includes("4-")) && budget_tokens !== 0)
```

思考预算令牌可以通过配置进行调整，以控制推理的深度和成本。

**Section sources**
- [api.ts](file://src/shared/api.ts#L780-L782)
- [anthropic.ts](file://src/core/api/providers/anthropic.ts#L58-L65)
- [AnthropicProvider.tsx](file://webview-ui/src/components/settings/providers/AnthropicProvider.tsx#L34-L120)

## 错误处理与重试策略
cline实现了全面的错误处理和重试机制，确保API调用的可靠性。

### 错误处理
当API调用失败时，cline会检查错误类型并提供相应的处理。对于上下文窗口超出错误，系统会返回特定的错误信息。

```typescript
function checkIsAnthropicContextWindowError(response: any): boolean {
	try {
		return response?.error?.error?.type === "invalid_request_error"
	} catch {
		return false
	}
}
```

### 重试策略
使用`@withRetry`装饰器，cline实现了智能重试策略。该策略支持最多3次重试，采用指数退避算法，并可处理429速率限制错误。

```typescript
@withRetry()
async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
	// API调用逻辑
}
```

重试策略会检查`retry-after`、`x-ratelimit-reset`等HTTP头，以确定最佳重试延迟。如果未提供这些头信息，则使用指数退避算法。

```typescript
const retryAfter =
	error.headers?.["retry-after"] ||
	error.headers?.["x-ratelimit-reset"] ||
	error.headers?.["ratelimit-reset"] ||
	error.retryAfter
```

用户还可以通过`onRetryAttempt`回调函数监控重试过程，这对于调试和用户体验优化非常有用。

**Section sources**
- [anthropic.ts](file://src/core/api/providers/anthropic.ts#L46-L47)
- [retry.ts](file://src/core/api/retry.ts#L0-L86)
- [context-error-handling.ts](file://src/core/context/context-management/context-error-handling.ts#L41-L71)

## 完整代码示例
以下是在cline中配置和使用Anthropic API的完整示例：

```typescript
import { AnthropicHandler } from "@core/api/providers/anthropic"
import { ApiConfiguration } from "@shared/api"

// 配置API选项
const apiConfig: ApiConfiguration = {
	apiKey: "your-anthropic-api-key",
	apiModelId: "claude-3-opus-20240229",
	anthropicBaseUrl: "https://api.anthropic.com",
	planModeThinkingBudgetTokens: 32000,
	actModeThinkingBudgetTokens: 16000,
}

// 创建Anthropic处理器
const anthropicHandler = new AnthropicHandler(apiConfig)

// 创建消息
const systemPrompt = "You are a helpful assistant."
const messages = [
	{
		role: "user" as const,
		content: "Hello, how are you?",
	},
]

// 发送请求并处理流式响应
async function sendMessage() {
	const stream = anthropicHandler.createMessage(systemPrompt, messages)
	for await (const chunk of stream) {
		switch (chunk.type) {
			case "text":
				console.log("Received text:", chunk.text)
				break
			case "reasoning":
				console.log("Received reasoning:", chunk.reasoning)
				break
			case "usage":
				console.log("Token usage:", {
					input: chunk.inputTokens,
					output: chunk.outputTokens,
					cacheWrite: chunk.cacheWriteTokens,
					cacheRead: chunk.cacheReadTokens,
				})
				break
		}
	}
}

// 调用函数
sendMessage().catch(console.error)
```

此示例展示了如何配置Anthropic处理器、创建消息并处理流式响应。系统会自动处理认证、重试和错误处理。

**Section sources**
- [anthropic.ts](file://src/core/api/providers/anthropic.ts#L46-L233)

## 与其他提供商的差异
cline的Anthropic集成与其他提供商相比具有几个显著特点：

1. **长上下文窗口支持**：通过`:1m`后缀和beta头，Anthropic是唯一支持100万token上下文窗口的提供商。

2. **扩展思考功能**：Anthropic的推理功能允许模型在响应前进行深度思考，这在其他提供商中不常见。

3. **缓存控制**：Anthropic的`cache_control`功能允许精细控制消息缓存，优化性能和成本。

4. **流式响应结构**：Anthropic的流式响应包含详细的事件类型，如`thinking`和`redacted_thinking`，提供了更丰富的中间状态信息。

5. **模型特定功能**：不同Claude模型具有不同的功能集，如`claude-3-opus-20240229`支持4096个最大令牌，而其他模型支持8192个。

这些差异使得Anthropic集成在处理复杂任务和长文档时具有独特优势。

**Section sources**
- [anthropic.ts](file://src/core/api/providers/anthropic.ts#L0-L246)
- [api.ts](file://src/shared/api.ts#L780-L782)