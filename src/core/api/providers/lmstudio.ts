import type { Anthropic } from "@anthropic-ai/sdk"
import { toolParamNames } from "@core/assistant-message"
import { type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { toolUseNames } from "@shared/tools"
import OpenAI from "openai"
import type { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { ApiStream } from "../transform/stream"

interface LmStudioHandlerOptions extends CommonApiHandlerOptions {
	lmStudioBaseUrl?: string
	lmStudioModelId?: string
	lmStudioMaxTokens?: string
}

export class LmStudioHandler implements ApiHandler {
	private options: LmStudioHandlerOptions
	private client: OpenAI | undefined

	constructor(options: LmStudioHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			try {
				this.client = new OpenAI({
					// LM Studio Developer Server (OpenAI-compatible)
					baseURL: new URL("api/v0", this.options.lmStudioBaseUrl || "http://localhost:1234").toString(),
					apiKey: "noop",
				})
			} catch (error) {
				throw new Error(`Error creating LM Studio client: ${(error as Error).message}`)
			}
		}
		return this.client
	}

	@withRetry({ retryAllErrors: true })
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Advertise Cline tools to OpenAI-compatible servers (enables GPT-OSS style tool calls)
		const openAiTools = (toolUseNames || []).map((name) => ({
			type: "function" as const,
			function: {
				name,
				description: `Cline tool ${name}`,
				parameters: {
					type: "object",
					properties: Object.fromEntries(
						toolParamNames.map((p) => [
							p,
							{
								anyOf: [
									{ type: "string" },
									{ type: "number" },
									{ type: "boolean" },
									{ type: "object" },
									{ type: "array" },
								],
							},
						]),
					),
					additionalProperties: true,
				},
			},
		}))

		try {
			const stream = await client.chat.completions.create({
				model: this.getModel().id,
				messages: openAiMessages,
				stream: true,
				stream_options: { include_usage: true },
				tools: openAiTools as any,
				tool_choice: "auto",
				max_completion_tokens: this.options.lmStudioMaxTokens ? Number(this.options.lmStudioMaxTokens) : undefined,
			})

			// Accumulate tool_call deltas and convert to Cline XML-like tool blocks
			const pendingToolCalls = new Map<number, { name?: string; args: string }>()
			const escapeXml = (s: string) =>
				(s ?? "")
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;")
					.replace(/'/g, "&#39;")

			const buildToolUseXml = (name: string, argsText: string): string => {
				let xmlParams = ""
				let includeRawArgs = false
				try {
					const parsed = argsText ? JSON.parse(argsText) : {}
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						const knownParamSet = new Set(toolParamNames as readonly string[])
						const unknown: Record<string, unknown> = {}
						for (const [k, v] of Object.entries(parsed)) {
							if (knownParamSet.has(k)) {
								const valStr = typeof v === "string" ? (v as string) : JSON.stringify(v)
								xmlParams += `<${k}>${escapeXml(valStr)}</${k}>`
							} else {
								unknown[k] = v
							}
						}
						if (Object.keys(unknown).length > 0) {
							includeRawArgs = true
							xmlParams += `<arguments>${escapeXml(JSON.stringify(unknown))}</arguments>`
						}
					} else {
						includeRawArgs = true
					}
				} catch {
					includeRawArgs = true
				}
				if (includeRawArgs && !xmlParams.includes("<arguments>")) {
					xmlParams += `<arguments>${escapeXml(argsText || "")}</arguments>`
				}
				return `<${name}>${xmlParams}</${name}>`
			}

			const flushPendingToolCalls = (): string => {
				if (pendingToolCalls.size === 0) return ""
				const parts: string[] = []
				Array.from(pendingToolCalls.entries())
					.sort((a, b) => a[0] - b[0])
					.forEach(([, rec]) => {
						if (rec.name) {
							parts.push(buildToolUseXml(rec.name, rec.args || ""))
						}
					})
				pendingToolCalls.clear()
				return parts.join("")
			}

			for await (const chunk of stream as any) {
				const choice = chunk?.choices?.[0]
				const delta: any = choice?.delta || {}

				// Stream normal text
				if (typeof delta.content === "string" && delta.content.length > 0) {
					yield { type: "text", text: delta.content }
				}

				// Stream reasoning (OpenAI: reasoning_content; GPT-OSS/LM Studio: reasoning)
				if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
					yield { type: "reasoning", reasoning: delta.reasoning_content }
				}
				if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
					yield { type: "reasoning", reasoning: delta.reasoning }
				}

				// Accumulate OpenAI tool_calls deltas
				if (Array.isArray(delta.tool_calls)) {
					for (const tc of delta.tool_calls) {
						const idx = typeof tc.index === "number" ? tc.index : 0
						const prev = pendingToolCalls.get(idx) || { name: undefined, args: "" }
						const fn = (tc as any).function ?? tc
						if (typeof fn?.name === "string" && fn.name) prev.name = fn.name
						if (typeof fn?.arguments === "string") {
							prev.args += fn.arguments
						} else if (fn?.arguments !== undefined) {
							try {
								prev.args += JSON.stringify(fn.arguments)
							} catch {}
						}
						pendingToolCalls.set(idx, prev)
					}
				}

				// Some servers stream `tools` instead of `tool_calls`
				if (Array.isArray((delta as any)?.tools)) {
					for (const t of (delta as any).tools) {
						const idx = typeof t.index === "number" ? t.index : 0
						const prev = pendingToolCalls.get(idx) || { name: undefined, args: "" }
						const fn = (t as any).function ?? t
						if (typeof fn?.name === "string" && fn.name) prev.name = fn.name
						if (typeof fn?.arguments === "string") {
							prev.args += fn.arguments
						} else if (fn?.arguments !== undefined) {
							try {
								prev.args += JSON.stringify(fn.arguments)
							} catch {}
						}
						pendingToolCalls.set(idx, prev)
					}
				}

				// Legacy OpenAI function_call delta
				if (delta?.function_call) {
					const prev = pendingToolCalls.get(0) || { name: undefined, args: "" }
					if (typeof delta.function_call.name === "string" && delta.function_call.name) {
						prev.name = delta.function_call.name
					}
					if (typeof delta.function_call.arguments === "string") {
						prev.args += delta.function_call.arguments
					} else if (delta.function_call.arguments !== undefined) {
						try {
							prev.args += JSON.stringify(delta.function_call.arguments)
						} catch {}
					}
					pendingToolCalls.set(0, prev)
				}

				// Flush when model indicates tool_calls/function_call completion
				const finish = choice?.finish_reason
				if ((finish === "tool_calls" || finish === "function_call") && pendingToolCalls.size > 0) {
					const toEmit = flushPendingToolCalls()
					if (toEmit) yield { type: "text", text: toEmit }
				}

				// Usage accounting
				if (chunk?.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					}
				}
			}

			// Final flush (in case no explicit finish_reason was provided)
			{
				const toEmit = flushPendingToolCalls()
				if (toEmit) yield { type: "text", text: toEmit }
			}
		} catch {
			// LM Studio often doesn't include detailed error bodies yet
			throw new Error(
				"Please check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Cline's prompts. Alternatively, try enabling Compact Prompt in your settings when working with a limited context window.",
			)
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const info = { ...openAiModelInfoSaneDefaults }
		const maxTokens = Number(this.options.lmStudioMaxTokens)
		if (!Number.isNaN(maxTokens)) {
			info.contextWindow = maxTokens
		}
		return {
			id: this.options.lmStudioModelId || "",
			info,
		}
	}
}
