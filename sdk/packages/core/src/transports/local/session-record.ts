import { resolveWorkspacePath } from "../../services/config";
import type { FileSessionService } from "../../session/services/file-session-service";
import type { CoreSessionService } from "../../session/services/session-service";
import type { ActiveSession } from "../../types/session";
import type { SessionRecord } from "../../types/sessions";

export type SessionBackend = CoreSessionService | FileSessionService;

export function toActiveSessionRecord(session: ActiveSession): SessionRecord {
	return {
		sessionId: session.sessionId,
		source: session.source,
		pid: process.pid,
		startedAt: session.startedAt,
		endedAt: session.endedAt ?? null,
		exitCode: session.exitCode ?? null,
		status: session.status,
		interactive: session.interactive,
		provider: session.config.providerId,
		model: session.config.modelId,
		cwd: session.config.cwd,
		workspaceRoot: resolveWorkspacePath(session.config),
		teamName: session.config.teamName?.trim() || undefined,
		enableTools: session.config.enableTools,
		enableSpawn: session.config.enableSpawnAgent,
		enableTeams: session.config.enableAgentTeams,
		parentSessionId:
			typeof session.sessionMetadata?.parentSessionId === "string"
				? session.sessionMetadata.parentSessionId
				: undefined,
		parentAgentId:
			typeof session.sessionMetadata?.parentAgentId === "string"
				? session.sessionMetadata.parentAgentId
				: undefined,
		agentId:
			typeof session.sessionMetadata?.agentId === "string"
				? session.sessionMetadata.agentId
				: undefined,
		conversationId:
			typeof session.sessionMetadata?.conversationId === "string"
				? session.sessionMetadata.conversationId
				: undefined,
		isSubagent:
			typeof session.sessionMetadata?.isSubagent === "boolean"
				? session.sessionMetadata.isSubagent
				: false,
		prompt: session.pendingPrompt,
		metadata: session.sessionMetadata,
		messagesPath: session.artifacts?.messagesPath,
		updatedAt: session.updatedAt ?? session.endedAt ?? session.startedAt,
	};
}
