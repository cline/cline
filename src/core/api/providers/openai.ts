import { Anthropic } from "@anthropic-ai/sdk"
import { azureOpenAiDefaultApiVersion, ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI, { AzureOpenAI } from "openai"
import type { ChatCompletionReasoningEffort } from "openai/resources/chat/completions"
import { estimateTokensFromAnthropicMessages } from "../estimators/tokens"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { getLimiter, makeKey } from "../rate-limit/registry"
import { RetriableError, withRetry } from "../retry"
import { convertToOpenAiMessages, convertToOpenAiResponseInput } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"

interface OpenAiHandlerOptions extends CommonApiHandlerOptions {
	openAiApiKey?: string
	openAiBaseUrl?: string
	azureApiVersion?: string
	openAiHeaders?: Record<string, string>
	openAiModelId?: string
	openAiModelInfo?: OpenAiCompatibleModelInfo
	reasoningEffort?: string
	// Mode-effective rate limits
	rateLimitRpm?: number
	rateLimitTpm?: number
	rateLimitNearThreshold?: number
}

/**
 * Split OpenAI Responses input into batches by input_image parts.
 * Includes all non-image content in every batch, and partitions images across batches.
 * Removes any message entries that become empty after filtering.
 * @internal
 */
export function batchResponseInputByImages(
	fullInput: OpenAI.Responses.ResponseInput,
	maxImagesPerRequest = 10,
): { inputs: OpenAI.Responses.ResponseInput[]; totalImages: number } {
	if (!Array.isArray(fullInput) || maxImagesPerRequest <= 0) {
		return { inputs: [fullInput], totalImages: 0 }
	}

	// Map each input_image to a global index in traversal order
	const imageIndices: { itemIdx: number; partIdx: number; global: number }[] = []
	let global = 0
	for (let itemIdx = 0; itemIdx < fullInput.length; itemIdx++) {
		const item: any = fullInput[itemIdx]
		if (item?.type === "message" && Array.isArray(item.content)) {
			for (let partIdx = 0; partIdx < item.content.length; partIdx++) {
				const part = item.content[partIdx]
				if (part?.type === "input_image") {
					imageIndices.push({ itemIdx, partIdx, global })
					global++
				}
			}
		}
	}

	const totalImages = imageIndices.length
	if (totalImages === 0 || totalImages <= maxImagesPerRequest) {
		return { inputs: [fullInput], totalImages }
	}

	const batches = Math.ceil(totalImages / maxImagesPerRequest)
	const inputs: OpenAI.Responses.ResponseInput[] = []

	for (let b = 0; b < batches; b++) {
		const start = b * maxImagesPerRequest
		const end = Math.min(totalImages, (b + 1) * maxImagesPerRequest)
		const batch: OpenAI.Responses.ResponseInput = []

		for (let i = 0; i < fullInput.length; i++) {
			const entry: any = fullInput[i]

			if (entry?.type === "function_call") {
				// include function calls in every batch
				batch.push({ ...entry })
				continue
			}

			if (entry?.type === "message" && Array.isArray(entry.content)) {
				const newContent: any[] = []
				let contentIdx = 0
				for (const part of entry.content) {
					if (part?.type === "input_image") {
						// include only images that fall into the current batch range
						const idxInfo = imageIndices.find((ii) => ii.itemIdx === i && ii.partIdx === contentIdx)
						if (idxInfo && idxInfo.global >= start && idxInfo.global < end) {
							newContent.push(part)
						}
					} else {
						// Preserve all non-image parts for every batch
						newContent.push(part)
					}
					contentIdx++
				}
				if (newContent.length > 0) {
					const { content, ...rest } = entry
					batch.push({ ...rest, content: newContent })
				}
			} else if (entry) {
				// Any other entry types (future-proof)
				batch.push({ ...entry })
			}
		}

		inputs.push(batch)
	}

	return { inputs, totalImages }
}

export class OpenAiHandler implements ApiHandler {
	private options: OpenAiHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiApiKey) {
				throw new Error("OpenAI API key is required")
			}
			try {
				// Azure API shape slightly differs from the core API shape: https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
				// Use azureApiVersion to determine if this is an Azure endpoint, since the URL may not always contain 'azure.com'
				if (
					this.options.azureApiVersion ||
					((this.options.openAiBaseUrl?.toLowerCase().includes("azure.com") ||
						this.options.openAiBaseUrl?.toLowerCase().includes("azure.us")) &&
						!this.options.openAiModelId?.toLowerCase().includes("deepseek"))
				) {
					this.client = new AzureOpenAI({
						baseURL: this.options.openAiBaseUrl,
						apiKey: this.options.openAiApiKey,
						apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
						defaultHeaders: this.options.openAiHeaders,
					})
				} else {
					this.client = new OpenAI({
						baseURL: this.options.openAiBaseUrl,
						apiKey: this.options.openAiApiKey,
						defaultHeaders: this.options.openAiHeaders,
					})
				}
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.openAiModelId ?? ""
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")
		const isR1FormatRequired = this.options.openAiModelInfo?.isR1FormatRequired ?? false
		const isReasoningModelFamily = modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")
		// Determine whether to use the Responses API strictly by inspecting the configured base URL.
		// This avoids accidentally sending Responses payloads to Chat Completions endpoints.
		const baseUrlLc = (this.options.openAiBaseUrl || "").toLowerCase()
		const isResponseEndpoint =
			/openai\.azure\.com\/openai\/responses/.test(baseUrlLc) || /(^|\/)openai\/responses(\/|$)/.test(baseUrlLc)
		const isResponseModel = isResponseEndpoint

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		let temperature: number | undefined = this.options.openAiModelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		let maxTokens: number | undefined

		if (this.options.openAiModelInfo?.maxTokens && this.options.openAiModelInfo.maxTokens > 0) {
			maxTokens = Number(this.options.openAiModelInfo.maxTokens)
		} else {
			maxTokens = undefined
		}

		if (isDeepseekReasoner || isR1FormatRequired) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		if (isReasoningModelFamily) {
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
			temperature = undefined // does not support temperature
			reasoningEffort = (this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium"
		}

		if (isResponseModel) {
			const resEffort = (this.options.reasoningEffort as ChatCompletionReasoningEffort) ?? "medium"

			// Shared RPM/TPM sliding-window limiter (provider-agnostic)
			let __limiter: any
			try {
				const isAzure =
					!!this.options.azureApiVersion ||
					((this.options.openAiBaseUrl?.toLowerCase().includes("azure.com") ||
						this.options.openAiBaseUrl?.toLowerCase().includes("azure.us")) &&
						!modelId.toLowerCase().includes("deepseek"))
				const providerForLimiter = isAzure ? "azure-openai" : "openai"
				const key = makeKey(providerForLimiter, modelId)

				// Defaults for GPT-5 (Azure defaults provided); allow config/env overrides
				const rpmDefault = 2500
				const tpmDefault = 250000
				const nearDefault = 0.9

				const rpmCfg = Number(this.options.rateLimitRpm)
				const tpmCfg = Number(this.options.rateLimitTpm)
				const thrCfg = Number(this.options.rateLimitNearThreshold)

				const rpmEnv = Number(process.env.AZURE_GPT5_RPM ?? process.env.OPENAI_GPT5_RPM)
				const tpmEnv = Number(process.env.AZURE_GPT5_TPM ?? process.env.OPENAI_GPT5_TPM)
				const thrEnv = Number(process.env.AZURE_GPT5_THRESHOLD ?? process.env.OPENAI_GPT5_THRESHOLD)

				const rpmFinal = Number.isFinite(rpmCfg) ? rpmCfg : Number.isFinite(rpmEnv) ? rpmEnv : rpmDefault
				const tpmFinal = Number.isFinite(tpmCfg) ? tpmCfg : Number.isFinite(tpmEnv) ? tpmEnv : tpmDefault
				const thrFinalRaw = Number.isFinite(thrCfg) ? thrCfg : Number.isFinite(thrEnv) ? thrEnv : nearDefault
				const thrFinal = Math.max(0.01, Math.min(0.99, thrFinalRaw))

				const limits = {
					rpmLimit: rpmFinal,
					tpmLimit: tpmFinal,
					nearThreshold: thrFinal,
					windowMs: 60_000,
				}

				__limiter = getLimiter(key, limits)

				// Throttling will be applied per-batch below
			} catch {}

			// Parse provider-specified cooldowns (headers or body) and convert to seconds for our retry decorator
			const extractRetryAfterSeconds = (error: any): number | undefined => {
				const headers = error?.headers || error?.response?.headers
				const headerVal =
					headers?.["retry-after"] ??
					headers?.["Retry-After"] ??
					headers?.["x-ratelimit-reset"] ??
					headers?.["ratelimit-reset"]
				if (headerVal !== undefined) {
					const n = Number(headerVal)
					if (Number.isFinite(n)) return n // seconds or epoch-seconds; our retry.ts handles epoch seconds too
				}

				// Look for body-provided retry hints (Azure/OpenAI compatible)
				const body = error?.response?.data || error?.error || {}
				const retryAfterMs = body?.retry_after_ms ?? body?.error?.retry_after_ms
				if (retryAfterMs !== undefined && Number.isFinite(Number(retryAfterMs))) {
					return Math.ceil(Number(retryAfterMs) / 1000)
				}
				const retryAfterSec = body?.retry_after ?? body?.error?.retry_after
				if (retryAfterSec !== undefined && Number.isFinite(Number(retryAfterSec))) {
					return Math.ceil(Number(retryAfterSec))
				}

				// Fallback: parse common textual messages e.g. "Rate limit is exceeded. Try again in 4 seconds."
				const msg: string = String(error?.message || "")
				const match =
					msg.match(/try again in\s+(\d+(?:\.\d+)?)\s*seconds?/i) || msg.match(/try again in\s+(\d+(?:\.\d+)?)\s*sec/i)
				if (match) {
					const v = parseFloat(match[1])
					if (!isNaN(v)) return Math.ceil(v)
				}
				return undefined
			}

			try {
				// Build batched inputs by image count (max 10 images/request)
				const baseInput = convertToOpenAiResponseInput(messages)
				const { inputs: batchedInputs, totalImages } = batchResponseInputByImages(baseInput, 10)
				const totalBatches = batchedInputs.length
				// Carry assistant summaries from earlier batches to later batches
				const cumulativeContext: OpenAI.Responses.ResponseInput = []
				let imagesSeenSoFar = 0
				const batchImageCounts: number[] = []

				let cumInputTokens = 0
				let cumOutputTokens = 0
				let cumCacheReadTokens = 0
				let cumCacheWriteTokens = 0

				for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
					const isFinal = batchIndex === totalBatches - 1

					// Per-batch limiter preflight
					try {
						if (__limiter) {
							const estimatedTokens = estimateTokensFromAnthropicMessages(messages, systemPrompt)
							await __limiter.waitIfNeeded(estimatedTokens)
							await __limiter.onRequestStart()
						}
					} catch {}

					const batchCountText = `BATCH ${batchIndex + 1} of ${totalBatches}.`
					const batchInstructions = isFinal
						? `${systemPrompt}\n\nALL_IMAGES_PROVIDED. You received ${totalBatches} image batch(es) in total. Produce the final answer now using all batches and the provided BATCH_NOTES. Use BATCH_SUMMARY and BATCH_NOTES to reason over ALL images (earlier images are not re-sent).`
						: `${systemPrompt}\n\n${batchCountText} You will receive images in multiple batches.\nFor this batch, output ONLY terse carry-forward notes prefixed with "BATCH_NOTES: " that MUST include images_in_batch, images_seen_so_far, total_images, images_remaining, plus key observations. Do NOT produce a final answer yet. Wait until you receive: ALL_IMAGES_PROVIDED.`

					// Compute batch image counts and attach machine-readable metadata for robust cross-batch context
					const imagesInBatch = (() => {
						let c = 0
						for (const item of batchedInputs[batchIndex] as any[]) {
							if (item?.type === "message" && Array.isArray(item.content)) {
								for (const part of item.content) {
									if (part?.type === "input_image") c++
								}
							}
						}
						return c
					})()
					imagesSeenSoFar += imagesInBatch
					batchImageCounts.push(imagesInBatch)
					const meta = {
						total_images: totalImages ?? imagesSeenSoFar,
						batch_index: batchIndex + 1,
						batches_total: totalBatches,
						images_in_batch: imagesInBatch,
						images_seen_so_far: imagesSeenSoFar,
						images_remaining: Math.max(0, (totalImages ?? imagesSeenSoFar) - imagesSeenSoFar),
					}
					const metaMessage: any = {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: `BATCH_META: ${JSON.stringify(meta)}` }],
					}

					// Provide a cumulative batch summary to the model on final batch
					const summary = {
						total_images: totalImages ?? imagesSeenSoFar,
						batches_total: totalBatches,
						batch_counts: batchImageCounts.slice(),
						images_seen_so_far: imagesSeenSoFar,
						images_remaining: Math.max(0, (totalImages ?? imagesSeenSoFar) - imagesSeenSoFar),
					}
					const summaryMessage: any = {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: `BATCH_SUMMARY: ${JSON.stringify(summary)}` }],
					}

					const stream = await client.responses.create({
						model: modelId,
						input: [
							...cumulativeContext,
							metaMessage,
							...(isFinal ? [summaryMessage] : []),
							...batchedInputs[batchIndex],
						],
						instructions: batchInstructions,
						stream: true,
						reasoning: { effort: resEffort },
					})

					let __prevInputTokens = 0
					let __prevOutputTokens = 0
					let lastInputTokens = 0
					let lastOutputTokens = 0
					let lastCacheReadTokens = 0
					let lastCacheWriteTokens = 0
					let hiddenTextBuffer = ""

					for await (const chunk of stream) {
						// Only surface text/reasoning for the final batch
						if (isFinal && chunk.type === "response.output_text.delta" && (chunk as any).delta) {
							yield {
								type: "text",
								text: (chunk as any).delta,
							}
							if ("reasoning_content" in chunk && typeof (chunk as any).reasoning_content === "string") {
								yield {
									type: "reasoning",
									reasoning: (chunk as any).reasoning_content as string,
								}
							}
						} else if (!isFinal && chunk.type === "response.output_text.delta" && (chunk as any).delta) {
							// Capture intermediate notes to feed into the next batch, do not surface to user
							hiddenTextBuffer += (chunk as any).delta
						}

						// Track usage for limiter and aggregate totals (emit once at end)
						const usage = (chunk as any)?.response?.usage ?? (chunk as any)?.usage
						if (usage) {
							const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
							const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0
							try {
								if (__limiter) {
									const totalNow = (inputTokens || 0) + (outputTokens || 0)
									const totalPrev = __prevInputTokens + __prevOutputTokens
									const delta = totalNow - totalPrev
									if (delta > 0) {
										await __limiter.onUsage(delta)
									}
									__prevInputTokens = inputTokens || 0
									__prevOutputTokens = outputTokens || 0
								}
							} catch {}

							lastInputTokens = inputTokens || 0
							lastOutputTokens = outputTokens || 0
							lastCacheReadTokens =
								usage.prompt_tokens_details?.cached_tokens ??
								usage.cached_tokens ??
								usage.cache_read_input_tokens ??
								0
							lastCacheWriteTokens =
								usage.prompt_cache_miss_tokens ?? usage.cache_creation_input_tokens ?? usage.caching_tokens ?? 0
						}
					}

					// After stream ends, add batch totals
					// If this was an intermediate batch, persist captured notes into cumulativeContext
					if (!isFinal && hiddenTextBuffer.trim().length > 0) {
						cumulativeContext.push({
							type: "message",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: hiddenTextBuffer, annotations: [] }],
						} as any)
					}
					cumInputTokens += lastInputTokens
					cumOutputTokens += lastOutputTokens
					cumCacheReadTokens += lastCacheReadTokens
					cumCacheWriteTokens += lastCacheWriteTokens
				}

				// Emit a single combined usage event after all batches complete
				try {
					console.log(
						`[OpenAI Responses] aggregated usage in/out=${cumInputTokens}/${cumOutputTokens} (batches=${totalBatches})`,
					)
				} catch {}
				yield {
					type: "usage",
					inputTokens: cumInputTokens,
					outputTokens: cumOutputTokens,
					cacheReadTokens: cumCacheReadTokens,
					cacheWriteTokens: cumCacheWriteTokens,
				}
			} catch (error: any) {
				// If the provider returns a rate-limit cooldown with a timer, honor it via RetriableError
				const retryAfterSec = extractRetryAfterSeconds(error)
				if (retryAfterSec) {
					throw new RetriableError(error?.message || "Rate limit exceeded", retryAfterSec)
				}
				throw error
			}
		} else {
			const stream = await client.chat.completions.create({
				model: modelId,
				messages: openAiMessages,
				temperature,
				max_tokens: maxTokens,
				reasoning_effort: reasoningEffort,
				stream: true,
				stream_options: { include_usage: true },
			})
			for await (const chunk of stream) {
				const delta = chunk.choices?.[0]?.delta
				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				if (delta && "reasoning_content" in delta && delta.reasoning_content) {
					yield {
						type: "reasoning",
						reasoning: (delta.reasoning_content as string | undefined) || "",
					}
				}

				if (chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
						cacheReadTokens: (chunk.usage as any).prompt_tokens_details?.cached_tokens || 0,
						cacheWriteTokens: (chunk.usage as any).prompt_cache_miss_tokens || 0,
					}
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: this.options.openAiModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}
