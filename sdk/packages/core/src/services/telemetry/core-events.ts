import {
	type ITelemetryService,
	SDK_ERROR_TELEMETRY_EVENT,
	type TelemetryProperties,
} from "@cline/shared";

const MAX_ERROR_MESSAGE_LENGTH = 500;

export type TelemetryAgentKind =
	| "root"
	| "subagent"
	| "team_lead"
	| "team_teammate";

export interface TelemetryAgentIdentityProperties {
	agentId: string;
	agentKind: TelemetryAgentKind;
	conversationId?: string;
	parentAgentId?: string;
	createdByAgentId?: string;
	isSubagent: boolean;
	teamId?: string;
	teamName?: string;
	teamRole?: "lead" | "teammate";
	teamAgentId?: string;
}

export const CORE_TELEMETRY_EVENTS = {
	CLIENT: {
		EXTENSION_ACTIVATED: "user.extension_activated",
	},
	SESSION: {
		STARTED: "session.started",
		ENDED: "session.ended",
	},
	USER: {
		AUTH_STARTED: "user.auth_started",
		AUTH_SUCCEEDED: "user.auth_succeeded",
		AUTH_FAILED: "user.auth_failed",
		AUTH_LOGGED_OUT: "user.auth_logged_out",
		TELEMETRY_OPT_OUT: "user.opt_out",
	},
	TASK: {
		CREATED: "task.created",
		RESTARTED: "task.restarted",
		COMPLETED: "task.completed",
		CONVERSATION_TURN: "task.conversation_turn",
		TOKEN_USAGE: "task.tokens",
		MODE_SWITCH: "task.mode",
		TOOL_USED: "task.tool_used",
		SKILL_USED: "task.skill_used",
		DIFF_EDIT_FAILED: "task.diff_edit_failed",
		PROVIDER_API_ERROR: "task.provider_api_error",
		MENTION_USED: "task.mention_used",
		MENTION_FAILED: "task.mention_failed",
		MENTION_SEARCH_RESULTS: "task.mention_search_results",
		AGENT_CREATED: "task.agent_created",
		AGENT_TEAM_CREATED: "task.agent_team_created",
		SUBAGENT_STARTED: "task.subagent_started",
		SUBAGENT_COMPLETED: "task.subagent_completed",
	},
	HOOKS: {
		DISCOVERY_COMPLETED: "hooks.discovery_completed",
	},
	WORKSPACE: {
		INITIALIZED: "workspace.initialized",
		INIT_ERROR: "workspace.init_error",
		PATH_RESOLVED: "workspace.path_resolved",
	},
	SDK: {
		ERROR: SDK_ERROR_TELEMETRY_EVENT,
	},
} as const;

export interface WorkspaceInitializedProperties {
	root_count: number;
	vcs_types: ReadonlyArray<string>;
	init_duration_ms?: number;
	feature_flag_enabled?: boolean;
	is_remote_workspace?: boolean;
}

export interface WorkspaceInitErrorProperties {
	fallback_to_single_root: boolean;
	workspace_count?: number;
}

export interface WorkspacePathResolvedProperties {
	ulid: string;
	context: string;
	resolution_type:
		| "hint_provided"
		| "fallback_to_primary"
		| "cross_workspace_search";
	hint_type?: "workspace_name" | "workspace_path" | "invalid";
	resolution_success?: boolean;
	target_workspace_index?: number;
	is_multi_root_enabled?: boolean;
}

function emit(
	telemetry: ITelemetryService | undefined,
	event: string,
	properties?: TelemetryProperties,
): void {
	telemetry?.capture({ event, properties });
}

function truncateErrorMessage(errorMessage?: string): string | undefined {
	if (!errorMessage) {
		return undefined;
	}
	return errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH);
}

function normalizeErrorType(error: Error | string): string {
	if (typeof error === "string") {
		return "Error";
	}
	return error.name?.trim() || error.constructor?.name || "Error";
}

function normalizeErrorMessage(error: Error | string): string {
	return typeof error === "string" ? error : error.message;
}

function hasVcsType(
	vcsTypes: ReadonlyArray<string>,
	candidates: ReadonlySet<string>,
): boolean {
	return vcsTypes.some((type) => candidates.has(type.trim().toLowerCase()));
}

export function captureExtensionActivated(
	telemetry: ITelemetryService | undefined,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.CLIENT.EXTENSION_ACTIVATED);
}

export function captureWorkspaceInitialized(
	telemetry: ITelemetryService | undefined,
	properties: WorkspaceInitializedProperties,
): void {
	const vcsTypes = [...properties.vcs_types];
	const payload: TelemetryProperties = {
		root_count: properties.root_count,
		vcs_types: vcsTypes,
		is_multi_root: properties.root_count > 1,
		has_git: hasVcsType(vcsTypes, new Set(["git"])),
		has_mercurial: hasVcsType(vcsTypes, new Set(["mercurial", "hg"])),
	};
	if (properties.init_duration_ms !== undefined) {
		payload.init_duration_ms = properties.init_duration_ms;
	}
	if (properties.feature_flag_enabled !== undefined) {
		payload.feature_flag_enabled = properties.feature_flag_enabled;
	}
	if (properties.is_remote_workspace !== undefined) {
		payload.is_remote_workspace = properties.is_remote_workspace;
	}
	emit(telemetry, CORE_TELEMETRY_EVENTS.WORKSPACE.INITIALIZED, payload);
}

export function captureWorkspaceInitError(
	telemetry: ITelemetryService | undefined,
	error: Error | string,
	properties: WorkspaceInitErrorProperties,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.WORKSPACE.INIT_ERROR, {
		error_type: normalizeErrorType(error),
		error_message: truncateErrorMessage(normalizeErrorMessage(error)),
		fallback_to_single_root: properties.fallback_to_single_root,
		workspace_count: properties.workspace_count ?? 0,
	});
}

export function captureWorkspacePathResolved(
	telemetry: ITelemetryService | undefined,
	properties: WorkspacePathResolvedProperties,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.WORKSPACE.PATH_RESOLVED, {
		...properties,
	});
}

export function captureAuthStarted(
	telemetry: ITelemetryService | undefined,
	provider?: string,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.USER.AUTH_STARTED, { provider });
}

export function captureAuthSucceeded(
	telemetry: ITelemetryService | undefined,
	provider?: string,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.USER.AUTH_SUCCEEDED, { provider });
}

export function captureAuthFailed(
	telemetry: ITelemetryService | undefined,
	provider?: string,
	errorMessage?: string,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.USER.AUTH_FAILED, {
		provider,
		errorMessage: truncateErrorMessage(errorMessage),
	});
}

export function captureAuthLoggedOut(
	telemetry: ITelemetryService | undefined,
	provider?: string,
	reason?: string,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.USER.AUTH_LOGGED_OUT, {
		provider,
		reason,
	});
}

export function captureTelemetryOptOut(
	telemetry: ITelemetryService | undefined,
	properties?: TelemetryProperties,
): void {
	telemetry?.captureRequired(
		CORE_TELEMETRY_EVENTS.USER.TELEMETRY_OPT_OUT,
		properties,
	);
}

export function identifyAccount(
	telemetry: ITelemetryService | undefined,
	account: {
		id?: string;
		email?: string;
		provider?: string;
		organizationId?: string;
		organizationName?: string;
		memberId?: string;
	},
): void {
	const distinctId = account.id?.trim();
	if (distinctId) {
		telemetry?.setDistinctId(distinctId);
	}
	telemetry?.updateCommonProperties({
		account_id: account.id,
		account_email: account.email,
		provider: account.provider,
		organization_id: account.organizationId,
		organization_name: account.organizationName,
		member_id: account.memberId,
	});
}

export function captureTaskCreated(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		apiProvider?: string;
		openAiCompatibleDomain?: string;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.CREATED, properties);
}

export function captureTaskRestarted(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		apiProvider?: string;
		openAiCompatibleDomain?: string;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.RESTARTED, properties);
}

/**
 * Distinguishes the trigger that produced a `task.completed` telemetry event.
 *
 * - `submit_and_exit`: the assistant explicitly declared completion by
 *   invoking the canonical completion tool. Parity with original Cline's
 *   `attempt_completion`-anchored emission.
 * - `shutdown`: the session lifecycle completed (typically a non-interactive
 *   single-run that finished without an explicit completion tool). Acts as a
 *   safety-net so we still report completed runs that never observed
 *   `submit_and_exit`.
 */
export type TaskCompletedSource = "submit_and_exit" | "shutdown";

export function captureTaskCompleted(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		provider?: string;
		modelId?: string;
		mode?: string;
		durationMs?: number;
		source?: TaskCompletedSource;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.COMPLETED, properties);
}

export function captureConversationTurnEvent(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		provider?: string;
		model?: string;
		source: "user" | "assistant";
		mode?: string;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.CONVERSATION_TURN, {
		...properties,
		timestamp: new Date().toISOString(),
	});
}

export function captureTokenUsage(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		tokensIn: number;
		tokensOut: number;
		cacheWriteTokens?: number;
		cacheReadTokens?: number;
		totalCost?: number;
		model: string;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.TOKEN_USAGE, properties);
}

export function captureModeSwitch(
	telemetry: ITelemetryService | undefined,
	ulid: string,
	mode?: string,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.MODE_SWITCH, { ulid, mode });
}

export function captureToolUsage(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		tool: string;
		modelId?: string;
		provider?: string;
		autoApproved?: boolean;
		success: boolean;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.TOOL_USED, properties);
}

export function captureSkillUsed(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		skillName: string;
		skillSource: "global" | "project";
		skillsAvailableGlobal: number;
		skillsAvailableProject: number;
		provider?: string;
		modelId?: string;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.SKILL_USED, properties);
}

export function captureDiffEditFailure(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		modelId?: string;
		provider?: string;
		errorType?: string;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.DIFF_EDIT_FAILED, properties);
}

export function captureProviderApiError(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		model: string;
		errorMessage: string;
		provider?: string;
		errorStatus?: number;
		requestId?: string;
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.PROVIDER_API_ERROR, {
		...properties,
		errorMessage: truncateErrorMessage(properties.errorMessage) ?? "unknown",
		timestamp: new Date().toISOString(),
	});
}

export function captureMentionUsed(
	telemetry: ITelemetryService | undefined,
	mentionType:
		| "file"
		| "folder"
		| "url"
		| "problems"
		| "terminal"
		| "git-changes"
		| "commit",
	contentLength?: number,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.MENTION_USED, {
		mentionType,
		contentLength,
		timestamp: new Date().toISOString(),
	});
}

export function captureMentionFailed(
	telemetry: ITelemetryService | undefined,
	mentionType:
		| "file"
		| "folder"
		| "url"
		| "problems"
		| "terminal"
		| "git-changes"
		| "commit",
	errorType:
		| "not_found"
		| "permission_denied"
		| "network_error"
		| "parse_error"
		| "unknown",
	errorMessage?: string,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.MENTION_FAILED, {
		mentionType,
		errorType,
		errorMessage: truncateErrorMessage(errorMessage),
		timestamp: new Date().toISOString(),
	});
}

export function captureMentionSearchResults(
	telemetry: ITelemetryService | undefined,
	query: string,
	resultCount: number,
	searchType: "file" | "folder" | "all",
	isEmpty: boolean,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.MENTION_SEARCH_RESULTS, {
		queryLength: query.length,
		resultCount,
		searchType,
		isEmpty,
		timestamp: new Date().toISOString(),
	});
}

export function captureAgentCreated(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		modelId?: string;
		provider?: string;
	} & TelemetryAgentIdentityProperties,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.AGENT_CREATED, {
		...properties,
		timestamp: new Date().toISOString(),
	});
}

export function captureAgentTeamCreated(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		teamId: string;
		teamName: string;
		leadAgentId?: string;
		restoredFromPersistence?: boolean;
	},
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.TASK.AGENT_TEAM_CREATED, {
		...properties,
		timestamp: new Date().toISOString(),
	});
}

export function captureSubagentExecution(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		durationMs: number;
		outputLines?: number;
		event: "created" | "started" | "ended";
		agentId: string;
		parentId?: string;
		errorMessage?: string;
		type?: "agent" | "team";
	} & Partial<TelemetryAgentIdentityProperties>,
): void {
	emit(
		telemetry,
		properties.event === "ended"
			? CORE_TELEMETRY_EVENTS.TASK.SUBAGENT_COMPLETED
			: CORE_TELEMETRY_EVENTS.TASK.SUBAGENT_STARTED,
		{
			...properties,
			timestamp: new Date().toISOString(),
		},
	);
}

export function captureHookDiscovery(
	telemetry: ITelemetryService | undefined,
	hookName: string,
	globalCount: number,
	workspaceCount: number,
): void {
	emit(telemetry, CORE_TELEMETRY_EVENTS.HOOKS.DISCOVERY_COMPLETED, {
		hookName,
		globalCount,
		workspaceCount,
		totalCount: globalCount + workspaceCount,
		timestamp: new Date().toISOString(),
	});
}
