import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import OpenAI from "openai"
import type {
	ChatCompletionChunk as OpenAIChatCompletionChunk,
	ChatCompletionTool as OpenAITool,
} from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import { createVercelAIGatewayStream } from "../transform/vercel-ai-gateway-stream"

interface VercelAIGatewayHandlerOptions extends CommonApiHandlerOptions {
	vercelAiGatewayApiKey?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	reasoningEffort?: string
	thinkingBudgetTokens?: number
}

export class VercelAIGatewayHandler implements ApiHandler {
	private options: VercelAIGatewayHandlerOptions
	private client: OpenAI | undefined
	private activeStreamAbortController: AbortController | undefined
	private activeStreamDebugId: string | undefined
	private static readonly debugLogPath =
		process.env.CLINE_VAG_DEBUG_LOG_PATH || path.join(os.homedir(), ".cline", "logs", "vercel-ai-gateway-debug.log")
	private static readonly trailingUsageIdleTimeoutMs = (() => {
		const raw = process.env.CLINE_VAG_TRAILING_USAGE_IDLE_TIMEOUT_MS
		if (raw === undefined) {
			return 1000
		}
		const parsed = Number.parseInt(raw, 10)
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1000
	})()
	private debugLogWriteQueue: Promise<void> = Promise.resolve()
	private didWarnDebugLogWriteFailure = false

	constructor(options: VercelAIGatewayHandlerOptions) {
		this.options = options
	}

	private appendDebugLogLine(line: string): void {
		this.debugLogWriteQueue = this.debugLogWriteQueue
			.then(async () => {
				await fs.mkdir(path.dirname(VercelAIGatewayHandler.debugLogPath), { recursive: true })
				await fs.appendFile(VercelAIGatewayHandler.debugLogPath, `${line}\n`, "utf8")
			})
			.catch((error) => {
				if (!this.didWarnDebugLogWriteFailure) {
					this.didWarnDebugLogWriteFailure = true
					Logger.debug(
						`[VercelAIGateway][${new Date().toISOString()}] failed writing debug file ${
							VercelAIGatewayHandler.debugLogPath
						}: ${error}`,
					)
				}
			})
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.vercelAiGatewayApiKey) {
				const line = `[VercelAIGateway][${new Date().toISOString()}] ensureClient failed: missing API key`
				Logger.debug(line)
				this.appendDebugLogLine(line)
				throw new Error("Vercel AI Gateway API key is required")
			}
			try {
				const line = `[VercelAIGateway][${new Date().toISOString()}] creating OpenAI client for Vercel AI Gateway`
				Logger.debug(line)
				this.appendDebugLogLine(line)
				this.client = createOpenAIClient({
					baseURL: "https://ai-gateway.vercel.sh/v1",
					apiKey: this.options.vercelAiGatewayApiKey,
					defaultHeaders: {
						"http-referer": "https://cline.bot",
						"x-title": "Cline",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Vercel AI Gateway client: ${error.message}`)
			}
		} else {
			const line = `[VercelAIGateway][${new Date().toISOString()}] reusing existing OpenAI client`
			Logger.debug(line)
			this.appendDebugLogLine(line)
		}
		return this.client
	}

	abort(): void {
		const linePrefix = `[VercelAIGateway][${new Date().toISOString()}][${this.activeStreamDebugId ?? "no-active-stream"}]`
		if (!this.activeStreamAbortController) {
			const line = `${linePrefix} abort called but no active stream controller`
			Logger.debug(line)
			this.appendDebugLogLine(line)
			return
		}
		if (this.activeStreamAbortController.signal.aborted) {
			const line = `${linePrefix} abort called but controller already aborted`
			Logger.debug(line)
			this.appendDebugLogLine(line)
			return
		}
		this.activeStreamAbortController.abort()
		const line = `${linePrefix} abort called -> controller.abort()`
		Logger.debug(line)
		this.appendDebugLogLine(line)
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const streamDebugId = `vag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		const startTimeMs = Date.now()
		const timestamp = () => new Date().toISOString()
		const elapsedMs = () => Date.now() - startTimeMs
		const logDebug = (message: string) => {
			const line = `[VercelAIGateway][${timestamp()}][${streamDebugId}][+${elapsedMs()}ms] ${message}`
			Logger.debug(line)
			this.appendDebugLogLine(line)
		}
		logDebug(`debug log file path=${VercelAIGatewayHandler.debugLogPath}`)

		const client = this.ensureClient()
		const model = this.getModel()
		const modelId = model.id
		const modelInfo = model.info
		const skipReasoning = shouldSkipReasoningForModel(this.options.openRouterModelId)

		logDebug(
			`createMessage start model=${modelId} messages=${messages.length} tools=${tools?.length || 0} reasoningEffort=${
				this.options.reasoningEffort ?? "unset"
			} thinkingBudgetTokens=${this.options.thinkingBudgetTokens ?? "unset"} skipReasoning=${skipReasoning}`,
		)
		logDebug(`systemPromptLength=${systemPrompt.length}`)

		try {
			logDebug("creating Vercel AI Gateway stream")
			const stream = await createVercelAIGatewayStream(
				client,
				systemPrompt,
				messages,
				{ id: modelId, info: modelInfo },
				this.options.reasoningEffort,
				this.options.thinkingBudgetTokens,
				tools,
			)
			const streamWithController = stream as typeof stream & { controller?: AbortController }
			this.activeStreamAbortController = streamWithController.controller
			this.activeStreamDebugId = streamDebugId
			logDebug("stream created")
			logDebug(
				`stream controller available=${!!this.activeStreamAbortController} trailingUsageIdleTimeoutMs=${
					VercelAIGatewayHandler.trailingUsageIdleTimeoutMs
				}`,
			)
			let didOutputUsage = false
			let chunkCount = 0
			let usageChunkCount = 0
			let usageEmittedOnChunk: number | undefined
			let usageSeenAfterEmit = 0
			let textChunkCount = 0
			let toolCallChunkCount = 0
			let reasoningChunkCount = 0
			let reasoningDetailsChunkCount = 0
			let streamLoopCompletedNaturally = false
			let forcedTailIdleTimeout = false
			let tailIdleTimeoutHitCount = 0
			let hasStreamedResponseContent = false
			let lastChunkReceivedAt = Date.now()

			const toolCallProcessor = new ToolCallProcessor()

			try {
				const iterator = stream[Symbol.asyncIterator]()
				while (true) {
					const shouldApplyTailIdleTimeout =
						VercelAIGatewayHandler.trailingUsageIdleTimeoutMs > 0 && hasStreamedResponseContent && !didOutputUsage

					let nextChunkResult: IteratorResult<OpenAIChatCompletionChunk> | undefined
					if (shouldApplyTailIdleTimeout) {
						let timeoutHandle: ReturnType<typeof setTimeout> | undefined
						const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
							timeoutHandle = setTimeout(
								() => resolve({ kind: "timeout" }),
								VercelAIGatewayHandler.trailingUsageIdleTimeoutMs,
							)
						})
						const nextPromise = iterator.next().then(
							(result) => ({ kind: "next" as const, result }),
							(error) => ({ kind: "error" as const, error }),
						)

						const winner: Awaited<typeof nextPromise> | { kind: "timeout" } = await Promise.race([
							nextPromise,
							timeoutPromise,
						])
						if (timeoutHandle) {
							clearTimeout(timeoutHandle)
						}

						if (winner.kind === "timeout") {
							forcedTailIdleTimeout = true
							tailIdleTimeoutHitCount += 1
							const idleForMs = Date.now() - lastChunkReceivedAt
							logDebug(
								`tail idle timeout fired after waiting ${VercelAIGatewayHandler.trailingUsageIdleTimeoutMs}ms for next chunk (idleForMs=${idleForMs}) hasStreamedResponseContent=${hasStreamedResponseContent} didOutputUsage=${didOutputUsage}`,
							)

							if (this.activeStreamAbortController && !this.activeStreamAbortController.signal.aborted) {
								this.activeStreamAbortController.abort()
								logDebug("tail idle timeout forced stream controller abort")
							} else if (!this.activeStreamAbortController) {
								logDebug("tail idle timeout could not abort stream: controller unavailable")
							} else {
								logDebug("tail idle timeout found stream controller already aborted")
							}

							void nextPromise.then((lateResult) => {
								if (lateResult.kind === "error") {
									logDebug(
										`post-timeout pending next() settled with error=${lateResult.error?.message || lateResult.error}`,
									)
								} else {
									logDebug(
										`post-timeout pending next() settled done=${lateResult.result.done} (ignored after forced timeout termination)`,
									)
								}
							})

							break
						}

						if (winner.kind === "error") {
							throw winner.error
						}
						nextChunkResult = winner.result
					} else {
						nextChunkResult = await iterator.next()
					}

					if (nextChunkResult.done) {
						streamLoopCompletedNaturally = true
						break
					}
					const chunk = nextChunkResult.value
					lastChunkReceivedAt = Date.now()
					chunkCount += 1
					const choice = chunk.choices?.[0]
					const delta = choice?.delta
					const hasUsage = !!chunk.usage
					const deltaKeys = delta ? Object.keys(delta).join(",") || "none" : "none"
					logDebug(
						`chunk#${chunkCount} id=${chunk.id ?? "none"} choices=${chunk.choices?.length ?? 0} finishReason=${
							choice?.finish_reason ?? "none"
						} hasDelta=${!!delta} deltaKeys=${deltaKeys} hasUsage=${hasUsage}`,
					)

					if (delta?.content) {
						textChunkCount += 1
						hasStreamedResponseContent = true
						logDebug(`chunk#${chunkCount} text length=${delta.content.length}`)
						yield {
							type: "text",
							text: delta.content,
						}
					}

					if (delta?.tool_calls) {
						toolCallChunkCount += 1
						hasStreamedResponseContent = true
						const toolCallSummary = delta.tool_calls
							.map((toolCall: any) => {
								const fnName = toolCall.function?.name || "unknown"
								const argsLength = toolCall.function?.arguments?.length || 0
								return `${toolCall.index}:${toolCall.id || "no-id"}:${fnName}:argsLen=${argsLength}`
							})
							.join("|")
						logDebug(`chunk#${chunkCount} tool_calls count=${delta.tool_calls.length} summary=${toolCallSummary}`)
						yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
					}

					// Reasoning tokens are returned separately from the content
					// Skip reasoning content for models that don't support it (e.g., devstral, grok-4)
					if (delta && "reasoning" in delta && delta.reasoning) {
						const reasoningText =
							typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning)
						logDebug(
							`chunk#${chunkCount} reasoning present length=${reasoningText.length} ${
								skipReasoning ? "skipped=true" : "skipped=false"
							}`,
						)
						if (!skipReasoning) {
							reasoningChunkCount += 1
							hasStreamedResponseContent = true
							yield {
								type: "reasoning",
								reasoning: reasoningText,
							}
						}
					}

					// Reasoning details that can be passed back in API requests to preserve reasoning traces
					const reasoningDetails = delta && "reasoning_details" in delta ? delta.reasoning_details : undefined
					if (reasoningDetails && Array.isArray(reasoningDetails) && reasoningDetails.length > 0) {
						logDebug(
							`chunk#${chunkCount} reasoning_details present count=${reasoningDetails.length} ${
								skipReasoning ? "skipped=true" : "skipped=false"
							}`,
						)
						if (!skipReasoning) {
							reasoningDetailsChunkCount += 1
							hasStreamedResponseContent = true
							yield {
								type: "reasoning",
								reasoning: "",
								details: reasoningDetails,
							}
						}
					}

					if (chunk.usage) {
						usageChunkCount += 1
						const promptTokens = chunk.usage.prompt_tokens || 0
						const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
						const completionTokens = chunk.usage.completion_tokens || 0
						const gatewayUsage = chunk.usage as typeof chunk.usage & {
							cost?: number
							cost_details?: {
								upstream_inference_cost?: number
							}
						}
						const chunkCost = gatewayUsage.cost || 0
						const upstreamCost = gatewayUsage.cost_details?.upstream_inference_cost || 0
						const totalCost = chunkCost + upstreamCost
						const inputTokens = promptTokens - cachedTokens

						logDebug(
							`chunk#${chunkCount} usage prompt=${promptTokens} cached=${cachedTokens} input=${inputTokens} output=${completionTokens} cost=${chunkCost} upstreamCost=${upstreamCost} totalCost=${totalCost} didOutputUsage=${didOutputUsage}`,
						)

						if (!didOutputUsage) {
							yield {
								type: "usage",
								cacheWriteTokens: 0,
								cacheReadTokens: cachedTokens,
								inputTokens,
								outputTokens: completionTokens,
								totalCost,
							}
							didOutputUsage = true
							usageEmittedOnChunk = chunkCount
							logDebug(`usage emitted from chunk#${chunkCount}`)
						} else {
							usageSeenAfterEmit += 1
							logDebug(
								`usage seen again on chunk#${chunkCount} but skipped because didOutputUsage already true (usageSeenAfterEmit=${usageSeenAfterEmit})`,
							)
						}
					}
				}
			} finally {
				logDebug(
					`stream loop exit completedNaturally=${streamLoopCompletedNaturally} forcedTailIdleTimeout=${forcedTailIdleTimeout} tailIdleTimeoutHitCount=${tailIdleTimeoutHitCount} chunks=${chunkCount} textChunks=${textChunkCount} toolCallChunks=${toolCallChunkCount} reasoningChunks=${reasoningChunkCount} reasoningDetailsChunks=${reasoningDetailsChunkCount} usageChunkCount=${usageChunkCount} usageEmittedOnChunk=${usageEmittedOnChunk ?? "none"} usageSeenAfterEmit=${usageSeenAfterEmit} didOutputUsage=${didOutputUsage}`,
				)
				if (this.activeStreamDebugId === streamDebugId) {
					this.activeStreamAbortController = undefined
					this.activeStreamDebugId = undefined
				}
			}

			logDebug(
				`stream completed forcedTailIdleTimeout=${forcedTailIdleTimeout} chunks=${chunkCount} textChunks=${textChunkCount} toolCallChunks=${toolCallChunkCount} reasoningChunks=${reasoningChunkCount} reasoningDetailsChunks=${reasoningDetailsChunkCount} usageChunkCount=${usageChunkCount} usageEmittedOnChunk=${usageEmittedOnChunk ?? "none"} usageSeenAfterEmit=${usageSeenAfterEmit} didOutputUsage=${didOutputUsage}`,
			)

			if (!didOutputUsage) {
				Logger.warn("Vercel AI Gateway did not provide usage information in stream")
				logDebug(`no usage chunk emitted by stream forcedTailIdleTimeout=${forcedTailIdleTimeout}`)
			}
		} catch (error: any) {
			logDebug(`stream failed message=${error?.message || "unknown"} after ${elapsedMs()}ms`)
			Logger.error("Vercel AI Gateway error details:", error)
			Logger.error("Error stack:", error.stack)
			this.appendDebugLogLine(`[VercelAIGateway][${new Date().toISOString()}][${streamDebugId}] error=${error?.message}`)
			throw new Error(`Vercel AI Gateway error: ${error.message}`)
		} finally {
			if (this.activeStreamDebugId === streamDebugId) {
				this.activeStreamAbortController = undefined
				this.activeStreamDebugId = undefined
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			const line = `[VercelAIGateway][${new Date().toISOString()}] getModel using configured model id=${modelId} maxTokens=${
				modelInfo.maxTokens ?? "unset"
			}`
			Logger.debug(line)
			this.appendDebugLogLine(line)
			return { id: modelId, info: modelInfo }
		}
		// If we have a model ID but no model info, preserve the selected model ID
		// and fall back only the metadata to defaults.
		if (modelId) {
			const line = `[VercelAIGateway][${new Date().toISOString()}] getModel using configured model id=${modelId} with default model info`
			Logger.debug(line)
			this.appendDebugLogLine(line)
			return { id: modelId, info: openRouterDefaultModelInfo }
		}
		const line = `[VercelAIGateway][${new Date().toISOString()}] getModel falling back to defaults id=${openRouterDefaultModelId}`
		Logger.debug(line)
		this.appendDebugLogLine(line)
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
