import type {
	SessionRecord as HubSessionRecord,
	JsonValue,
	SessionParticipant,
} from "@clinebot/shared";
import type { SessionRecord as LocalSessionRecord } from "../../types/sessions";

export type HubSessionState = {
	createdByClientId: string;
	interactive: boolean;
	participants: Map<string, SessionParticipant>;
};

function mapLocalStatusToHubStatus(
	status: LocalSessionRecord["status"],
): HubSessionRecord["status"] {
	switch (status) {
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "aborted";
		default:
			return "running";
	}
}

function cloneSessionMetadata(
	session: LocalSessionRecord,
): Record<string, JsonValue | undefined> | undefined {
	const metadata =
		session.metadata && typeof session.metadata === "object"
			? (JSON.parse(JSON.stringify(session.metadata)) as Record<
					string,
					JsonValue | undefined
				>)
			: ({} as Record<string, JsonValue | undefined>);
	if (session.parentSessionId?.trim())
		metadata.parentSessionId = session.parentSessionId;
	if (session.parentAgentId?.trim())
		metadata.parentAgentId = session.parentAgentId;
	if (session.agentId?.trim()) metadata.agentId = session.agentId;
	if (session.conversationId?.trim())
		metadata.conversationId = session.conversationId;
	if (session.messagesPath?.trim())
		metadata.messagesPath = session.messagesPath;
	if (session.prompt?.trim()) metadata.prompt = session.prompt;
	if (session.provider?.trim()) metadata.provider = session.provider;
	if (session.model?.trim()) metadata.model = session.model;
	if (session.source?.trim()) metadata.source = session.source;
	if (typeof session.pid === "number") metadata.pid = session.pid;
	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function toHubSessionRecord(
	session: LocalSessionRecord,
	state?: HubSessionState,
): HubSessionRecord {
	return {
		sessionId: session.sessionId,
		workspaceRoot: session.workspaceRoot,
		cwd: session.cwd,
		createdAt: Date.parse(session.startedAt),
		updatedAt: Date.parse(session.updatedAt),
		createdByClientId: state?.createdByClientId ?? "hub",
		status: mapLocalStatusToHubStatus(session.status),
		participants: state ? [...state.participants.values()] : [],
		metadata: cloneSessionMetadata(session),
		runtimeOptions: {
			enableTools: session.enableTools,
			enableSpawn: session.enableSpawn,
			enableTeams: session.enableTeams,
			mode:
				typeof session.metadata?.mode === "string"
					? (session.metadata.mode as "act" | "plan" | "yolo")
					: undefined,
			systemPrompt:
				typeof session.metadata?.systemPrompt === "string"
					? session.metadata.systemPrompt
					: undefined,
		},
		runtimeSession: session.agentId
			? {
					agentId: session.agentId,
					team: session.teamName ? { teamId: session.teamName } : undefined,
				}
			: undefined,
	};
}
