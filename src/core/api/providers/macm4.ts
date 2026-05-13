/**
 * MacM4LocalAgent provider.
 *
 * A first-class Cline provider for the local LiteLLM proxy at
 * https://github.com/martinfr-certifyos/MacM4LocalAgent. Two reasons
 * this exists alongside the generic openai-compatible provider:
 *
 *   1. Pre-baked model catalogue. The MacM4 stack exposes a fixed,
 *      well-known set of tiers (local-fast, local-long, claude-*,
 *      hybrid-auto). Hard-coding their context windows + capabilities
 *      means Cline's ContextManager truncates at the right threshold
 *      without an extra /model/info round-trip per session.
 *
 *   2. Direct backend access. For local-long traffic we can talk
 *      straight to Ollama on :11434, bypassing the LiteLLM callback
 *      pipeline (~5-10ms per turn and one fewer process to debug).
 *      Falls back to the proxy at :4000 for all other tiers so the
 *      router + cost tracking still works.
 *
 * Wiring:
 *   - User picks "macm4" provider in the Cline model picker.
 *   - User picks a tier from MACM4_TIERS below.
 *   - For local-long: chat completions stream directly via the
 *     OpenAI-compatible Ollama endpoint.
 *   - For everything else: chat completions stream through the
 *     LiteLLM proxy, which handles routing, cost tracking, and
 *     over-generation control.
 */

import type { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

/**
 * Canonical MacM4 tier identifiers and their static metadata. Kept in
 * sync with config/litellm-config.yaml and the M7 dashboard
 * /api/macm4-models endpoint -- update all three in lockstep when
 * adding or renaming a tier.
 */
export const MACM4_TIERS = {
	"local-fast": {
		contextWindow: 16_384,
		maxTokens: 6144,
		isLocal: true,
		backend: "mlx" as const,
		description: "Qwen2.5-Coder-7B on MLX (Apple Silicon GPU). ~70 tok/s, free.",
	},
	"local-long": {
		contextWindow: 131_072,
		maxTokens: 6144,
		isLocal: true,
		backend: "ollama" as const,
		description: "Qwen3-Coder-Next 80B on Ollama + TurboQuant. ~12 tok/s, free, 131K ctx.",
	},
	"local-agent": {
		contextWindow: 131_072,
		maxTokens: 6144,
		isLocal: true,
		backend: "ollama" as const,
		description:
			"Qwen3-Coder-Next 80B on Ollama — same model as local-long, tuned for Cline agentic tasks (thinking mode, low temp).",
	},
	"claude-haiku-4-5": {
		contextWindow: 200_000,
		maxTokens: 8192,
		isLocal: false,
		backend: "anthropic" as const,
		description: "Anthropic Haiku 4.5 ($1 / $5 per Mtok).",
		inputPrice: 1.0,
		outputPrice: 5.0,
	},
	"claude-sonnet-4-6": {
		contextWindow: 200_000,
		maxTokens: 8192,
		isLocal: false,
		backend: "anthropic" as const,
		description: "Anthropic Sonnet 4.6 ($3 / $15 per Mtok).",
		inputPrice: 3.0,
		outputPrice: 15.0,
	},
	"claude-opus-4-7": {
		contextWindow: 1_000_000,
		maxTokens: 8192,
		isLocal: false,
		backend: "anthropic" as const,
		description: "Anthropic Opus 4.7 ($5 / $25 per Mtok).",
		inputPrice: 5.0,
		outputPrice: 25.0,
	},
	"claude-code": {
		contextWindow: 1_000_000,
		maxTokens: 8192,
		isLocal: false,
		backend: "anthropic" as const,
		description: "Default Claude tier (currently Opus 4.7).",
		inputPrice: 5.0,
		outputPrice: 25.0,
	},
	"hybrid-auto": {
		contextWindow: 1_000_000,
		maxTokens: 8192,
		isLocal: false,
		backend: "litellm-router" as const,
		description: "Router decides per-prompt; cheapest tier that fits.",
	},
} as const

export type MacM4TierId = keyof typeof MACM4_TIERS

export const macm4DefaultModelId: MacM4TierId = "hybrid-auto"

/**
 * Real Ollama model tags for tiers with backend === "ollama".
 * These are the names Ollama's /v1/chat/completions endpoint actually
 * accepts -- NOT the litellm-config alias names (e.g. "local-long").
 * Override per-instance via MacM4HandlerOptions.macm4OllamaModelTag.
 *
 * local-agent intentionally uses the same 80B Qwen3 model as local-long.
 * The 8B llama3.1 model cannot reliably follow Cline's multi-step XML
 * tool-call schema; 80B is the minimum for agentic tasks.
 */
const OLLAMA_DEFAULT_TAGS: Partial<Record<MacM4TierId, string>> = {
	"local-long": "qwen3-coder-next:q4_K_M",
	"local-agent": "qwen3-coder-next:q4_K_M",
}

export interface MacM4HandlerOptions extends CommonApiHandlerOptions {
	/** LiteLLM proxy base URL. Defaults to http://127.0.0.1:4000. */
	macm4BaseUrl?: string
	/** Optional API key (proxy is loopback-only so this is usually unset). */
	macm4ApiKey?: string
	/** Canonical tier id. Defaults to hybrid-auto. */
	macm4ModelId?: MacM4TierId | string
	/** Direct Ollama URL for the local-long bypass. Defaults to http://127.0.0.1:11434. */
	macm4OllamaBaseUrl?: string
	/** When true (default), local-long routes directly to Ollama, bypassing the proxy. */
	macm4UseDirectOllama?: boolean
	/**
	 * Ollama model tag to use for direct-Ollama tiers (local-long, local-agent).
	 * Defaults to OLLAMA_DEFAULT_TAGS[tierId]. Set this if you pull a different
	 * quantisation or want to point at a different model entirely.
	 */
	macm4OllamaModelTag?: string
	/** Per-request timeout in ms. Defaults to 300s (local long-context runs can be slow). */
	requestTimeoutMs?: number
}

const DEFAULT_PROXY_URL = "http://127.0.0.1:4000"
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000

/**
 * Prepended to the system prompt for every local-model request.
 * Cline's built-in system prompt already defines the XML tool schema in
 * full, but small/mid-size models tend to omit required parameters or
 * generate malformed tags. This preamble locks in four concrete rules:
 *   1. Every tool call must contain ALL required XML child elements.
 *   2. Never emit an empty tag for a required parameter.
 *   3. Only one tool call per reply (Cline processes them sequentially).
 *   4. Plain text thinking/reasoning BEFORE the opening tool tag is fine;
 *      do NOT put any text after the closing tool tag.
 *
 * Placed BEFORE the Cline system prompt so the model sees the constraint
 * first; the detailed schema that follows then reinforces it.
 */
const LOCAL_TOOL_CALL_PREAMBLE = `\
TOOL-USE RULES (MANDATORY — read before anything else):
1. When you call a tool you MUST include EVERY required XML child element with a non-empty value.
   Missing or empty required parameters cause a hard error and waste the user's time.
2. Emit at most ONE tool call per reply. Place it at the very end of your response.
3. Do NOT put any text after the closing tool tag.
4. If you do not yet have enough information to fill every required parameter,
   ask for it using <ask_followup_question><question>…your question here…</question></ask_followup_question>.
   The <question> element is REQUIRED and must never be empty.

`

function tierMeta(id: string): (typeof MACM4_TIERS)[MacM4TierId] | undefined {
	return MACM4_TIERS[id as MacM4TierId]
}

/**
 * Build the OpenAI-shaped ModelInfo Cline expects for any MacM4 tier.
 * Returns sensible defaults for unknown ids so a typo or stale
 * config doesn't break the handler.
 */
function modelInfoFor(tierId: string): ModelInfo {
	const meta = tierMeta(tierId)
	if (!meta) {
		return {
			contextWindow: 128_000,
			maxTokens: 4096,
			supportsImages: false,
			supportsPromptCache: false,
		}
	}
	return {
		contextWindow: meta.contextWindow,
		maxTokens: meta.maxTokens,
		supportsImages: !meta.isLocal,
		supportsPromptCache: !meta.isLocal,
		inputPrice: "inputPrice" in meta ? meta.inputPrice : 0,
		outputPrice: "outputPrice" in meta ? meta.outputPrice : 0,
	}
}

export class MacM4Handler implements ApiHandler {
	private options: MacM4HandlerOptions
	private proxyClient: OpenAI | undefined
	private ollamaClient: OpenAI | undefined
	private abortController: AbortController | undefined

	constructor(options: MacM4HandlerOptions) {
		this.options = options
	}

	private ensureProxyClient(): OpenAI {
		if (!this.proxyClient) {
			this.proxyClient = createOpenAIClient({
				baseURL: this.options.macm4BaseUrl || DEFAULT_PROXY_URL,
				apiKey: this.options.macm4ApiKey || "noop",
			})
		}
		return this.proxyClient
	}

	private ensureOllamaClient(): OpenAI {
		if (!this.ollamaClient) {
			// Ollama's OpenAI-compat endpoint lives at /v1.
			const base = this.options.macm4OllamaBaseUrl || DEFAULT_OLLAMA_URL
			const normalized = base.endsWith("/v1") ? base : `${base}/v1`
			this.ollamaClient = createOpenAIClient({
				baseURL: normalized,
				apiKey: "noop",
			})
		}
		return this.ollamaClient
	}

	/**
	 * Decide which client to use for a given tier id. local-long
	 * with macm4UseDirectOllama=true bypasses the proxy and talks
	 * directly to Ollama; everything else goes through LiteLLM so
	 * cost tracking and the over-generation guardrails fire.
	 */
	private clientFor(tierId: string): { client: OpenAI; model: string } {
		const meta = tierMeta(tierId)
		const useDirectOllama = this.options.macm4UseDirectOllama !== false
		if (meta?.backend === "ollama" && useDirectOllama) {
			// Ollama only accepts its own model tags (e.g. "qwen3-coder-next:q4_K_M"),
			// not the litellm-config alias names ("local-long"). Resolve in priority order:
			//   1. Explicit override from handler options (set via UI "Ollama model tag" field)
			//   2. OLLAMA_DEFAULT_TAGS default for this tier
			//   3. tierId as last resort (will 404 unless Ollama happens to have that name)
			const ollamaTag = this.options.macm4OllamaModelTag || OLLAMA_DEFAULT_TAGS[tierId as MacM4TierId] || tierId
			return { client: this.ensureOllamaClient(), model: ollamaTag }
		}
		return { client: this.ensureProxyClient(), model: tierId }
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const tierId = this.options.macm4ModelId || macm4DefaultModelId
		const { client, model } = this.clientFor(tierId)
		const meta = tierMeta(tierId)
		const timeoutMs = this.options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS

		const formattedMessages = convertToOpenAiMessages(messages)

		// Prepend the tool-call preamble for local models so they never
		// emit incomplete XML tool calls.
		const effectiveSystemPrompt = meta?.isLocal ? LOCAL_TOOL_CALL_PREAMBLE + systemPrompt : systemPrompt

		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: effectiveSystemPrompt,
		}

		this.abortController = new AbortController()
		const timeoutHandle = setTimeout(() => this.abortController?.abort(), timeoutMs)

		// Qwen3 supports extended thinking via Ollama's extra_body option.
		// Enabling it for local-agent gives the model a reasoning scratchpad
		// before it commits to a tool call, which dramatically reduces
		// malformed / incomplete XML output.
		const isQwen3 = model.startsWith("qwen3")
		const extraBody = isQwen3 ? { think: true } : undefined

		try {
			const stream = await client.chat.completions.create(
				{
					model,
					messages: [systemMessage, ...formattedMessages],
					// Local models have a hard ceiling on output budget;
					// pin to the tier's maxTokens to avoid runaway decode.
					max_tokens: meta?.maxTokens,
					stream: true,
					// Local tiers benefit from a slightly lower temperature
					// for tool-shaped responses; cloud keeps the OpenAI default.
					temperature: meta?.isLocal ? 0.2 : undefined,
					// Pass model-specific extra options (e.g. Qwen3 thinking mode).
					...(extraBody ? { extra_body: extraBody } : {}),
				},
				{ signal: this.abortController.signal },
			)

			for await (const chunk of stream) {
				const delta = chunk.choices?.[0]?.delta
				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}
				if (chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
					}
				}
			}
		} catch (error: any) {
			if (error?.name === "AbortError") {
				throw new Error(`MacM4 request aborted after ${timeoutMs / 1000}s timeout`)
			}
			Logger.error(`[MacM4Handler] tier=${tierId} backend=${meta?.backend ?? "unknown"} error:`, error)
			throw error
		} finally {
			clearTimeout(timeoutHandle)
			this.abortController = undefined
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const tierId = this.options.macm4ModelId || macm4DefaultModelId
		return { id: tierId, info: modelInfoFor(tierId) }
	}

	abort(): void {
		this.abortController?.abort()
	}
}

/**
 * Public helper: list available MacM4 tiers for the Cline model
 * picker UI. Returns a plain object so callers don't need to import
 * the const directly.
 */
export function listMacM4Tiers(): Array<{ id: MacM4TierId; description: string; contextWindow: number; isLocal: boolean }> {
	return (Object.entries(MACM4_TIERS) as Array<[MacM4TierId, (typeof MACM4_TIERS)[MacM4TierId]]>).map(([id, meta]) => ({
		id,
		description: meta.description,
		contextWindow: meta.contextWindow,
		isLocal: meta.isLocal,
	}))
}
