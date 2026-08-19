import type {
	Agent,
	AgentSideConnection,
	AuthenticateRequest,
	AuthenticateResponse,
	CancelNotification,
	ContentBlock,
	InitializeRequest,
	InitializeResponse,
	LoadSessionRequest,
	LoadSessionResponse,
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
} from "@cline/core";
import { isLikelyAuthError, type MessageWithMetadata } from "@cline/shared";
import { getPersistedProviderApiKey } from "../commands/auth";
import { resolveSystemPrompt } from "../runtime/prompt";
import { subscribeToAgentEvents } from "../runtime/session-events";
import { createCliCore } from "../session/session";
import { isClineOrgIndividualInferenceSubscriptionErrorMessage } from "../utils/cline-pass-errors";
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
import {
	AUTO_APPROVE_CONFIG_ID,
	buildAutoApproveConfigOption,
	parseAutoApproveValue,
} from "./auto-approve";
import {
	buildOrganizationConfigOption,
	fetchClineOrganizations,
	getAcpOrgSubscriptionMessage,
	ORGANIZATION_CONFIG_ID,
	PERSONAL_ACCOUNT_VALUE,
	switchClineOrganization,
	usesClineAccount,
} from "./organizations";
import { requestAcpToolApproval } from "./permissions";
import { replaySessionHistory } from "./session-load";
import {
	describeAgentError,
	forwardAgentEvent,
	sendConfigOptionUpdate,
	sendCurrentModeUpdate,
	sendSessionInfoUpdate,
} from "./session-updates";

const CHAT_MODEL_QUERY_OPTIONS = {
	filter: "chat",
} satisfies Llms.GetModelsForProviderOptions;

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
	/** When true, all tool calls are approved without asking the client. */
	autoApproveTools: boolean;
	/** Active session manager for the running agent, if any. */
	sessionManager?: ClineCore;
	/** Internal session id within the session manager. */
	activeSessionId?: string;
	/** Abort controller for the current prompt, if running. */
	abortController?: AbortController;
	/** Unsubscribe function for the agent event listener. */
	unsubscribe?: () => void;
	/**
	 * Most recent unrecoverable agent error for the in-flight turn.
	 *
	 * The runtime reports fatal failures (bad credentials, subscription
	 * restrictions, provider outages) as an `error` event and still resolves
	 * `send()` normally, so the message has to be stashed here for `prompt()` to
	 * turn into an error response.
	 */
	fatalError?: Error;
	/** Messages to inject into the next session manager for conversation continuity. */
	pendingInitialMessages?: MessageWithMetadata[];
}

export class AcpAgent implements Agent {
	private sessions = new Map<string, SessionState>();
	private readonly conn: AgentSideConnection;
	private readonly providerSettingsManager = new ProviderSettingsManager();
	private readonly defaultAutoApproveTools: boolean;

	/** Set after a successful `authenticate` call. */
	private authResult?: AcpAuthResult;

	constructor(
		conn: AgentSideConnection,
		options?: { autoApproveTools?: boolean },
	) {
		this.conn = conn;
		this.defaultAutoApproveTools = options?.autoApproveTools ?? false;
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

	isSessionReady() {
		// Require authentication unless an API key is provided via env var.
		if (!this.authResult && !process.env.CLINE_API_KEY) {
			// Check for valid persisted credentials from a previous session
			// before forcing the client to re-authenticate.
			this.authResult = this.tryRestoreAuth();

			if (!this.authResult) {
				throw RequestError.authRequired(
					undefined,
					"Call authenticate before starting a session",
				);
			}
		}
	}

	availableModes() {
		return [
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
		];
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		this.isSessionReady();

		const sessionId = randomSessionId();

		const defaultMode = "act";
		const providerId =
			process.env.CLINE_PROVIDER ?? this.authResult?.providerId ?? "cline";

		const providerModels = await Llms.getModelsForProvider(
			providerId,
			CHAT_MODEL_QUERY_OPTIONS,
		);
		// Model ids are provider-scoped, so the default must come from the
		// provider's own catalog: `cline-pass` uses `cline-pass/…` ids that mean
		// nothing to `cline`, and vice versa.
		const defaultModelId = await resolveDefaultModelId(
			providerId,
			process.env.CLINE_MODEL,
			providerModels,
		);

		this.sessions.set(sessionId, {
			id: sessionId,
			cwd: params.cwd,
			mcpServers: params.mcpServers,
			currentMode: defaultMode,
			currentProviderId: providerId,
			currentModelId: defaultModelId,
			autoApproveTools: this.defaultAutoApproveTools,
		});

		const availableModels = Object.entries(providerModels).map(
			([modelId, info]) => ({
				modelId,
				name: info.name ?? modelId,
				description: info.description,
			}),
		);

		const organizationOption =
			await this.getOrganizationConfigOption(providerId);

		return {
			sessionId,
			modes: {
				availableModes: this.availableModes(),
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
				buildAutoApproveConfigOption(this.defaultAutoApproveTools),
				...(organizationOption ? [organizationOption] : []),
			],
		};
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		this.isSessionReady();

		let session = this.sessions.get(params.sessionId);
		let messages: MessageWithMetadata[];

		if (session?.sessionManager && session.activeSessionId) {
			// The session is still live in this connection — replay its current
			// conversation without restarting anything.
			messages =
				(await session.sessionManager.readMessages(session.activeSessionId)) ??
				[];
		} else {
			if (!session) {
				// Provider/model are not persisted per session — a session
				// loaded on a fresh connection starts from the same defaults
				// as a new session, with the model resolved against the
				// provider's own catalog just like newSession.
				const providerId =
					process.env.CLINE_PROVIDER ?? this.authResult?.providerId ?? "cline";
				const providerModels = await Llms.getModelsForProvider(
					providerId,
					CHAT_MODEL_QUERY_OPTIONS,
				);
				session = {
					id: params.sessionId,
					cwd: params.cwd,
					mcpServers: params.mcpServers,
					currentMode: "act",
					currentProviderId: providerId,
					currentModelId: await resolveDefaultModelId(
						providerId,
						process.env.CLINE_MODEL,
						providerModels,
					),
					autoApproveTools: this.defaultAutoApproveTools,
				};
				this.sessions.set(params.sessionId, session);
			}
			try {
				messages =
					(await this.ensureSessionManager(session, params.sessionId, {
						resume: true,
					})) ?? [];
			} catch (error) {
				this.sessions.delete(params.sessionId);
				throw error;
			}
		}

		// The ACP spec requires the full conversation to be replayed via
		// session/update notifications before this request resolves.
		await replaySessionHistory(this.conn, params.sessionId, messages);

		const providerModels = await Llms.getModelsForProvider(
			session.currentProviderId,
			CHAT_MODEL_QUERY_OPTIONS,
		);
		const availableModels = Object.entries(providerModels).map(
			([availableModelId, info]) => ({
				modelId: availableModelId,
				name: info.name ?? availableModelId,
				description: info.description,
			}),
		);

		return {
			modes: {
				availableModes: this.availableModes(),
				currentModeId: session.currentMode,
			},
			models: {
				availableModels,
				currentModelId: session.currentModelId,
			},
			configOptions: await buildAllConfigOptions(session),
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
		session.fatalError = undefined;

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

			const activeSessionId = session.activeSessionId;
			const sessionManager = session.sessionManager;
			if (!activeSessionId || !sessionManager) {
				throw new Error("Session manager was not initialized");
			}
			const result = await sessionManager.send({
				sessionId: activeSessionId,
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

		// A cancelled turn always reports `cancelled`: the ACP spec
		// requires agents to convert abort failures into the cancelled stop reason
		// so clients don't show cancellations as errors.
		if (stopReason !== "cancelled") {
			const fatalError = session.fatalError;
			session.fatalError = undefined;
			if (fatalError) {
				throw toAcpPromptError(fatalError);
			}
		}

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

				// Re-resolve the model against the new provider's catalog: keep the
				// current one when it's offered there too, otherwise fall back to the
				// provider's declared default rather than whichever model happens to
				// be listed first (for cline-pass that is an unrelated free model).
				const providerModels = await Llms.getModelsForProvider(
					value,
					CHAT_MODEL_QUERY_OPTIONS,
				);
				session.currentModelId = await resolveDefaultModelId(
					value,
					session.currentModelId,
					providerModels,
				);
				break;
			}

			case ORGANIZATION_CONFIG_ID: {
				try {
					await switchClineOrganization({
						apiKey: this.accountApiKey,
						providerSettingsManager: this.providerSettingsManager,
						organizationId: value === PERSONAL_ACCOUNT_VALUE ? null : value,
					});
				} catch (error) {
					const message = describeAgentError(error);
					throw RequestError.internalError(
						{ message },
						`Failed to switch account: ${message}`,
					);
				}

				// Restart the backend session so subsequent turns run under the
				// newly selected account.
				await this.teardownSessionManager(session);
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

			case AUTO_APPROVE_CONFIG_ID: {
				const autoApprove = parseAutoApproveValue(params.value);
				if (autoApprove === undefined) {
					throw RequestError.invalidParams(
						undefined,
						`Invalid auto-approve value: ${String(params.value)} (must be a boolean)`,
					);
				}
				session.autoApproveTools = autoApprove;
				break;
			}

			default:
				throw RequestError.invalidParams(
					undefined,
					`Unknown config option: ${params.configId}`,
				);
		}

		const configOptions = await buildAllConfigOptions(session);
		const organizationOption = await this.getOrganizationConfigOption(
			session.currentProviderId,
		);
		if (organizationOption) {
			configOptions.push(organizationOption);
		}
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

	private get accountApiKey(): string {
		return process.env.CLINE_API_KEY ?? this.authResult?.apiKey ?? "";
	}

	private async getOrganizationConfigOption(
		providerId: string,
	): Promise<SessionConfigOption | undefined> {
		if (!usesClineAccount(providerId)) {
			return undefined;
		}
		const organizations = await fetchClineOrganizations({
			apiKey: this.accountApiKey,
			providerSettingsManager: this.providerSettingsManager,
		});
		return organizations
			? buildOrganizationConfigOption(organizations)
			: undefined;
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
	 *
	 * With `resume: true` the persisted conversation for `acpSessionId` is read
	 * back through the session manager.
	 */
	private async ensureSessionManager(
		session: SessionState,
		acpSessionId: string,
		options?: { resume?: boolean },
	): Promise<MessageWithMetadata[] | undefined> {
		if (session.sessionManager) {
			return undefined;
		}

		const config = await this.buildConfig(session);

		const sessionManager = await createCliCore({
			toolPolicies: config.toolPolicies,
			capabilities: {
				requestToolApproval: (request) =>
					session.autoApproveTools
						? Promise.resolve({ approved: true })
						: requestAcpToolApproval(this.conn, acpSessionId, request),
			},
			cwd: config.cwd,
			workspaceRoot: config.workspaceRoot,
		});

		let initialMessages: MessageWithMetadata[] | undefined;
		if (options?.resume) {
			initialMessages = await sessionManager
				.readMessages(acpSessionId)
				.catch(() => undefined);

			if (!initialMessages || initialMessages.length === 0) {
				await sessionManager
					.dispose("acp_load_session_not_found")
					.catch(() => {});
				throw RequestError.resourceNotFound(acpSessionId);
			}
		} else {
			initialMessages = session.pendingInitialMessages;
			session.pendingInitialMessages = undefined;
		}

		session.unsubscribe = subscribeToAgentEvents(
			sessionManager,
			(event: AgentEvent) => {
				// Remember unrecoverable failures so prompt() can fail the turn.
				if (event.type === "error" && !event.recoverable) {
					session.fatalError =
						event.error instanceof Error
							? event.error
							: new Error(describeAgentError(event.error));
				}
				forwardAgentEvent(this.conn, acpSessionId, event);
			},
		);

		const started = await sessionManager.start({
			source: SessionSource.CLI,
			// Persist the core session under the ACP session id so that
			// session/load can find the conversation by the id the client holds.
			config: {
				...config,
				modelId: session.currentModelId,
				sessionId: acpSessionId,
			},
			interactive: true,
			initialMessages,
		});

		session.sessionManager = sessionManager;
		session.activeSessionId = started.sessionId;
		return initialMessages;
	}

	private async buildConfig(session: SessionState): Promise<Config> {
		const cwd = session.cwd || process.cwd();
		const workspaceRoot = resolveWorkspaceRoot(cwd);
		// Resolve credentials: env vars take precedence, then session provider.
		const providerId = process.env.CLINE_PROVIDER ?? session.currentProviderId;
		const apiKey = process.env.CLINE_API_KEY ?? this.authResult?.apiKey ?? "";
		const systemPrompt = await resolveSystemPrompt({
			cwd,
			providerId,
			mode: session.currentMode,
		});
		const cliBuildInfo = getCliBuildInfo();

		return {
			providerId,
			modelId: session.currentModelId,
			apiKey,
			systemPrompt,
			execution: undefined,
			verbose: false,
			sandbox: false,
			thinking: false,
			outputMode: "text",
			mode: session.currentMode,
			defaultToolAutoApprove: false,
			toolPolicies: { "*": { autoApprove: false } },
			enableSpawnAgent: true,
			enableAgentTeams: false,
			enableTools: true,
			cwd,
			workspaceRoot,
			extensionContext: {
				client: {
					name: "cline-acp",
					version: cliBuildInfo.version,
					platform: "cli",
					platformVersion: cliBuildInfo.version,
					isMultiRoot: false,
				},
				workspace: {
					rootPath: workspaceRoot,
					cwd,
					workspaceName: cwd,
					ide: "Terminal Shell",
					platform: process.platform,
				},
			},
		};
	}
}

async function resolveDefaultModelId(
	providerId: string,
	preferredModelId: string | undefined,
	providerModels: Record<string, unknown>,
): Promise<string> {
	const modelIds = Object.keys(providerModels);
	const preferred = preferredModelId?.trim();
	if (preferred && modelIds.includes(preferred)) {
		return preferred;
	}
	const providerDefault = (await Llms.getProvider(providerId))?.defaultModelId;
	if (providerDefault && modelIds.includes(providerDefault)) {
		return providerDefault;
	}
	return modelIds[0] ?? "";
}

/**
 * Convert a fatal agent error into a JSON-RPC error for the prompt response.
 *
 * Credential/subscription problems map to `auth_required` (-32000) so clients
 * can offer a re-auth affordance rather than just printing text; everything
 * else is an internal error.
 *
 * Classification goes through the shared CLI helpers, which check the error's
 * type *and* its name/message. That matters because the runtime re-wraps errors
 * as it forwards them across the event boundary, so `instanceof` alone fails on
 * the object ACP actually receives.
 */
function toAcpPromptError(error: Error): RequestError {
	if (isClineOrgIndividualInferenceSubscriptionErrorMessage(error)) {
		const message = getAcpOrgSubscriptionMessage();
		return RequestError.internalError({ message }, message);
	}

	const message = describeAgentError(error);
	const isAuthProblem = isLikelyAuthError(error);
	return isAuthProblem
		? RequestError.authRequired({ message }, message)
		: RequestError.internalError({ message }, message);
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
		Llms.getModelsForProvider(
			session.currentProviderId,
			CHAT_MODEL_QUERY_OPTIONS,
		),
	]);
	return [
		providerOption,
		buildModelConfigOption(session.currentModelId, providerModels),
		buildModeConfigOption(session.currentMode),
		buildAutoApproveConfigOption(session.autoApproveTools),
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
