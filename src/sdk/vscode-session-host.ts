// VscodeSessionHost — wraps DefaultSessionManager with VSCode-specific customizations
//
// Replaces ClineCore.create() with direct DefaultSessionManager construction,
// allowing us to pass custom runtimeBuilder, oauthTokenManager, and other options
// that ClineCore.create() doesn't expose.
//
// Key customizations (see PROBLEMS.md S6-9 for full rationale):
// 1. VscodeRuntimeBuilder — bridges classic McpHub to SDK tool system
// 2. OAuth tokens read from providers.json via shared ProviderSettingsManager
//    (the SDK's default RuntimeOAuthTokenManager handles refresh/persistence)
// 3. source: "vscode" — tags sessions for telemetry instead of default "cli"
// 4. requestToolApproval — VSCode approval UI integration (future)

import {
	type CoreSessionEvent,
	DefaultSessionManager,
	resolveSessionBackend,
	type SendSessionInput,
	type SessionAccumulatedUsage,
	type SessionManager,
	type SessionRecord,
	type StartSessionInput,
	type StartSessionResult,
} from "@clinebot/core"
import { type ToolApprovalRequest, type ToolApprovalResult } from "@clinebot/shared"
import { writeFileSync } from "fs"
import { join } from "path"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import { resolveDataDir } from "./legacy-state-reader"
import { VscodeRuntimeBuilder } from "./vscode-runtime-builder"

// ---------------------------------------------------------------------------
// VscodeSessionHost
// ---------------------------------------------------------------------------

export interface VscodeSessionHostOptions {
	/** The classic McpHub for MCP tool bridging */
	mcpHub: McpHub
	/** Optional tool approval callback for VSCode approval UI integration */
	requestToolApproval?: (request: {
		agentId: string
		conversationId: string
		iteration: number
		toolCallId: string
		toolName: string
		input: unknown
		policy: { enabled: boolean; autoApprove: boolean }
	}) => Promise<{ approved: boolean; reason?: string }>
}

/**
 * VSCode-specific SessionManager that wraps DefaultSessionManager with
 * custom runtime builder, OAuth token manager, and session source tagging.
 *
 * This replaces ClineCore.create() with direct DefaultSessionManager construction,
 * giving us control over:
 * - runtimeBuilder: Uses VscodeRuntimeBuilder to bridge classic McpHub
 * - oauthTokenManager: SDK's RuntimeOAuthTokenManager reads from providers.json
 * - source: Tags sessions as "vscode" for telemetry
 * - requestToolApproval: VSCode approval UI integration (future)
 *
 * Usage:
 * ```ts
 * const host = await VscodeSessionHost.create({ mcpHub })
 * const result = await host.start({ config, prompt, interactive: true })
 * const unsub = host.subscribe((event) => { ... })
 * ```
 */
export class VscodeSessionHost implements SessionManager {
	private inner!: DefaultSessionManager

	private constructor() {}

	/**
	 * Create a VscodeSessionHost with custom options.
	 *
	 * This resolves the session backend (local SQLite/file storage),
	 * creates the VscodeRuntimeBuilder, and uses the SDK's default
	 * RuntimeOAuthTokenManager backed by the shared ProviderSettingsManager
	 * (providers.json) for OAuth token resolution.
	 */
	static async create(options: VscodeSessionHostOptions): Promise<VscodeSessionHost> {
		const host = new VscodeSessionHost()

		// Ensure MCP settings are filtered for the SDK's default builder.
		// The VscodeRuntimeBuilder delegates to DefaultRuntimeBuilder for builtin
		// tools, which calls loadConfiguredMcpTools(). We point it to an empty
		// settings file so it loads no MCP tools — the VscodeRuntimeBuilder
		// replaces them with tools from the classic McpHub.
		await ensureEmptyMcpSettings()

		// Resolve session backend (local mode — SQLite with file fallback)
		const sessionService = await resolveSessionBackend({ backendMode: "local" })

		// Create custom runtime builder that bridges classic McpHub
		const runtimeBuilder = new VscodeRuntimeBuilder(options.mcpHub)

		// Don't pass oauthTokenManager — the SDK's DefaultSessionManager creates
		// its own RuntimeOAuthTokenManager with a default ProviderSettingsManager
		// that reads from ~/.cline/data/settings/providers.json. AuthService
		// writes credentials to the same file, so they stay in sync.
		host.inner = new DefaultSessionManager({
			sessionService,
			runtimeBuilder,
			requestToolApproval: options.requestToolApproval as
				| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
				| undefined,
			distinctId: "cline-vscode",
		})

		Logger.log("[VscodeSessionHost] Initialized with VscodeRuntimeBuilder + SDK default OAuth")
		return host
	}

	// ---- SessionManager implementation ----

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		// Inject source: "vscode" for telemetry (SDK defaults to "cli")
		const modifiedInput: StartSessionInput = {
			...input,
			source: input.source ?? "vscode",
		}
		return this.inner.start(modifiedInput)
	}

	async send(input: SendSessionInput) {
		return this.inner.send(input)
	}

	async getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined> {
		return this.inner.getAccumulatedUsage(sessionId)
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		return this.inner.abort(sessionId, reason)
	}

	async stop(sessionId: string): Promise<void> {
		return this.inner.stop(sessionId)
	}

	async dispose(reason?: string): Promise<void> {
		return this.inner.dispose(reason)
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		return this.inner.get(sessionId)
	}

	async list(limit?: number): Promise<SessionRecord[]> {
		return this.inner.list(limit)
	}

	async delete(sessionId: string): Promise<boolean> {
		return this.inner.delete(sessionId)
	}

	async readMessages(sessionId: string) {
		return this.inner.readMessages(sessionId)
	}

	async readTranscript(sessionId: string, maxChars?: number): Promise<string> {
		return this.inner.readTranscript(sessionId, maxChars)
	}

	async readHooks(sessionId: string, limit?: number): Promise<unknown[]> {
		return this.inner.readHooks(sessionId, limit)
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		return this.inner.subscribe(listener)
	}
}

// ---------------------------------------------------------------------------
// MCP settings helpers
// ---------------------------------------------------------------------------

/**
 * Write an empty MCP settings file and point the SDK to it.
 *
 * The VscodeRuntimeBuilder delegates to DefaultRuntimeBuilder for builtin
 * tools, which calls loadConfiguredMcpTools(). This function reads from
 * CLINE_MCP_SETTINGS_PATH. By pointing it to an empty settings file, we
 * ensure the default builder loads no MCP tools — the VscodeRuntimeBuilder
 * replaces them with tools from the classic McpHub which supports all
 * transport types (stdio, SSE, streamableHttp).
 */
async function ensureEmptyMcpSettings(): Promise<void> {
	try {
		const dataDir = resolveDataDir()
		const settingsDir = join(dataDir, "settings")

		// Ensure the settings directory exists
		const { mkdirSync } = await import("fs")
		mkdirSync(settingsDir, { recursive: true })

		// Write an empty MCP settings file
		const emptyPath = join(settingsDir, "cline_mcp_settings_empty.json")
		writeFileSync(emptyPath, JSON.stringify({ mcpServers: {} }))

		// Point the SDK to the empty settings file
		process.env.CLINE_MCP_SETTINGS_PATH = emptyPath

		Logger.log(`[VscodeSessionHost] Empty MCP settings: ${emptyPath}`)
	} catch (error) {
		Logger.warn("[VscodeSessionHost] Failed to create empty MCP settings:", error)
	}
}
