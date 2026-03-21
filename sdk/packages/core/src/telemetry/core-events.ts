import type { ITelemetryService, TelemetryProperties } from "@clinebot/shared";

const MAX_ERROR_MESSAGE_LENGTH = 500;

export const LegacyTelemetryEvents = {
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
	emit(telemetry, LegacyTelemetryEvents.USER.AUTH_STARTED, { provider });
}

export function captureAuthSucceeded(
	telemetry: ITelemetryService | undefined,
	provider?: string,
): void {
	emit(telemetry, LegacyTelemetryEvents.USER.AUTH_SUCCEEDED, { provider });
}

export function captureAuthFailed(
	telemetry: ITelemetryService | undefined,
	provider?: string,
	errorMessage?: string,
): void {
	emit(telemetry, LegacyTelemetryEvents.USER.AUTH_FAILED, {
		provider,
		errorMessage: truncateErrorMessage(errorMessage),
	});
}

export function captureAuthLoggedOut(
	telemetry: ITelemetryService | undefined,
	provider?: string,
	reason?: string,
): void {
	emit(telemetry, LegacyTelemetryEvents.USER.AUTH_LOGGED_OUT, {
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
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.CREATED, properties);
}

export function captureTaskRestarted(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		apiProvider?: string;
		openAiCompatibleDomain?: string;
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.RESTARTED, properties);
}

export function captureTaskCompleted(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		provider?: string;
		modelId?: string;
		mode?: string;
		durationMs?: number;
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.COMPLETED, properties);
}

export function captureConversationTurnEvent(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		provider?: string;
		model?: string;
		source: "user" | "assistant";
		mode?: string;
		tokensIn?: number;
		tokensOut?: number;
		cacheWriteTokens?: number;
		cacheReadTokens?: number;
		totalCost?: number;
		isNativeToolCall?: boolean;
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.CONVERSATION_TURN, {
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
		model: string;
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.TOKEN_USAGE, properties);
}

export function captureModeSwitch(
	telemetry: ITelemetryService | undefined,
	ulid: string,
	mode?: string,
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.MODE_SWITCH, { ulid, mode });
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
		isNativeToolCall?: boolean;
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.TOOL_USED, properties);
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
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.SKILL_USED, properties);
}

export function captureDiffEditFailure(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		modelId?: string;
		provider?: string;
		errorType?: string;
		isNativeToolCall?: boolean;
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.DIFF_EDIT_FAILED, properties);
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
		isNativeToolCall?: boolean;
	},
): void {
	emit(telemetry, LegacyTelemetryEvents.TASK.PROVIDER_API_ERROR, {
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
	emit(telemetry, LegacyTelemetryEvents.TASK.MENTION_USED, {
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
	emit(telemetry, LegacyTelemetryEvents.TASK.MENTION_FAILED, {
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
	emit(telemetry, LegacyTelemetryEvents.TASK.MENTION_SEARCH_RESULTS, {
		queryLength: query.length,
		resultCount,
		searchType,
		isEmpty,
		timestamp: new Date().toISOString(),
	});
}

export function captureSubagentExecution(
	telemetry: ITelemetryService | undefined,
	properties: {
		ulid: string;
		durationMs: number;
		outputLines: number;
		success: boolean;
	},
): void {
	emit(
		telemetry,
		properties.success
			? LegacyTelemetryEvents.TASK.SUBAGENT_COMPLETED
			: LegacyTelemetryEvents.TASK.SUBAGENT_STARTED,
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
	emit(telemetry, LegacyTelemetryEvents.HOOKS.DISCOVERY_COMPLETED, {
		hookName,
		globalCount,
		workspaceCount,
		totalCount: globalCount + workspaceCount,
		timestamp: new Date().toISOString(),
	});
}
