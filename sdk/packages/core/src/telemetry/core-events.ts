import type { ITelemetryService, TelemetryProperties } from "@clinebot/shared";

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
		STARTED: "extension.activated",
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
} as const;

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

export function captureTaskCompleted(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		provider?: string;
		modelId?: string;
		mode?: string;
		durationMs?: number;
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
