import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	SessionRecord as HubSessionRecord,
	HubToolExecutorName,
	JsonValue,
	SessionParticipant,
	ToolContext,
} from "@clinebot/shared";

export {
	isHubToolExecutorName,
	parseRuntimeConfigExtensions,
} from "@clinebot/shared";

import type { ToolExecutors } from "../../extensions/tools";
import { readPersistedMessagesFile } from "../../transports/runtime-host-support";
import type { SessionRecord as LocalSessionRecord } from "../../types/sessions";

export type HubSessionState = {
	createdByClientId: string;
	interactive: boolean;
	participants: Map<string, SessionParticipant>;
};

export function formatHubUptime(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

export function mapLocalStatusToHubStatus(
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

export function eventNameForScheduleCommand(
	command: HubCommandEnvelope["command"],
): HubEventEnvelope["event"] | undefined {
	switch (command) {
		case "schedule.create":
			return "schedule.created";
		case "schedule.update":
		case "schedule.enable":
		case "schedule.disable":
			return "schedule.updated";
		case "schedule.delete":
			return "schedule.deleted";
		case "schedule.trigger":
			return "schedule.triggered";
		default:
			return undefined;
	}
}

function extractAssistantText(content: unknown): string | undefined {
	if (typeof content === "string") {
		const trimmed = content.trim();
		return trimmed || undefined;
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const text = content
		.map((part) => {
			if (
				part &&
				typeof part === "object" &&
				"type" in part &&
				(part as { type?: unknown }).type === "text" &&
				"text" in part &&
				typeof (part as { text?: unknown }).text === "string"
			) {
				return (part as { text: string }).text.trim();
			}
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
	return text || undefined;
}

const MAX_NOTIFICATION_BODY_BYTES = 120;
const NOTIFICATION_BODY_ELLIPSIS = "...";

export function truncateNotificationBody(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	if (Buffer.byteLength(trimmed, "utf8") <= MAX_NOTIFICATION_BODY_BYTES) {
		return trimmed;
	}
	const budget =
		MAX_NOTIFICATION_BODY_BYTES -
		Buffer.byteLength(NOTIFICATION_BODY_ELLIPSIS, "utf8");
	if (budget <= 0) {
		return NOTIFICATION_BODY_ELLIPSIS;
	}
	let truncated = "";
	for (const char of trimmed) {
		if (Buffer.byteLength(truncated + char, "utf8") > budget) {
			break;
		}
		truncated += char;
	}
	return `${truncated}${NOTIFICATION_BODY_ELLIPSIS}`;
}

export async function buildCompletionNotification(
	session: HubSessionRecord | undefined,
): Promise<{
	title: string;
	body: string;
	severity: "info";
}> {
	const sessionId = session?.sessionId?.trim() || "unknown";
	const messagesPath =
		typeof session?.metadata?.messagesPath === "string"
			? session.metadata.messagesPath
			: undefined;
	const messages = await readPersistedMessagesFile(messagesPath);
	const latestAssistantText = [...messages]
		.reverse()
		.find((message) => message.role === "assistant");
	const assistantReply = latestAssistantText
		? extractAssistantText(latestAssistantText.content)
		: undefined;
	const workspaceRoot = session?.workspaceRoot?.trim() || "workspace";
	const fallback =
		typeof session?.metadata?.prompt === "string"
			? session.metadata.prompt.trim()
			: workspaceRoot;
	return {
		title: `Task completed (${sessionId})`,
		body: truncateNotificationBody(
			assistantReply && assistantReply.length > 0
				? assistantReply
				: fallback.length > 0
					? fallback
					: workspaceRoot,
		),
		severity: "info",
	};
}

function serializeToolContext(context: ToolContext): Record<string, unknown> {
	return {
		agentId: context.agentId,
		conversationId: context.conversationId,
		iteration: context.iteration,
		metadata: context.metadata,
	};
}

export function createCapabilityBackedToolExecutors(
	sessionId: string,
	targetClientId: string,
	executors: HubToolExecutorName[],
	requestCapability: (
		sessionId: string,
		capabilityName: string,
		payload: Record<string, unknown>,
		targetClientId: string,
	) => Promise<Record<string, unknown> | undefined>,
): Partial<ToolExecutors> {
	const available = new Set(executors);
	const invoke = async (
		executor: HubToolExecutorName,
		args: unknown[],
		context: ToolContext,
	): Promise<unknown> => {
		const response = await requestCapability(
			sessionId,
			`tool_executor.${executor}`,
			{
				executor,
				args,
				context: serializeToolContext(context),
			},
			targetClientId,
		);
		return response?.result;
	};

	return {
		...(available.has("readFile")
			? {
					readFile: async (request, context) =>
						(await invoke("readFile", [request], context)) as Awaited<
							ReturnType<NonNullable<ToolExecutors["readFile"]>>
						>,
				}
			: {}),
		...(available.has("search")
			? {
					search: async (query, cwd, context) =>
						String((await invoke("search", [query, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("bash")
			? {
					bash: async (command, cwd, context) =>
						String((await invoke("bash", [command, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("webFetch")
			? {
					webFetch: async (url, prompt, context) =>
						String((await invoke("webFetch", [url, prompt], context)) ?? ""),
				}
			: {}),
		...(available.has("editor")
			? {
					editor: async (input, cwd, context) =>
						String((await invoke("editor", [input, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("applyPatch")
			? {
					applyPatch: async (input, cwd, context) =>
						String((await invoke("applyPatch", [input, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("skills")
			? {
					skills: async (skill, args, context) =>
						String((await invoke("skills", [skill, args], context)) ?? ""),
				}
			: {}),
		...(available.has("askQuestion")
			? {
					askQuestion: async (question, options, context) =>
						String(
							(await invoke("askQuestion", [question, options], context)) ?? "",
						),
				}
			: {}),
		...(available.has("submit")
			? {
					submit: async (summary, verified, context) =>
						String(
							(await invoke("submit", [summary, verified], context)) ?? "",
						),
				}
			: {}),
	};
}

export function logHubBoundaryError(message: string, error: unknown): void {
	const details =
		error instanceof Error ? error.stack || error.message : String(error);
	console.error(`[hub] ${message}: ${details}`);
}
