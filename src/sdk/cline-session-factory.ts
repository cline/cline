/**
 * ClineCore Session Factory
 *
 * Creates SdkSession instances backed by @clinebot/core's ClineCore.
 * Maps ClineCore events to the AgentEvent format used by MessageTranslator.
 *
 * ClineCore API:
 *   ClineCore.create(options) → session host (singleton)
 *   host.start({ config, prompt, interactive }) → starts a session
 *   host.subscribe(listener) → event subscription (all sessions)
 *   host.send({ sessionId, prompt }) → send follow-up
 *   host.abort(sessionId) → cancel
 *   host.stop(sessionId) → stop session
 */

import type { ApiConfiguration } from "@shared/api"
import { Logger } from "@shared/services/Logger"
import type { AgentEvent } from "./message-translator"
import type { SdkSession, SessionFactory } from "./SdkController"

// ---------------------------------------------------------------------------
// Provider → API key resolution
// ---------------------------------------------------------------------------

/**
 * Map a provider ID to the API key stored in ApiConfiguration.
 * ApiConfiguration is Partial<ApiHandlerSettings> which includes all
 * secret key fields directly (apiKey, openRouterApiKey, etc.)
 */
function resolveApiKey(provider: string, config: ApiConfiguration): string | undefined {
	// The ApiConfiguration has all keys from Secrets as optional fields
	const apiConfig = config as Record<string, unknown>

	const providerKeyMap: Record<string, string> = {
		anthropic: "apiKey",
		cline: "clineApiKey",
		openrouter: "openRouterApiKey",
		bedrock: "awsAccessKey", // Bedrock uses AWS credentials, not a simple key
		openai: "openAiApiKey",
		"openai-native": "openAiNativeApiKey",
		"openai-codex": "openAiNativeApiKey",
		gemini: "geminiApiKey",
		ollama: "ollamaApiKey",
		deepseek: "deepSeekApiKey",
		requesty: "requestyApiKey",
		together: "togetherApiKey",
		fireworks: "fireworksApiKey",
		qwen: "qwenApiKey",
		doubao: "doubaoApiKey",
		mistral: "mistralApiKey",
		litellm: "liteLlmApiKey",
		asksage: "asksageApiKey",
		xai: "xaiApiKey",
		moonshot: "moonshotApiKey",
		zai: "zaiApiKey",
		huggingface: "huggingFaceApiKey",
		nebius: "nebiusApiKey",
		sambanova: "sambanovaApiKey",
		cerebras: "cerebrasApiKey",
	}

	const keyField = providerKeyMap[provider]
	if (keyField && typeof apiConfig[keyField] === "string") {
		return apiConfig[keyField] as string
	}

	// Fallback: try generic "apiKey"
	if (typeof apiConfig.apiKey === "string") {
		return apiConfig.apiKey as string
	}

	return undefined
}

// ---------------------------------------------------------------------------
// Provider + mode → model ID resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the model ID from mode-specific, provider-specific keys in the
 * ApiConfiguration. The classic extension stores model IDs as flat keys:
 *   actModeClineModelId, planModeOpenRouterModelId, actModeOllamaModelId, etc.
 *
 * Falls back to the generic ${modePrefix}ApiModelId if no provider-specific key exists.
 */
function resolveModelId(
	provider: string,
	modePrefix: string,
	apiConfig: Record<string, unknown> | undefined,
): string | undefined {
	if (!apiConfig) return undefined

	// Map provider ID → the suffix used in the model ID key
	const providerModelKeyMap: Record<string, string> = {
		cline: "ClineModelId",
		openrouter: "OpenRouterModelId",
		openai: "OpenAiModelId",
		"openai-native": "OpenAiModelId",
		"openai-codex": "OpenAiModelId",
		ollama: "OllamaModelId",
		"lm-studio": "LmStudioModelId",
		lmstudio: "LmStudioModelId",
		litellm: "LiteLlmModelId",
		requesty: "RequestyModelId",
		together: "TogetherModelId",
		fireworks: "FireworksModelId",
		groq: "GroqModelId",
		huggingface: "HuggingFaceModelId",
		"sap-ai-core": "SapAiCoreModelId",
		baseten: "BasetenModelId",
		"huawei-cloud-maas": "HuaweiCloudMaasModelId",
		oca: "OcaModelId",
		aihubmix: "AihubmixModelId",
		hicap: "HicapModelId",
		"nous-research": "NousResearchModelId",
		"vercel-ai-gateway": "VercelAiGatewayModelId",
	}

	const suffix = providerModelKeyMap[provider]
	if (suffix) {
		const key = `${modePrefix}${suffix}`
		const value = apiConfig[key]
		if (typeof value === "string" && value) {
			return value
		}
	}

	// Fallback: generic mode model ID (used by anthropic, deepseek, gemini, etc.)
	const genericKey = `${modePrefix}ApiModelId`
	const genericValue = apiConfig[genericKey]
	if (typeof genericValue === "string" && genericValue) {
		return genericValue
	}

	return undefined
}

// ---------------------------------------------------------------------------
// ClineCoreSession — real session backed by ClineCore
// ---------------------------------------------------------------------------

class ClineCoreSession implements SdkSession {
	private eventHandler?: (event: AgentEvent) => void
	private running = false
	private sessionId?: string
	private unsubscribe?: () => void

	constructor(
		private readonly host: {
			start: (input: {
				config: Record<string, unknown>
				prompt?: string
				interactive?: boolean
			}) => Promise<{ sessionId: string; result?: { text?: string } }>
			send: (input: { sessionId: string; prompt: string }) => Promise<unknown>
			abort: (sessionId: string) => Promise<void>
			stop: (sessionId: string) => Promise<void>
			subscribe: (listener: (event: unknown) => void) => () => void
			dispose: (reason?: string) => Promise<void>
		},
		private readonly coreConfig: Record<string, unknown>,
	) {}

	async sendPrompt(text: string, _images?: string[]): Promise<void> {
		this.running = true

		// Subscribe to events before starting
		this.unsubscribe = this.host.subscribe((event: unknown) => {
			this.handleCoreEvent(event)
		})

		try {
			if (this.sessionId) {
				// Follow-up prompt on existing session
				await this.host.send({
					sessionId: this.sessionId,
					prompt: text,
				})
			} else {
				// Initial prompt — start a new session
				const result = await this.host.start({
					config: this.coreConfig,
					prompt: text,
					interactive: true,
				})
				this.sessionId = result.sessionId
				Logger.log(`[ClineCoreSession] Session started: ${this.sessionId}`)
			}
		} catch (error) {
			Logger.log(`[ClineCoreSession] Error: ${error instanceof Error ? error.message : String(error)}`)
			// Emit error event so the UI can show it
			if (this.eventHandler) {
				this.eventHandler({
					type: "error",
					error: error instanceof Error ? error : new Error(String(error)),
					recoverable: false,
					iteration: 0,
				})
			}
		} finally {
			this.running = false
		}
	}

	async sendResponse(text: string): Promise<void> {
		if (!this.sessionId) {
			Logger.log("[ClineCoreSession] sendResponse called with no active session")
			return
		}
		this.running = true
		try {
			await this.host.send({
				sessionId: this.sessionId,
				prompt: text,
			})
		} catch (error) {
			Logger.log(`[ClineCoreSession] sendResponse error: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			this.running = false
		}
	}

	async abort(): Promise<void> {
		if (this.sessionId) {
			try {
				await this.host.abort(this.sessionId)
			} catch (error) {
				Logger.log(`[ClineCoreSession] abort error: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		this.cleanup()
	}

	onEvent(handler: (event: AgentEvent) => void): void {
		this.eventHandler = handler
	}

	isRunning(): boolean {
		return this.running
	}

	private handleCoreEvent(event: unknown): void {
		if (!this.eventHandler) return

		// ClineCore emits CoreSessionEvent: { type: "agent_event", payload: { sessionId, event } }
		const typed = event as {
			type: string
			payload?: { sessionId?: string; event?: AgentEvent; stream?: string; chunk?: string }
		}

		if (typed.type === "agent_event" && typed.payload?.event) {
			// Only forward events for our session
			if (!this.sessionId || typed.payload.sessionId === this.sessionId) {
				this.eventHandler(typed.payload.event)
			}
			return
		}

		// Fallback: try JSON-encoded chunk stream (older SDK versions)
		if (typed.type === "chunk" && typed.payload?.stream === "agent" && typeof typed.payload?.chunk === "string") {
			if (!this.sessionId || typed.payload.sessionId === this.sessionId) {
				try {
					const parsed = JSON.parse(typed.payload.chunk) as AgentEvent
					this.eventHandler(parsed)
				} catch {
					// Best-effort
				}
			}
		}
	}

	private cleanup(): void {
		this.running = false
		if (this.unsubscribe) {
			this.unsubscribe()
			this.unsubscribe = undefined
		}
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SessionFactory backed by ClineCore.
 *
 * Creates a single ClineCore instance (session host) and returns a factory
 * that creates ClineCoreSession instances on demand.
 */
export function createClineSessionFactory(options?: { clineDir?: string }): SessionFactory {
	// We lazily initialize ClineCore to avoid import-time side effects
	let hostPromise: Promise<InstanceType<typeof import("@clinebot/core").ClineCore>> | null = null

	async function getHost() {
		if (!hostPromise) {
			hostPromise = (async () => {
				const { ClineCore } = await import("@clinebot/core")
				Logger.log("[ClineSessionFactory] Creating ClineCore session host")
				const host = await ClineCore.create({
					backendMode: "local",
					clientName: "cline-vscode-sdk",
				})
				Logger.log("[ClineSessionFactory] ClineCore session host created")
				return host
			})()
		}
		return hostPromise
	}

	return async (config) => {
		const host = await getHost()

		const apiConfig = config.apiConfiguration as Record<string, unknown> | undefined
		const mode = config.mode ?? "act"
		const cwd = config.cwd ?? process.cwd()

		// Resolve provider from mode-specific keys (actModeApiProvider / planModeApiProvider)
		// The classic extension stores provider per-mode, not as a single "apiProvider" key.
		const modePrefix = mode === "plan" ? "planMode" : "actMode"
		const provider = (apiConfig?.[`${modePrefix}ApiProvider`] as string)
			?? (apiConfig?.apiProvider as string)
			?? "anthropic"

		// Resolve model ID from mode+provider specific keys.
		// The classic extension stores model IDs per provider, e.g.:
		//   actModeClineModelId, actModeOpenRouterModelId, planModeOllamaModelId, etc.
		const modelId = resolveModelId(provider, modePrefix, apiConfig) ?? "claude-sonnet-4-5-20250929"

		const apiKey = config.apiConfiguration ? resolveApiKey(provider, config.apiConfiguration) : undefined

		Logger.log(
			`[ClineSessionFactory] Creating session: provider=${provider}, model=${modelId}, cwd=${cwd}, mode=${mode}, hasKey=${!!apiKey}`,
		)

		const coreConfig: Record<string, unknown> = {
			providerId: provider,
			modelId,
			apiKey: apiKey ?? "",
			cwd,
			mode,
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		}

		// Pass through additional provider-specific config
		if (apiConfig) {
			// Base URL overrides
			if (apiConfig.openRouterBaseUrl) coreConfig.baseUrl = apiConfig.openRouterBaseUrl
			if (apiConfig.openAiBaseUrl) coreConfig.baseUrl = apiConfig.openAiBaseUrl
			if (apiConfig.ollamaBaseUrl) coreConfig.baseUrl = apiConfig.ollamaBaseUrl
			if (apiConfig.liteLlmBaseUrl) coreConfig.baseUrl = apiConfig.liteLlmBaseUrl
			if (apiConfig.lmStudioBaseUrl) coreConfig.baseUrl = apiConfig.lmStudioBaseUrl

			// AWS-specific
			if (provider === "bedrock") {
				coreConfig.awsRegion = apiConfig.awsRegion
				coreConfig.awsAccessKeyId = apiConfig.awsAccessKey
				coreConfig.awsSecretAccessKey = apiConfig.awsSecretKey
				coreConfig.awsSessionToken = apiConfig.awsSessionToken
			}

			// Thinking/reasoning
			if (apiConfig.modelSupportsReasoning) {
				coreConfig.thinking = true
			}
		}

		return new ClineCoreSession(host as any, coreConfig)
	}
}
