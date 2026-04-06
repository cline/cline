import type { Schedule__Output } from "../proto/generated/cline/rpc/v1/Schedule";
import type { ScheduleExecution__Output } from "../proto/generated/cline/rpc/v1/ScheduleExecution";
import type {
	SessionRecord,
	SessionRecord__Output,
} from "../proto/generated/cline/rpc/v1/SessionRecord";
import { fromProtoStruct, toProtoStruct } from "../proto/serde";
import type {
	RpcScheduleExecution,
	RpcScheduleRecord,
	RpcSessionRow,
} from "../types";

export function toMessage(row: RpcSessionRow): SessionRecord {
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
		hookPath: row.hookPath,
		messagesPath: row.messagesPath ?? "",
		updatedAt: row.updatedAt,
		metadata: toProtoStruct(row.metadata),
	};
}

export function fromMessage(message: SessionRecord__Output): RpcSessionRow {
	return {
		sessionId: message.sessionId ?? "",
		source: message.source ?? "",
		pid: Number(message.pid ?? 0),
		startedAt: message.startedAt ?? "",
		endedAt: message.endedAt ? message.endedAt : null,
		exitCode: typeof message.exitCode === "number" ? message.exitCode : null,
		status: (message.status as RpcSessionRow["status"]) ?? "running",
		statusLock: Number(message.statusLock ?? 0),
		interactive: message.interactive === true,
		provider: message.provider ?? "",
		model: message.model ?? "",
		cwd: message.cwd ?? "",
		workspaceRoot: message.workspaceRoot ?? "",
		teamName: message.teamName || undefined,
		enableTools: message.enableTools === true,
		enableSpawn: message.enableSpawn === true,
		enableTeams: message.enableTeams === true,
		parentSessionId: message.parentSessionId || undefined,
		parentAgentId: message.parentAgentId || undefined,
		agentId: message.agentId || undefined,
		conversationId: message.conversationId || undefined,
		isSubagent: message.isSubagent === true,
		prompt: message.prompt || undefined,
		metadata: fromProtoStruct(message.metadata),
		transcriptPath: message.transcriptPath ?? "",
		hookPath: message.hookPath ?? "",
		messagesPath: message.messagesPath || undefined,
		updatedAt: message.updatedAt ?? "",
	};
}

export function parseJsonArray(raw: string | undefined): string[] | undefined {
	const value = raw?.trim();
	if (!value) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as unknown;
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

export function fromSchedule(message: Schedule__Output): RpcScheduleRecord {
	return {
		scheduleId: message.scheduleId ?? "",
		name: message.name ?? "",
		cronPattern: message.cronPattern ?? "",
		prompt: message.prompt ?? "",
		provider: message.provider ?? "",
		model: message.model ?? "",
		mode: message.mode === "plan" ? "plan" : "act",
		workspaceRoot: message.workspaceRoot?.trim() || undefined,
		cwd: message.cwd?.trim() || undefined,
		systemPrompt: message.systemPrompt?.trim() || undefined,
		maxIterations: message.hasMaxIterations ? message.maxIterations : undefined,
		timeoutSeconds: message.hasTimeoutSeconds
			? message.timeoutSeconds
			: undefined,
		maxParallel:
			typeof message.maxParallel === "number" && message.maxParallel > 0
				? message.maxParallel
				: 1,
		enabled: message.enabled === true,
		createdAt: message.createdAt ?? "",
		updatedAt: message.updatedAt ?? "",
		lastRunAt: message.lastRunAt?.trim() || undefined,
		nextRunAt: message.nextRunAt?.trim() || undefined,
		createdBy: message.createdBy?.trim() || undefined,
		tags: parseJsonArray(message.tagsJson ?? undefined),
		metadata: fromProtoStruct(message.metadata),
	};
}

export function fromScheduleExecution(
	message: ScheduleExecution__Output,
): RpcScheduleExecution {
	return {
		executionId: message.executionId ?? "",
		scheduleId: message.scheduleId ?? "",
		sessionId: message.sessionId?.trim() || undefined,
		triggeredAt: message.triggeredAt ?? "",
		startedAt: message.startedAt?.trim() || undefined,
		endedAt: message.endedAt?.trim() || undefined,
		status:
			message.status === "pending" ||
			message.status === "running" ||
			message.status === "success" ||
			message.status === "failed" ||
			message.status === "timeout" ||
			message.status === "aborted"
				? message.status
				: "failed",
		exitCode: message.hasExitCode ? message.exitCode : undefined,
		errorMessage: message.errorMessage?.trim() || undefined,
		iterations: message.hasIterations ? message.iterations : undefined,
		tokensUsed: message.hasTokensUsed ? message.tokensUsed : undefined,
		costUsd: message.hasCostUsd ? message.costUsd : undefined,
	};
}
