import type {
	ScheduleExecutionRecord,
	ScheduleRecord,
} from "@clinebot/scheduler";
import { fromProtoStruct, toProtoStruct } from "../proto/serde";
import type { RpcSessionRow, RpcSessionStatus } from "../types";
import type {
	ScheduleExecutionMessage,
	ScheduleMessage,
	SessionRecordMessage,
} from "./proto-types";

export function nowIso(): string {
	return new Date().toISOString();
}

const DEFAULT_RPC_ERROR_MESSAGE_MAX = 4096;

/**
 * Produces a gRPC status message that preserves Error details (name, message,
 * stack, optional cause chain) instead of flattening to `[object Object]`.
 */
export function formatRpcCallbackError(
	error: unknown,
	maxLength = DEFAULT_RPC_ERROR_MESSAGE_MAX,
): string {
	const parts: string[] = [];
	let current: unknown = error;
	let depth = 0;
	const maxDepth = 8;
	while (current !== undefined && current !== null && depth < maxDepth) {
		depth += 1;
		if (current instanceof Error) {
			const chunk = current.stack?.includes(current.message)
				? current.stack
				: `${current.name}: ${current.message}`;
			parts.push(chunk);
			current =
				"cause" in current
					? (current as Error & { cause?: unknown }).cause
					: undefined;
		} else {
			parts.push(String(current));
			break;
		}
	}
	const out = parts.join("\nCaused by: ");
	if (out.length <= maxLength) {
		return out;
	}
	return `${out.slice(0, Math.max(0, maxLength - 16))}\n...[truncated]`;
}

export function safeString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function normalizeMetadataMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object") {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		const normalizedKey = key.trim();
		if (!normalizedKey) {
			continue;
		}
		const normalizedValue = safeString(raw).trim();
		if (!normalizedValue) {
			continue;
		}
		out[normalizedKey] = normalizedValue;
	}
	return out;
}

export function normalizeSessionIds(
	sessionIds: string[] | undefined,
): Set<string> | undefined {
	if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
		return undefined;
	}
	const out = new Set<string>();
	for (const sessionId of sessionIds) {
		const trimmed = sessionId.trim();
		if (trimmed) {
			out.add(trimmed);
		}
	}
	return out.size > 0 ? out : undefined;
}

export function normalizeStatus(value: string): RpcSessionStatus {
	if (
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	) {
		return value;
	}
	return "running";
}

export function rowToMessage(row: RpcSessionRow): SessionRecordMessage {
	return {
		sessionId: row.sessionId,
		source: row.source,
		pid: row.pid,
		startedAt: row.startedAt,
		endedAt: row.endedAt ?? "",
		exitCode: row.exitCode ?? 0,
		status: row.status,
		statusLock: row.statusLock,
		interactive: row.interactive,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspaceRoot: row.workspaceRoot,
		teamName: row.teamName ?? "",
		enableTools: row.enableTools,
		enableSpawn: row.enableSpawn,
		enableTeams: row.enableTeams,
		parentSessionId: row.parentSessionId ?? "",
		parentAgentId: row.parentAgentId ?? "",
		agentId: row.agentId ?? "",
		conversationId: row.conversationId ?? "",
		isSubagent: row.isSubagent,
		prompt: row.prompt ?? "",
		transcriptPath: row.transcriptPath,
		messagesPath: row.messagesPath ?? "",
		updatedAt: row.updatedAt,
		metadata: toProtoStruct(row.metadata),
	};
}

export function messageToRow(message: SessionRecordMessage): RpcSessionRow {
	const sessionId = safeString(message.sessionId).trim();
	const source = safeString(message.source).trim();
	const startedAt = safeString(message.startedAt).trim();
	const provider = safeString(message.provider).trim();
	const model = safeString(message.model).trim();
	const cwd = safeString(message.cwd).trim();
	const workspaceRoot = safeString(message.workspaceRoot).trim();
	const transcriptPath = safeString(message.transcriptPath).trim();
	if (
		!sessionId ||
		!source ||
		!startedAt ||
		!provider ||
		!model ||
		!cwd ||
		!workspaceRoot ||
		!transcriptPath
	) {
		throw new Error("session record is missing required fields");
	}
	return {
		sessionId,
		source,
		pid: Number(message.pid ?? 0),
		startedAt,
		endedAt: safeString(message.endedAt).trim() || null,
		exitCode:
			typeof message.exitCode === "number"
				? Math.floor(message.exitCode)
				: null,
		status: normalizeStatus(safeString(message.status).trim()),
		statusLock:
			typeof message.statusLock === "number"
				? Math.floor(message.statusLock)
				: 0,
		interactive: message.interactive === true,
		provider,
		model,
		cwd,
		workspaceRoot,
		teamName: safeString(message.teamName).trim() || undefined,
		enableTools: message.enableTools === true,
		enableSpawn: message.enableSpawn === true,
		enableTeams: message.enableTeams === true,
		parentSessionId: safeString(message.parentSessionId).trim() || undefined,
		parentAgentId: safeString(message.parentAgentId).trim() || undefined,
		agentId: safeString(message.agentId).trim() || undefined,
		conversationId: safeString(message.conversationId).trim() || undefined,
		isSubagent: message.isSubagent === true,
		prompt: safeString(message.prompt).trim() || undefined,
		metadata: fromProtoStruct(message.metadata),
		transcriptPath,
		messagesPath: safeString(message.messagesPath).trim() || undefined,
		updatedAt: safeString(message.updatedAt).trim() || nowIso(),
	};
}

export function parseJsonArrayString(value: string): string[] | undefined {
	const raw = safeString(value).trim();
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return undefined;
		}
		const out = parsed
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
		return out.length > 0 ? out : undefined;
	} catch {
		return undefined;
	}
}

export function parseJsonObjectString(
	value: string,
): Record<string, unknown> | undefined {
	const raw = safeString(value).trim();
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Ignore malformed payload.
	}
	return undefined;
}

export function scheduleToMessage(schedule: ScheduleRecord): ScheduleMessage {
	return {
		scheduleId: schedule.scheduleId,
		name: schedule.name,
		cronPattern: schedule.cronPattern,
		prompt: schedule.prompt,
		provider: schedule.provider,
		model: schedule.model,
		mode: schedule.mode,
		workspaceRoot: schedule.workspaceRoot ?? "",
		cwd: schedule.cwd ?? "",
		systemPrompt: schedule.systemPrompt ?? "",
		maxIterations: schedule.maxIterations ?? 0,
		hasMaxIterations: typeof schedule.maxIterations === "number",
		timeoutSeconds: schedule.timeoutSeconds ?? 0,
		hasTimeoutSeconds: typeof schedule.timeoutSeconds === "number",
		maxParallel: schedule.maxParallel,
		enabled: schedule.enabled,
		createdAt: schedule.createdAt,
		updatedAt: schedule.updatedAt,
		lastRunAt: schedule.lastRunAt ?? "",
		nextRunAt: schedule.nextRunAt ?? "",
		createdBy: schedule.createdBy ?? "",
		tagsJson: schedule.tags ? JSON.stringify(schedule.tags) : "",
		metadata: toProtoStruct(schedule.metadata),
	};
}

export function scheduleExecutionToMessage(
	execution: ScheduleExecutionRecord,
): ScheduleExecutionMessage {
	return {
		executionId: execution.executionId,
		scheduleId: execution.scheduleId,
		sessionId: execution.sessionId ?? "",
		triggeredAt: execution.triggeredAt,
		startedAt: execution.startedAt ?? "",
		endedAt: execution.endedAt ?? "",
		status: execution.status,
		exitCode: execution.exitCode ?? 0,
		hasExitCode: typeof execution.exitCode === "number",
		errorMessage: execution.errorMessage ?? "",
		iterations: execution.iterations ?? 0,
		hasIterations: typeof execution.iterations === "number",
		tokensUsed: execution.tokensUsed ?? 0,
		hasTokensUsed: typeof execution.tokensUsed === "number",
		costUsd: execution.costUsd ?? 0,
		hasCostUsd: typeof execution.costUsd === "number",
	};
}
