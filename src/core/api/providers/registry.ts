import { providers } from "@cline/llms"
import type { ClineContent, ClineImageContentBlock, ClineStorageMessage, ClineTextContentBlock } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { SELECTOR_SEPARATOR } from "@/shared/vsCodeSelectorUtils"
import { VsCodeLmHandler } from "./vscode-lm"

export const VSCODE_LM_SELECTOR_HEADER = "x-cline-vscode-lm-selector"

let createHandlersPatched = false
let vscodeLmProviderRegistered = false
let originalCreateHandler: ((config: providers.ProviderConfig) => providers.ApiHandler) | undefined
let originalCreateHandlerAsync: ((config: providers.ProviderConfig) => Promise<providers.ApiHandler>) | undefined
const extensionProviderFactories = new Map<string, (config: providers.ProviderConfig) => providers.ApiHandler>()

function ensureProvidersCreateHandlerPatched() {
	if (createHandlersPatched) {
		return
	}
	const mutableProviders = providers as typeof providers & {
		createHandler: (config: providers.ProviderConfig) => providers.ApiHandler
		createHandlerAsync: (config: providers.ProviderConfig) => Promise<providers.ApiHandler>
	}

	originalCreateHandler = mutableProviders.createHandler.bind(providers)
	originalCreateHandlerAsync = mutableProviders.createHandlerAsync.bind(providers)

	mutableProviders.createHandler = (config: providers.ProviderConfig): providers.ApiHandler => {
		const extensionFactory = extensionProviderFactories.get(config.providerId)
		if (extensionFactory) {
			return extensionFactory(config)
		}
		if (!originalCreateHandler) {
			throw new Error("LLMS createHandler has not been initialized")
		}
		return originalCreateHandler(config)
	}

	mutableProviders.createHandlerAsync = async (config: providers.ProviderConfig): Promise<providers.ApiHandler> => {
		const extensionFactory = extensionProviderFactories.get(config.providerId)
		if (extensionFactory) {
			return extensionFactory(config)
		}
		if (!originalCreateHandlerAsync) {
			throw new Error("LLMS createHandlerAsync has not been initialized")
		}
		return originalCreateHandlerAsync(config)
	}

	createHandlersPatched = true
}

function normalizeImageMediaType(mediaType: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
	switch (mediaType) {
		case "image/jpeg":
		case "image/png":
		case "image/gif":
		case "image/webp":
			return mediaType
		default:
			return "image/png"
	}
}

function toClineContentBlock(block: providers.ContentBlock): ClineContent {
	switch (block.type) {
		case "text":
			return { type: "text", text: block.text }
		case "image":
			return {
				type: "image",
				source: {
					type: "base64",
					media_type: normalizeImageMediaType(block.mediaType),
					data: block.data,
				},
			}
		case "file":
			return {
				type: "text",
				text: `File: ${block.path}\n${block.content}`,
			}
		case "tool_use":
			return {
				type: "tool_use",
				id: block.id,
				name: block.name,
				input: block.input,
			}
		case "tool_result":
			return {
				type: "tool_result",
				tool_use_id: block.tool_use_id,
				content:
					typeof block.content === "string"
						? block.content
						: block.content.map((contentBlock): ClineTextContentBlock | ClineImageContentBlock => {
								switch (contentBlock.type) {
									case "text":
										return { type: "text", text: contentBlock.text }
									case "image":
										return {
											type: "image",
											source: {
												type: "base64",
												media_type: normalizeImageMediaType(contentBlock.mediaType),
												data: contentBlock.data,
											},
										}
									case "file":
										return { type: "text", text: `File: ${contentBlock.path}\n${contentBlock.content}` }
									default: {
										const exhaustiveCheck: never = contentBlock
										throw new Error(
											`Unsupported provider tool_result content block type: ${JSON.stringify(exhaustiveCheck)}`,
										)
									}
								}
							}),
				is_error: block.is_error,
			}
		case "thinking":
			return {
				type: "thinking",
				thinking: block.thinking,
				signature: block.signature ?? "",
			}
		case "redacted_thinking":
			return {
				type: "redacted_thinking",
				data: block.data,
			}
		default: {
			const exhaustiveCheck: never = block
			throw new Error(`Unsupported provider content block type: ${JSON.stringify(exhaustiveCheck)}`)
		}
	}
}

function toClineMessages(messages: providers.Message[]): ClineStorageMessage[] {
	return messages.map((message) => {
		if (typeof message.content === "string") {
			return {
				role: message.role,
				content: message.content,
			}
		}

		return {
			role: message.role,
			content: message.content.map((block) => toClineContentBlock(block)),
		}
	})
}

function parseVsCodeLmSelector(modelId?: string): Record<string, string> | undefined {
	if (!modelId) {
		return undefined
	}
	const parts = modelId.split(SELECTOR_SEPARATOR).filter(Boolean)
	if (parts.length === 0) {
		return undefined
	}
	const [vendor, family, version, id] = parts
	const selector: Record<string, string> = {}
	if (vendor) {
		selector.vendor = vendor
	}
	if (family) {
		selector.family = family
	}
	if (version) {
		selector.version = version
	}
	if (id) {
		selector.id = id
	}
	return Object.keys(selector).length > 0 ? selector : undefined
}

function toRegisteredModelInfo(modelId: string, modelInfo: ReturnType<VsCodeLmHandler["getModel"]>["info"]): providers.ModelInfo {
	const capabilities: providers.ModelInfo["capabilities"] = []
	if (modelInfo.supportsImages) {
		capabilities.push("images")
	}
	if (modelInfo.supportsPromptCache) {
		capabilities.push("prompt-cache")
	}
	if (modelInfo.supportsReasoning) {
		capabilities.push("reasoning")
	}
	if (modelInfo.supportsGlobalEndpoint) {
		capabilities.push("global-endpoint")
	}

	return {
		id: modelId,
		name: modelInfo.name,
		description: modelInfo.description,
		maxTokens: modelInfo.maxTokens,
		contextWindow: modelInfo.contextWindow,
		temperature: modelInfo.temperature,
		capabilities: capabilities.length > 0 ? capabilities : undefined,
		pricing:
			modelInfo.inputPrice !== undefined ||
			modelInfo.outputPrice !== undefined ||
			modelInfo.cacheWritesPrice !== undefined ||
			modelInfo.cacheReadsPrice !== undefined
				? {
						input: modelInfo.inputPrice,
						output: modelInfo.outputPrice,
						cacheWrite: modelInfo.cacheWritesPrice,
						cacheRead: modelInfo.cacheReadsPrice,
					}
				: undefined,
		thinkingConfig: modelInfo.thinkingConfig
			? {
					maxBudget: modelInfo.thinkingConfig.maxBudget,
					outputPrice: modelInfo.thinkingConfig.outputPrice,
					thinkingLevel: modelInfo.thinkingConfig.geminiThinkingLevel,
				}
			: undefined,
	}
}

export function ensureVsCodeLmProviderRegistered() {
	if (vscodeLmProviderRegistered) {
		return
	}
	ensureProvidersCreateHandlerPatched()

	extensionProviderFactories.set("vscode-lm", (config: providers.ProviderConfig): providers.ApiHandler => {
		const selectorFromHeader = config?.headers?.[VSCODE_LM_SELECTOR_HEADER]
		let selector: Record<string, string> | undefined

		if (selectorFromHeader) {
			try {
				selector = JSON.parse(selectorFromHeader)
			} catch {
				selector = undefined
			}
		}
		selector = selector ?? parseVsCodeLmSelector(config?.modelId)

		const handler = new VsCodeLmHandler({
			vsCodeLmModelSelector: selector,
		})

		return {
			getMessages: (systemPrompt: string, messages: providers.Message[]) => ({
				systemPrompt,
				messages: toClineMessages(messages),
			}),
			createMessage: (
				systemPrompt: string,
				messages: providers.Message[],
				_tools?: providers.ToolDefinition[],
			): providers.ApiStream =>
				handler.createMessage(systemPrompt, toClineMessages(messages)) as unknown as providers.ApiStream,
			getModel: () => {
				const model = handler.getModel()
				return {
					id: model.id,
					info: toRegisteredModelInfo(model.id, model.info),
				}
			},
		}
	})

	vscodeLmProviderRegistered = true
	Logger.debug("Registered extension provider handler for vscode-lm")
}
