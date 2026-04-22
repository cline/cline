import type {
	Agent,
	AgentSideConnection,
	AuthenticateRequest,
	AuthenticateResponse,
	CancelNotification,
	ContentBlock,
	InitializeRequest,
	InitializeResponse,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	SessionConfigOption,
	SetSessionConfigOptionRequest,
	SetSessionConfigOptionResponse,
	SetSessionModelRequest,
	SetSessionModelResponse,
	SetSessionModeRequest,
	SetSessionModeResponse,
	StopReason,
} from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import {
	type AgentEvent,
	type ClineCore,
	Llms,
	ProviderSettingsManager,
	SessionSource,
} from "@clinebot/core";
import { getPersistedProviderApiKey } from "../commands/auth";
import { resolveSystemPrompt } from "../runtime/prompt";
import { subscribeToAgentEvents } from "../runtime/session-events";
import { createCliCore } from "../session/session";
import { getCliBuildInfo } from "../utils/common";
import { randomSessionId, resolveWorkspaceRoot } from "../utils/helpers";
import type { Config } from "../utils/types";
import {
	ACP_AUTH_METHODS,
	type AcpAuthMethodId,
	type AcpAuthResult,
	authenticateAcpProvider,
	isAcpAuthMethodId,
} from "./auth";
import { requestAcpToolApproval } from "./permissions";
import {
	forwardAgentEvent,
	sendConfigOptionUpdate,
	sendCurrentModeUpdate,
	sendSessionInfoUpdate,
} from "./session-updates";

interface SessionState {
	id: string;
	cwd: string;
	mcpServers: NewSessionRequest["mcpServers"];
	/** Current agent mode — "plan" (read-only) or "act" (full). */
	currentMode: "plan" | "act";
	/** Current provider id for the session. */
	currentProviderId: string;
	/** Current model id for the session. */
	currentModelId: string;
	/** Active session manager for the running agent, if any. */
	sessionManager?: ClineCore;
	/** Internal session id within the session manager. */
	activeSessionId?: string;
	/** Abort controller for the current prompt, if running. */
	abortController?: AbortController;
	/** Unsubscribe function for the agent event listener. */
	unsubscribe?: () => void;
	/** Messages to inject into the next session manager for conversation continuity. */
	pendingInitialMessages?: Llms.Message[];
}

export class AcpAgent implements Agent {
	private sessions = new Map<string, SessionState>();
	private readonly conn: AgentSideConnection;
	private readonly providerSettingsManager = new ProviderSettingsManager();

	/** Set after a successful `authenticate` call. */
	private authResult?: AcpAuthResult;

	constructor(conn: AgentSideConnection) {
		this.conn = conn;
	}

	async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
		const { version, name } = getCliBuildInfo();

		return {
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: true,
				promptCapabilities: {
					image: true,
					audio: false,
					embeddedContext: false,
				},
			},
			agentInfo: {
				name,
				version,
			},
			authMethods: ACP_AUTH_METHODS.map((m) => ({
				id: m.id,
				name: m.name,
			})),
		};
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		// Require authentication unless an API key is provided via env var.
		if (!this.authResult && !process.env.CLINE_API_KEY) {
			// Check for valid persisted credentials from a previous session
			// before forcing the client to re-authenticate.
			this.authResult = this.tryRestoreAuth();

			if (!this.authResult) {
				throw RequestError.authRequired(
					undefined,
					"Call authenticate before creating a session",
				);
			}
		}

		const sessionId = randomSessionId();

		const defaultMode = "act";
		const providerId =
			process.env.CLINE_PROVIDER ?? this.authResult?.providerId ?? "cline";
		const defaultModelId =
			process.env.CLINE_MODEL ?? "anthropic/claude-sonnet-4.6";

		this.sessions.set(sessionId, {
			id: sessionId,
			cwd: params.cwd,
			mcpServers: params.mcpServers,
			currentMode: defaultMode,
			currentProviderId: providerId,
			currentModelId: defaultModelId,
		});

		const providerModels = await Llms.getModelsForProvider(providerId);
		const availableModels = Object.entries(providerModels).map(
			([modelId, info]) => ({
				modelId,
				name: info.name ?? modelId,
				description: info.description,
			}),
		);

		return {
			sessionId,
			modes: {
				availableModes: [
					{
						id: "plan",
						name: "Plan",
						description:
							"Explore the codebase and plan changes without modifying files",
					},
					{
						id: "act",
						name: "Act",
						description: "Make changes to the codebase",
					},
				],
				currentModeId: defaultMode,
			},
			models: {
				availableModels,
				currentModelId: defaultModelId,
			},
			configOptions: [
				await buildProviderConfigOption(providerId),
				buildModelConfigOption(defaultModelId, providerModels),
				buildModeConfigOption(defaultMode),
			],
		};
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`unknown session: ${params.sessionId}`);
		}

		const promptText = extractTextFromContentBlocks(params.prompt);
		if (!promptText) {
			return { stopReason: "end_turn" };
		}

		const abortController = new AbortController();
		session.abortController = abortController;

		// If cancel() was already called before prompt() started, bail early.
		if (abortController.signal.aborted) {
			session.abortController = undefined;
			return { stopReason: "cancelled" };
		}

		await this.ensureSessionManager(session, params.sessionId);

		// Re-check after async initialization.
		if (abortController.signal.aborted) {
			session.abortController = undefined;
			return { stopReason: "cancelled" };
		}

		let stopReason: StopReason = "end_turn";
		try {
			const onAbort = () => {
				if (session.activeSessionId && session.sessionManager) {
					session.sessionManager
						.abort(session.activeSessionId, abortController.signal.reason)
						.catch(() => {});
				}
			};
			abortController.signal.addEventListener("abort", onAbort, {
				once: true,
			});

			const result = await session.sessionManager?.send({
				sessionId: session.activeSessionId!,
				prompt: promptText,
			});

			if (result) {
				stopReason = mapFinishReason(result.finishReason);
			}
		} finally {
			session.abortController = undefined;
		}

		sendSessionInfoUpdate(this.conn, params.sessionId, {
			updatedAt: new Date().toISOString(),
		});

		return { stopReason };
	}

	async cancel(params: CancelNotification): Promise<void> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			return;
		}

		// Abort the controller — this handles all stages of prompt():
		// - If prompt() hasn't started the agent yet, the signal check will
		//   short-circuit and resolve with stopReason: 'cancelled'.
		// - If the agent is running, the "abort" event listener on the signal
		//   will call sessionManager.abort() to stop it.
		if (session.abortController) {
			session.abortController.abort();
		}
	}

	async setSessionMode(
		params: SetSessionModeRequest,
	): Promise<SetSessionModeResponse> {
		if (params.modeId !== "plan" && params.modeId !== "act") {
			throw new Error(
				`invalid modeId: ${params.modeId} (must be "plan" or "act")`,
			);
		}
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`unknown session: ${params.sessionId}`);
		}
		session.currentMode = params.modeId;
		sendCurrentModeUpdate(this.conn, params.sessionId, params.modeId);
		return {};
	}

	async unstable_setSessionModel(
		params: SetSessionModelRequest,
	): Promise<SetSessionModelResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`unknown session: ${params.sessionId}`);
		}
		session.currentModelId = params.modelId;
		if (session.sessionManager && session.activeSessionId) {
			await session.sessionManager.updateSessionModel?.(
				session.activeSessionId,
				params.modelId,
			);
		}
		return {};
	}

	async setSessionConfigOption(
		params: SetSessionConfigOptionRequest,
	): Promise<SetSessionConfigOptionResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`unknown session: ${params.sessionId}`);
		}

		const value = params.value as string;

		switch (params.configId) {
			case "provider": {
				if (process.env.CLINE_PROVIDER) {
					throw RequestError.invalidParams(
						undefined,
						"Cannot change provider: CLINE_PROVIDER environment variable is set",
					);
				}
				if (!isAcpAuthMethodId(value)) {
					throw RequestError.invalidParams(
						undefined,
						`Unknown provider: ${value}`,
					);
				}

				session.currentProviderId = value;

				// Tear down the old session manager so ensureSessionManager()
				// creates a fresh one with the new provider on the next prompt().
				await this.teardownSessionManager(session);

				// If current model doesn't exist in new provider, reset to first available
				const providerModels = await Llms.getModelsForProvider(value);
				const modelIds = Object.keys(providerModels);
				if (!modelIds.includes(session.currentModelId) && modelIds.length > 0) {
					session.currentModelId = modelIds[0]!;
				}
				break;
			}

			case "model": {
				session.currentModelId = value;
				if (session.sessionManager && session.activeSessionId) {
					await session.sessionManager.updateSessionModel?.(
						session.activeSessionId,
						value,
					);
				}
				break;
			}

			case "mode": {
				if (value !== "plan" && value !== "act") {
					throw RequestError.invalidParams(
						undefined,
						`Invalid mode: ${value} (must be "plan" or "act")`,
					);
				}
				session.currentMode = value;
				sendCurrentModeUpdate(this.conn, params.sessionId, value);
				break;
			}

			default:
				throw RequestError.invalidParams(
					undefined,
					`Unknown config option: ${params.configId}`,
				);
		}

		const configOptions = await buildAllConfigOptions(session);
		sendConfigOptionUpdate(this.conn, params.sessionId, configOptions);
		return { configOptions };
	}

	async authenticate(
		params: AuthenticateRequest,
	): Promise<AuthenticateResponse | undefined> {
		if (!isAcpAuthMethodId(params.methodId)) {
			throw RequestError.invalidParams(
				undefined,
				`Unsupported auth method: ${params.methodId}`,
			);
		}

		this.authResult = await authenticateAcpProvider(
			params.methodId,
			this.providerSettingsManager,
		);

		return {};
	}

	async shutdown(): Promise<void> {
		for (const session of this.sessions.values()) {
			if (session.abortController) {
				session.abortController.abort();
			}
			if (session.unsubscribe) {
				session.unsubscribe();
			}
			if (session.sessionManager && session.activeSessionId) {
				await session.sessionManager
					.abort(session.activeSessionId)
					.catch(() => {});
				await session.sessionManager.dispose("acp_shutdown").catch(() => {});
			}
		}
		this.sessions.clear();
	}

	/**
	 * Attempt to restore authentication from persisted provider settings.
	 *
	 * When a previous session already completed an OAuth login the credentials
	 * are saved to disk via `ProviderSettingsManager`.  On a fresh ACP
	 * connection we check each known auth method for a persisted API key so
	 * the client doesn't have to re-authenticate every time.
	 */
	private tryRestoreAuth(): AcpAuthResult | undefined {
		for (const method of ACP_AUTH_METHODS) {
			const settings = this.providerSettingsManager.getProviderSettings(
				method.id,
			);
			const apiKey = getPersistedProviderApiKey(method.id, settings);
			if (apiKey) {
				return { providerId: method.id as AcpAuthMethodId, apiKey };
			}
		}
		return undefined;
	}

	/**
	 * Tear down the current session manager, preserving conversation messages
	 * so they can be replayed into a new session manager.
	 */
	private async teardownSessionManager(session: SessionState): Promise<void> {
		if (!session.sessionManager) {
			return;
		}

		// Save conversation history before teardown.
		if (session.activeSessionId) {
			session.pendingInitialMessages =
				await session.sessionManager.readMessages(session.activeSessionId);
		}

		if (session.abortController) {
			session.abortController.abort();
		}
		if (session.unsubscribe) {
			session.unsubscribe();
			session.unsubscribe = undefined;
		}
		if (session.activeSessionId) {
			await session.sessionManager
				.abort(session.activeSessionId)
				.catch(() => {});
		}
		await session.sessionManager.dispose("provider_change").catch(() => {});
		session.sessionManager = undefined;
		session.activeSessionId = undefined;
	}

	/**
	 * Lazily create and start the session manager for this ACP session.
	 * After the first call the manager persists across prompt() calls so that
	 * conversation history is maintained.
	 */
	private async ensureSessionManager(
		session: SessionState,
		acpSessionId: string,
	): Promise<void> {
		if (session.sessionManager) {
			return;
		}

		const config = await this.buildConfig(session);

		const sessionManager = await createCliCore({
			toolPolicies: config.toolPolicies,
			requestToolApproval: (request) =>
				requestAcpToolApproval(this.conn, acpSessionId, request),
		});

		session.unsubscribe = subscribeToAgentEvents(
			sessionManager,
			(event: AgentEvent) => {
				forwardAgentEvent(this.conn, acpSessionId, event);
			},
		);

		const initialMessages = session.pendingInitialMessages;
		session.pendingInitialMessages = undefined;

		const started = await sessionManager.start({
			source: SessionSource.CLI,
			config,
			interactive: true,
			initialMessages,
		});

		session.sessionManager = sessionManager;
		session.activeSessionId = started.sessionId;
	}

	private async buildConfig(session: SessionState): Promise<Config> {
		const cwd = session.cwd || process.cwd();
		// Resolve credentials: env vars take precedence, then session provider.
		const providerId = process.env.CLINE_PROVIDER ?? session.currentProviderId;
		const apiKey = process.env.CLINE_API_KEY ?? this.authResult?.apiKey ?? "";
		const systemPrompt = await resolveSystemPrompt({
			cwd,
			providerId,
			mode: session.currentMode,
		});

		return {
			providerId,
			modelId: session.currentModelId,
			apiKey,
			systemPrompt,
			maxIterations: undefined,
			execution: undefined,
			verbose: false,
			sandbox: false,
			thinking: false,
			showUsage: false,
			outputMode: "text",
			mode: session.currentMode,
			defaultToolAutoApprove: false,
			toolPolicies: { "*": { autoApprove: false } },
			enableSpawnAgent: true,
			enableAgentTeams: false,
			enableTools: true,
			cwd,
			workspaceRoot: resolveWorkspaceRoot(cwd),
		};
	}
}

async function buildProviderConfigOption(
	currentProviderId: string,
): Promise<SessionConfigOption> {
	const options = await Promise.all(
		ACP_AUTH_METHODS.map(async (m) => {
			const provider = await Llms.getProvider(m.id);
			return {
				value: m.id,
				name: provider?.name ?? m.id,
			};
		}),
	);
	return {
		type: "select",
		id: "provider",
		name: "Provider",
		description: "The authentication provider to use",
		category: "model",
		currentValue: currentProviderId,
		options,
	};
}

function buildModelConfigOption(
	currentModelId: string,
	providerModels: Record<string, { name?: string; description?: string }>,
): SessionConfigOption {
	return {
		type: "select",
		id: "model",
		name: "Model",
		category: "model",
		currentValue: currentModelId,
		options: Object.entries(providerModels).map(([modelId, info]) => ({
			value: modelId,
			name: info.name ?? modelId,
			description: info.description,
		})),
	};
}

function buildModeConfigOption(currentMode: string): SessionConfigOption {
	return {
		type: "select",
		id: "mode",
		name: "Session Mode",
		description: "Controls whether the agent can modify files",
		category: "mode",
		currentValue: currentMode,
		options: [
			{
				value: "plan",
				name: "Plan",
				description:
					"Explore the codebase and plan changes without modifying files",
			},
			{
				value: "act",
				name: "Act",
				description: "Make changes to the codebase",
			},
		],
	};
}

async function buildAllConfigOptions(
	session: SessionState,
): Promise<SessionConfigOption[]> {
	const [providerOption, providerModels] = await Promise.all([
		buildProviderConfigOption(session.currentProviderId),
		Llms.getModelsForProvider(session.currentProviderId),
	]);
	return [
		providerOption,
		buildModelConfigOption(session.currentModelId, providerModels),
		buildModeConfigOption(session.currentMode),
	];
}

function extractTextFromContentBlocks(blocks: ContentBlock[]): string {
	return blocks
		.filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
		.map((b) => b.text)
		.join("\n");
}

function mapFinishReason(reason: string): StopReason {
	switch (reason) {
		case "completed":
			return "end_turn";
		case "aborted":
			return "cancelled";
		case "max_iterations":
			return "max_turn_requests";
		case "mistake_limit":
			return "end_turn";
		default:
			return "end_turn";
	}
}
