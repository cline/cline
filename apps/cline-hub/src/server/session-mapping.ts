import type {
	WebviewActionSessionSummary,
	WebviewChatMessage,
	WebviewClientSummary,
	WebviewOutboundMessage,
	WebviewSessionSummary,
} from "../webview-protocol";
import type { HubContext } from "./state";
import type { SessionContext, TrackedClient, TrackedSession } from "./types";
import {
	asNumber,
	asString,
	asTimestamp,
	basename,
	formatClientLabel,
	isActiveSession,
	stringifyContent,
} from "./utils";

function metadataFor(record: Record<string, unknown>): Record<string, unknown> {
	return (
		(record.metadata && typeof record.metadata === "object"
			? (record.metadata as Record<string, unknown>)
			: undefined) ?? {}
	);
}

function usageFor(record: Record<string, unknown>): Record<string, unknown> {
	const metadata = metadataFor(record);
	const pick = (value: unknown): Record<string, unknown> | undefined =>
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: undefined;
	return (
		pick(record.aggregateUsage) ??
		pick(record.usage) ??
		pick(metadata.aggregateUsage) ??
		pick(metadata.usage) ??
		{}
	);
}

function sessionTitle(record: Record<string, unknown>): string {
	const metadata = metadataFor(record);
	const title = asString(metadata.title);
	if (title) return title;
	const prompt = asString(record.prompt) ?? asString(metadata.prompt);
	if (prompt) return prompt.length > 34 ? `${prompt.slice(0, 31)}...` : prompt;
	return basename(asString(record.workspaceRoot) ?? asString(record.cwd));
}

export function formatClientName(client: TrackedClient): string {
	return (
		client.displayName?.trim() ||
		client.clientType.trim() ||
		client.clientId.trim() ||
		"Unknown"
	);
}

export function formatSessionCreator(
	ctx: HubContext,
	session: TrackedSession,
): string {
	const clientId = session.createdByClientId?.trim();
	if (!clientId) return "Unknown client";
	const client = ctx.clients.get(clientId);
	return client ? formatClientName(client) : clientId;
}

function summarizeClient(client: TrackedClient): {
	key: string;
	label: string;
	name: string;
} {
	const normalizedType = client.clientType.trim().toLowerCase();
	if (
		normalizedType === "code-sidecar" ||
		normalizedType === "code-sidecar-approvals" ||
		normalizedType === "code-sidecar-list"
	) {
		return { key: "code-app", label: "Code App", name: "Code App" };
	}
	return {
		key: client.clientId,
		label: formatClientLabel(client.clientType),
		name: formatClientName(client),
	};
}

export function mapHistoryToWebviewMessages(
	history: unknown[],
): WebviewChatMessage[] {
	return history.map((entry, index) => {
		const record =
			entry && typeof entry === "object"
				? (entry as Record<string, unknown>)
				: { content: entry };
		const rawRole = asString(record.role)?.toLowerCase();
		const role: WebviewChatMessage["role"] =
			rawRole === "user" || rawRole === "assistant" || rawRole === "error"
				? rawRole
				: "meta";
		const text = stringifyContent(record.content ?? record.text ?? record);
		return {
			id: asString(record.id) ?? `history-${index}`,
			role,
			text,
			blocks: text ? [{ id: `history-${index}-text`, type: "text", text }] : [],
		};
	});
}

export function trackSession(record: unknown): TrackedSession | undefined {
	const raw =
		record && typeof record === "object"
			? (record as Record<string, unknown>)
			: {};
	const sessionId = asString(raw.sessionId);
	if (!sessionId) return undefined;
	const metadata = metadataFor(raw);
	const usage = usageFor(raw);
	const participantCount = Array.isArray(raw.participants)
		? raw.participants.length
		: 0;
	const createdAt =
		asTimestamp(raw.createdAt) ??
		asTimestamp(raw.startedAt) ??
		asTimestamp(metadata.createdAt) ??
		Date.now();
	return {
		sessionId,
		status: asString(raw.status) ?? "running",
		title: sessionTitle(raw),
		workspaceRoot: asString(raw.workspaceRoot) ?? asString(raw.cwd) ?? "",
		cwd: asString(raw.cwd),
		provider: asString(raw.provider) ?? asString(metadata.provider),
		model: asString(raw.model) ?? asString(metadata.model),
		source: asString(raw.source) ?? asString(metadata.source),
		createdAt,
		updatedAt:
			asTimestamp(raw.updatedAt) ??
			asTimestamp(raw.endedAt) ??
			asTimestamp(metadata.updatedAt) ??
			createdAt,
		createdByClientId: asString(raw.createdByClientId),
		prompt: asString(raw.prompt) ?? asString(metadata.prompt),
		inputTokens:
			asNumber(usage.inputTokens) ??
			asNumber(usage.input) ??
			asNumber(usage.totalInputTokens),
		outputTokens:
			asNumber(usage.outputTokens) ??
			asNumber(usage.output) ??
			asNumber(usage.totalOutputTokens),
		totalCost: asNumber(usage.totalCost) ?? asNumber(metadata.totalCost),
		agentCount: Math.max(1, participantCount),
		participantCount,
	};
}

export function toActionSessionSummary(
	session: TrackedSession,
): WebviewActionSessionSummary {
	return {
		sessionId: session.sessionId,
		title: session.title || basename(session.workspaceRoot || session.cwd),
		status: session.status,
		workspaceRoot: session.workspaceRoot,
		workspaceName: basename(session.workspaceRoot || session.cwd),
		cwd: session.cwd,
		model: session.model,
		provider: session.provider,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		createdByClientId: session.createdByClientId,
		prompt: session.prompt,
		inputTokens: session.inputTokens,
		outputTokens: session.outputTokens,
		totalCost: session.totalCost,
		agentCount: session.agentCount,
	};
}

export function clientSummariesPayload(
	ctx: HubContext,
): WebviewClientSummary[] {
	const sessionCounts = new Map<string, number>();
	for (const session of ctx.sessions.values()) {
		if (
			!isActiveSession(session.title, session.status, session.participantCount)
		)
			continue;
		const clientId = session.createdByClientId?.trim();
		if (!clientId) continue;
		sessionCounts.set(clientId, (sessionCounts.get(clientId) ?? 0) + 1);
	}
	const grouped = new Map<
		string,
		WebviewClientSummary & { firstConnectedAt: number }
	>();
	for (const client of [...ctx.clients.values()].sort(
		(a, b) => a.connectedAt - b.connectedAt,
	)) {
		const summary = summarizeClient(client);
		const existing = grouped.get(summary.key);
		if (existing) {
			existing.sessionCount += sessionCounts.get(client.clientId) ?? 0;
			existing.firstConnectedAt = Math.min(
				existing.firstConnectedAt,
				client.connectedAt,
			);
			continue;
		}
		grouped.set(summary.key, {
			label: summary.label,
			name: summary.name,
			sessionCount: sessionCounts.get(client.clientId) ?? 0,
			firstConnectedAt: client.connectedAt,
		});
	}
	return [...grouped.values()]
		.sort((a, b) => a.firstConnectedAt - b.firstConnectedAt)
		.map(({ label, name, sessionCount }) => ({ label, name, sessionCount }));
}

export function toWebviewSessionSummary(
	session: TrackedSession,
): WebviewSessionSummary {
	return {
		sessionId: session.sessionId,
		title: session.title,
		status: session.status,
		source: session.source,
		providerId: session.provider,
		model: session.model,
		workspaceRoot: session.workspaceRoot,
		updatedAt: session.updatedAt,
		inputTokens: session.inputTokens,
		outputTokens: session.outputTokens,
		totalCost: session.totalCost,
	};
}

export function webviewSessionsPayload(
	ctx: HubContext,
): WebviewOutboundMessage {
	return {
		type: "sessions",
		sessions: [...ctx.sessions.values()]
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(toWebviewSessionSummary),
	};
}

export function parseSessionContext(
	record: unknown,
): SessionContext | undefined {
	const raw =
		record && typeof record === "object"
			? (record as Record<string, unknown>)
			: {};
	const metadata =
		raw.metadata && typeof raw.metadata === "object"
			? (raw.metadata as Record<string, unknown>)
			: {};
	const workspaceRootRaw = asString(raw.workspaceRoot);
	const providerId =
		asString(raw.providerId) ??
		asString(metadata.providerId) ??
		asString(raw.provider) ??
		asString(metadata.provider);
	const modelId =
		asString(raw.modelId) ??
		asString(metadata.modelId) ??
		asString(raw.model) ??
		asString(metadata.model);
	if (!workspaceRootRaw || !providerId || !modelId) return undefined;
	return {
		workspaceRoot: workspaceRootRaw,
		cwd: asString(raw.cwd) ?? workspaceRootRaw,
		providerId,
		modelId,
	};
}
