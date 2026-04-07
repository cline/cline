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
// MCP tool loading — connects to configured MCP servers and produces
// Tool[] that can be passed as `extraTools` to ClineCore sessions.
// ---------------------------------------------------------------------------

/**
 * Cached MCP manager + tools.  Shared across sessions so MCP servers
 * stay connected between tasks (they're long-lived processes).
 */
let mcpManagerPromise: Promise<{
	manager: InstanceType<typeof import("@clinebot/core").InMemoryMcpManager>
	tools: Awaited<ReturnType<typeof import("@clinebot/core").createMcpTools>>[]
}> | null = null

async function getOrCreateMcpManager() {
	if (mcpManagerPromise) return mcpManagerPromise

	mcpManagerPromise = (async () => {
		const { InMemoryMcpManager, hasMcpSettingsFile, resolveMcpServerRegistrations, createMcpTools } = await import(
			"@clinebot/core"
		)

		if (!hasMcpSettingsFile()) {
			Logger.log("[MCP] No MCP settings file found — skipping")
			return { manager: null as any, tools: [] }
		}

		const registrations = resolveMcpServerRegistrations()
		if (registrations.length === 0) {
			Logger.log("[MCP] No MCP servers configured — skipping")
			return { manager: null as any, tools: [] }
		}

		Logger.log(`[MCP] Found ${registrations.length} server registration(s)`)

		// Build the client factory using @modelcontextprotocol/sdk
		const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")

		const clientFactory = async (
			reg: import("@clinebot/core").McpServerRegistration,
		): Promise<import("@clinebot/core").McpServerClient> => {
			const client = new Client({ name: "cline-sdk", version: "1.0.0" })
			let transport: import("@modelcontextprotocol/sdk/shared/transport.js").Transport

			if (reg.transport.type === "stdio") {
				const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
				transport = new StdioClientTransport({
					command: reg.transport.command,
					args: reg.transport.args,
					env: reg.transport.env ? ({ ...process.env, ...reg.transport.env } as Record<string, string>) : undefined,
				})
			} else if (reg.transport.type === "streamableHttp") {
				const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")
				transport = new StreamableHTTPClientTransport(new URL(reg.transport.url), {
					requestInit: reg.transport.headers ? { headers: reg.transport.headers } : undefined,
				})
			} else if (reg.transport.type === "sse") {
				const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js")
				transport = new SSEClientTransport(new URL(reg.transport.url), {
					requestInit: reg.transport.headers ? { headers: reg.transport.headers } : undefined,
				})
			} else {
				throw new Error(`Unsupported MCP transport type: ${(reg.transport as any).type}`)
			}

			return {
				async connect() {
					await client.connect(transport)
				},
				async disconnect() {
					await client.close()
				},
				async listTools() {
					const result = await client.listTools()
					return result.tools.map((t) => ({
						name: t.name,
						description: t.description,
						inputSchema: t.inputSchema as Record<string, unknown>,
					}))
				},
				async callTool(request) {
					const result = await client.callTool({
						name: request.name,
						arguments: request.arguments,
					})
					return result
				},
			}
		}

		const manager = new InMemoryMcpManager({ clientFactory })

		// Register + connect all non-disabled servers
		const tools: Awaited<ReturnType<typeof createMcpTools>>[] = []
		for (const reg of registrations) {
			if (reg.disabled) {
				Logger.log(`[MCP] Skipping disabled server: ${reg.name}`)
				continue
			}
			try {
				await manager.registerServer(reg)
				await manager.connectServer(reg.name)
				const serverTools = await createMcpTools({
					serverName: reg.name,
					provider: manager,
				})
				tools.push(...serverTools)
				Logger.log(`[MCP] Connected to '${reg.name}' — ${serverTools.length} tool(s)`)
			} catch (error) {
				Logger.log(`[MCP] Failed to connect '${reg.name}': ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		Logger.log(`[MCP] Total MCP tools loaded: ${tools.length}`)
		return { manager, tools }
	})()

	// If loading fails, clear the cache so next attempt retries
	mcpManagerPromise.catch(() => {
		mcpManagerPromise = null
	})

	return mcpManagerPromise
}

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

	// Special case: the "cline" provider uses OAuth credentials stored as a
	// JSON object under "cline:clineAccountId" (not a simple "clineApiKey").
	// Extract the idToken from the OAuth credential object and add the
	// "workos:" prefix that the Cline API expects.
	if (provider === "cline") {
		const clineAccountRaw = apiConfig["cline:clineAccountId"]
		if (typeof clineAccountRaw === "string") {
			try {
				const creds = JSON.parse(clineAccountRaw)
				if (creds.idToken) {
					const token = creds.idToken as string
					// The Cline API requires the "workos:" prefix on the auth token
					return token.startsWith("workos:") ? token : `workos:${token}`
				}
			} catch {
				// Not valid JSON — treat as raw key
				const raw = clineAccountRaw
				return raw.startsWith("workos:") ? raw : `workos:${raw}`
			}
		}
		// Fallback to clineApiKey if available
		if (typeof apiConfig.clineApiKey === "string") {
			const key = apiConfig.clineApiKey as string
			return key.startsWith("workos:") ? key : `workos:${key}`
		}
		return undefined
	}

	const providerKeyMap: Record<string, string> = {
		anthropic: "apiKey",
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

type CoreSessionHostLike = {
	start: (input: {
		config: Record<string, unknown>
		prompt?: string
		interactive?: boolean
		userImages?: string[]
	}) => Promise<{ sessionId: string; result?: { text?: string } }>
	send: (input: { sessionId: string; prompt: string }) => Promise<unknown>
	abort: (sessionId: string, reason?: unknown) => Promise<void>
	stop: (sessionId: string) => Promise<void>
	subscribe: (listener: (event: unknown) => void) => () => void
	dispose: (reason?: string) => Promise<void>
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
		private readonly host: CoreSessionHostLike,
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

		// ClineCore emits CoreSessionEvent in two forms for the SAME data:
		//   1. { type: "agent_event", payload: { sessionId, event } }  — structured
		//   2. { type: "chunk", payload: { stream: "agent", chunk: "<JSON>" } } — JSON string
		//
		// We ONLY process the "agent_event" form.  Processing both would
		// double-deliver every event, causing garbled/duplicated output.
		const typed = event as {
			type: string
			payload?: { sessionId?: string; event?: AgentEvent }
		}

		if (typed.type === "agent_event" && typed.payload?.event) {
			// Only forward events for our session
			if (!this.sessionId || typed.payload.sessionId === this.sessionId) {
				this.eventHandler(typed.payload.event)
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
	// We lazily initialize the session host to avoid import-time side effects
	let hostPromise: Promise<CoreSessionHostLike> | null = null

	async function getHost() {
		if (!hostPromise) {
			hostPromise = (async () => {
				const { createSessionHost } = await import("@clinebot/core")
				Logger.log("[ClineSessionFactory] Creating ClineCore session host")
				const host = (await createSessionHost({
					backendMode: "local",
					clientName: "cline-vscode-sdk",
				})) as unknown as CoreSessionHostLike
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
		const provider = (apiConfig?.[`${modePrefix}ApiProvider`] as string) ?? (apiConfig?.apiProvider as string) ?? "anthropic"

		// Resolve model ID from mode+provider specific keys.
		// The classic extension stores model IDs per provider, e.g.:
		//   actModeClineModelId, actModeOpenRouterModelId, planModeOllamaModelId, etc.
		const modelId = resolveModelId(provider, modePrefix, apiConfig) ?? "claude-sonnet-4-5-20250929"

		// Some providers don't require a real API key, but ClineCore's
		// validation still requires a non-empty string.  Use a dummy placeholder
		// for these so the Zod schema doesn't reject the config.
		const NO_KEY_PROVIDERS = new Set(["ollama", "lmstudio", "claude-code", "vscode-lm"])
		const apiKey = NO_KEY_PROVIDERS.has(provider)
			? ((config.apiConfiguration ? resolveApiKey(provider, config.apiConfiguration) : undefined) ?? provider)
			: config.apiConfiguration
				? resolveApiKey(provider, config.apiConfiguration)
				: undefined

		Logger.log(
			`[ClineSessionFactory] Creating session: provider=${provider}, model=${modelId}, cwd=${cwd}, mode=${mode}, hasKey=${!!apiKey}, noKeyRequired=${NO_KEY_PROVIDERS.has(provider)}`,
		)

		// CoreSessionConfig expects 'workspaceRoot' (not 'cwd') and requires 'systemPrompt'.
		// Use getClineDefaultSystemPrompt() for the default prompt, or a minimal fallback.
		let systemPrompt: string
		try {
			const core = await import("@clinebot/core")
			systemPrompt = core.getClineDefaultSystemPrompt("VSCode", cwd)
		} catch {
			systemPrompt = `You are Cline, a highly skilled software engineer. Your working directory is: ${cwd}`
		}

		const coreConfig: Record<string, unknown> = {
			providerId: provider,
			modelId,
			cwd,
			workspaceRoot: cwd,
			systemPrompt,
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		}

		// Only set apiKey if the provider actually uses one
		if (apiKey) {
			coreConfig.apiKey = apiKey
		}

		// Load MCP tools from configured MCP servers (with timeout to avoid blocking session start)
		try {
			const MCP_LOAD_TIMEOUT_MS = 30_000
			const mcpResult = await Promise.race([
				getOrCreateMcpManager(),
				new Promise<{ manager: any; tools: [] }>((resolve) =>
					setTimeout(() => {
						Logger.log("[ClineSessionFactory] MCP tool loading timed out — starting session without MCP tools")
						resolve({ manager: null, tools: [] })
					}, MCP_LOAD_TIMEOUT_MS),
				),
			])
			if (mcpResult.tools.length > 0) {
				coreConfig.extraTools = mcpResult.tools
				Logger.log(`[ClineSessionFactory] Passing ${mcpResult.tools.length} MCP tool(s) as extraTools`)
			}
		} catch (error) {
			Logger.log(
				`[ClineSessionFactory] MCP tool loading failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		// Cline provider: set the correct API base URL
		// The Cline API is OpenAI-compatible at https://api.cline.bot/api/v1
		if (provider === "cline") {
			coreConfig.baseUrl = "https://api.cline.bot/api/v1"
		}

		// Pass through additional provider-specific config
		if (apiConfig) {
			// Base URL overrides — only apply to their respective providers
			// to avoid clobbering provider-specific URLs (e.g. Cline API)
			if (provider === "openrouter" && apiConfig.openRouterBaseUrl) coreConfig.baseUrl = apiConfig.openRouterBaseUrl
			if ((provider === "openai" || provider === "openai-native") && apiConfig.openAiBaseUrl)
				coreConfig.baseUrl = apiConfig.openAiBaseUrl
			if (provider === "litellm" && apiConfig.liteLlmBaseUrl) coreConfig.baseUrl = apiConfig.liteLlmBaseUrl

			// Ollama: ClineCore uses the OpenAI-compatible provider which sends
			// requests to {baseUrl}/chat/completions.  Ollama's OpenAI-compat
			// endpoint lives at /v1/chat/completions, so we must append /v1.
			if (provider === "ollama") {
				const rawUrl = (apiConfig.ollamaBaseUrl as string) || "http://localhost:11434"
				coreConfig.baseUrl = rawUrl.endsWith("/v1") ? rawUrl : `${rawUrl.replace(/\/+$/, "")}/v1`
				// Pass through optional Ollama API key (some deployments use auth)
				if (apiConfig.ollamaApiKey) {
					coreConfig.apiKey = apiConfig.ollamaApiKey
				}
			}

			// LM Studio: same as Ollama — needs /v1 suffix for OpenAI compat
			if (provider === "lmstudio") {
				const rawUrl = (apiConfig.lmStudioBaseUrl as string) || "http://localhost:1234"
				coreConfig.baseUrl = rawUrl.endsWith("/v1") ? rawUrl : `${rawUrl.replace(/\/+$/, "")}/v1`
			}

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
