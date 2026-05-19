import type { ChatStartSessionRequest, RuntimeLoggerConfig } from "@cline/core";
import {
	CoreSessionService,
	HubSessionClient,
	Llms,
	ProviderSettingsManager,
	SqliteSessionStore,
} from "@cline/core";
import type { Thread } from "chat";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
} from "../commands/auth";
import type { CliLoggerAdapter } from "../logging/adapter";
import { resolveSystemPrompt } from "../runtime/prompt";
import { resolveCliSessionMetadata } from "../utils/enterprise";
import { resolveWorkspaceRoot } from "../utils/helpers";
import {
	parseLocalRowMetadata,
	parseRowMetadata,
	readSessionReplyText,
} from "./common";
import { dispatchConnectorHook } from "./hooks";
import {
	type ConnectorThreadState,
	loadThreadState,
	persistMergedThreadState,
} from "./thread-bindings";
import type { ConnectIo } from "./types";

async function resolveProviderApiKeyFromEnv(
	provider: string,
): Promise<string | undefined> {
	const envKeys =
		(await Llms.getProviderCollection(provider))?.provider?.env ?? [];
	for (const envKey of envKeys) {
		const value = process.env[envKey]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

export async function buildConnectorStartRequest(input: {
	options: {
		cwd: string;
		model?: string;
		provider?: string;
		apiKey?: string;
		systemPrompt?: string;
		mode: "act" | "plan";
		enableTools: boolean;
	};
	io: ConnectIo;
	loggerConfig: RuntimeLoggerConfig;
	systemRules: string;
	defaultModel?: string;
}): Promise<ChatStartSessionRequest> {
	const providerSettingsManager = new ProviderSettingsManager();
	const lastUsedProviderSettings =
		providerSettingsManager.getLastUsedProviderSettings();
	const provider = normalizeProviderId(
		input.options.provider?.trim() ||
			lastUsedProviderSettings?.provider ||
			"cline",
	);
	let selectedProviderSettings =
		providerSettingsManager.getProviderSettings(provider);
	const persistedApiKey = getPersistedProviderApiKey(
		provider,
		selectedProviderSettings,
	);
	let apiKey =
		input.options.apiKey?.trim() ||
		persistedApiKey ||
		(await resolveProviderApiKeyFromEnv(provider)) ||
		"";

	if (!apiKey && isOAuthProvider(provider)) {
		const oauthResult = await ensureOAuthProviderApiKey({
			providerId: provider,
			currentApiKey: apiKey,
			existingSettings: selectedProviderSettings,
			providerSettingsManager,
			io: input.io,
		});
		selectedProviderSettings = oauthResult.selectedProviderSettings;
		apiKey = oauthResult.apiKey ?? "";
	}

	const cwd = input.options.cwd;
	const systemPrompt = await resolveSystemPrompt({
		cwd,
		explicitSystemPrompt: input.options.systemPrompt,
		providerId: provider,
		rules: input.systemRules,
	});

	return {
		workspaceRoot: resolveWorkspaceRoot(cwd),
		cwd,
		provider,
		model:
			input.options.model?.trim() ||
			selectedProviderSettings?.model ||
			input.defaultModel ||
			"anthropic/claude-sonnet-4.6",
		mode: input.options.mode,
		apiKey,
		systemPrompt,
		logger: input.loggerConfig,
		enableTools: input.options.enableTools,
		autoApproveTools: false,
	};
}

export function buildThreadStartRequest<TState extends ConnectorThreadState>(
	base: ChatStartSessionRequest,
	state: TState,
): ChatStartSessionRequest {
	const enableTools = state.enableTools ?? base.enableTools;
	return {
		...base,
		enableTools,
		enableSpawn: enableTools,
		enableTeams: enableTools,
		autoApproveTools: state.autoApproveTools ?? base.autoApproveTools,
		cwd: state.cwd || base.cwd,
		workspaceRoot: state.workspaceRoot || base.workspaceRoot,
		systemPrompt: state.systemPrompt || base.systemPrompt,
	};
}

export async function getOrCreateSessionId<
	TState extends ConnectorThreadState,
>(input: {
	thread: Thread<TState>;
	client: HubSessionClient;
	startRequest: ChatStartSessionRequest;
	logger: CliLoggerAdapter;
	clientId: string;
	transport: string;
	bindingsPath: string;
	errorLabel: string;
	hookCommand?: string;
	hookBotUserName?: string;
	sessionMetadata: Record<string, unknown>;
	reusedLogMessage: string;
	startedLogMessage?: string;
}): Promise<string> {
	const threadState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.startRequest,
	);
	const existing = threadState.sessionId?.trim();
	if (existing) {
		await persistMergedThreadState(
			input.thread,
			input.bindingsPath,
			{
				...threadState,
				sessionId: existing,
			},
			input.errorLabel,
		);
		input.logger.core.log(input.reusedLogMessage, {
			transport: input.transport,
			threadId: input.thread.id,
			sessionId: existing,
		});
		await dispatchConnectorHook(
			input.hookCommand,
			{
				adapter: input.transport,
				botUserName: input.hookBotUserName,
				event: "session.reused",
				payload: {
					threadId: input.thread.id,
					channelId: input.thread.channelId,
					sessionId: existing,
				},
				ts: new Date().toISOString(),
			},
			input.logger,
		);
		return existing;
	}

	const started = await input.client.startRuntimeSession(input.startRequest);
	const sessionId = started.sessionId.trim();
	if (!sessionId) {
		throw new Error("runtime start returned an empty session id");
	}
	const remoteConfigMetadata = await resolveCliSessionMetadata(sessionId).catch(
		() => undefined,
	);

	await input.client
		.updateSession({
			sessionId,
			metadata: {
				transport: input.transport,
				...input.sessionMetadata,
				...(remoteConfigMetadata ?? {}),
				...(threadState.participantKey
					? { participantKey: threadState.participantKey }
					: {}),
				...(threadState.participantLabel
					? { participantLabel: threadState.participantLabel }
					: {}),
				isDM: input.thread.isDM,
				rpcClientId: input.clientId,
				connectorPid: process.pid,
			},
		})
		.catch(() => undefined);

	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...threadState,
			sessionId,
		},
		input.errorLabel,
	);

	if (input.startedLogMessage) {
		input.logger.core.log(input.startedLogMessage, {
			transport: input.transport,
			threadId: input.thread.id,
			channelId: input.thread.channelId,
			isDM: input.thread.isDM,
			sessionId,
		});
	}

	await dispatchConnectorHook(
		input.hookCommand,
		{
			adapter: input.transport,
			botUserName: input.hookBotUserName,
			event: "session.started",
			payload: {
				threadId: input.thread.id,
				channelId: input.thread.channelId,
				isDM: input.thread.isDM,
				sessionId,
			},
			ts: new Date().toISOString(),
		},
		input.logger,
	);

	return sessionId;
}

export async function clearSession<TState extends ConnectorThreadState>(input: {
	thread: Thread<TState>;
	client: HubSessionClient;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	errorLabel: string;
}): Promise<void> {
	const threadState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
	);
	const sessionId = threadState.sessionId?.trim();
	if (sessionId) {
		try {
			await input.client.stopRuntimeSession(sessionId);
		} catch {}
		try {
			await input.client.deleteSession(sessionId, true);
		} catch {}
	}
	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...threadState,
			sessionId: undefined,
		},
		input.errorLabel,
	);
}

export async function stopConnectorSessions(input: {
	rpcAddress: string;
	localMatcher: (metadata: Record<string, unknown> | undefined) => boolean;
	rpcMatcher: (metadata: Record<string, unknown> | undefined) => boolean;
}): Promise<number> {
	const client = new HubSessionClient({ address: input.rpcAddress });
	try {
		const rows = await client.listSessions({ limit: 5000 });
		const filtered = rows.filter((row) => {
			const { metadata, parentSessionId } = parseRowMetadata(row);
			return !parentSessionId && input.rpcMatcher(metadata);
		});
		await Promise.allSettled(
			filtered.map(async (row) => {
				try {
					await client.stopRuntimeSession(row.sessionId);
				} catch {}
				try {
					await client.deleteSession(row.sessionId, true);
				} catch {}
			}),
		);
		return filtered.length;
	} catch {
		// Fall back to local storage when the RPC server is unavailable.
	} finally {
		client.close();
	}

	const service = new CoreSessionService(new SqliteSessionStore());
	const rows = await service.listSessions(5000);
	const filtered = rows.filter((row) => {
		if (row.parentSessionId?.trim()) {
			return false;
		}
		return input.localMatcher(parseLocalRowMetadata(row));
	});
	await Promise.allSettled(
		filtered.map(async (row) => {
			await service.deleteSession(row.sessionId);
		}),
	);
	return filtered.length;
}

export { readSessionReplyText };
