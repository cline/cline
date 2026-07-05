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
	asRecord,
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

type HistoryToolLocation = {
	messageIndex: number;
	blockIndex: number;
};

function historyContentParts(content: unknown): Record<string, unknown>[] {
	if (Array.isArray(content)) {
		return content
			.map((part) => asRecord(part))
			.filter((part): part is Record<string, unknown> => Boolean(part));
	}
	if (typeof content === "string" && content.trim()) {
		return [{ type: "text", text: content }];
	}
	return [];
}

function blockType(block: Record<string, unknown>): string {
	return asString(block.type)?.toLowerCase() ?? "";
}

function toolCallIdForCall(block: Record<string, unknown>): string | undefined {
	return (
		asString(block.id) ??
		asString(block.toolCallId) ??
		asString(block.tool_call_id)
	);
}

function toolCallIdForResult(
	block: Record<string, unknown>,
): string | undefined {
	return (
		asString(block.tool_use_id) ??
		asString(block.toolCallId) ??
		asString(block.tool_call_id)
	);
}

function toolNameFor(block: Record<string, unknown>): string {
	return (
		asString(block.name) ??
		asString(block.toolName) ??
		asString(block.tool_name) ??
		"tool"
	);
}

function toolInputFor(block: Record<string, unknown>): unknown {
	return block.input ?? block.args ?? block.arguments;
}

function toolOutputFor(block: Record<string, unknown>): unknown {
	return block.output ?? block.result ?? block.content;
}

function isErrorToolResult(block: Record<string, unknown>): boolean {
	return (
		block.is_error === true || block.isError === true || block.error === true
	);
}

function pushTextBlock(
	blocks: NonNullable<WebviewChatMessage["blocks"]>,
	textParts: string[],
	messageKey: string | number,
	partIndex: number,
	text: string,
): void {
	if (!text) return;
	textParts.push(text);
	blocks.push({
		id: `${messageKey}:text:${partIndex}`,
		type: "text",
		text,
	});
}

function pushReasoningBlock(
	blocks: NonNullable<WebviewChatMessage["blocks"]>,
	reasoningParts: string[],
	messageKey: string | number,
	partIndex: number,
	text: string,
	redacted?: boolean,
): boolean {
	if (!text) return false;
	reasoningParts.push(text);
	blocks.push({
		id: `${messageKey}:reasoning:${partIndex}`,
		type: "reasoning",
		text,
		redacted,
	});
	return redacted === true;
}

export function mapHistoryToWebviewMessages(
	history: unknown[],
): WebviewChatMessage[] {
	const mapped: WebviewChatMessage[] = [];
	const toolLocations = new Map<string, HistoryToolLocation>();

	for (const [index, entry] of history.entries()) {
		const record =
			entry && typeof entry === "object"
				? (entry as Record<string, unknown>)
				: { content: entry };
		const messageKey = asString(record.id) ?? `history-${index}`;
		const rawRole = asString(record.role)?.toLowerCase();
		let role: WebviewChatMessage["role"] =
			rawRole === "user" || rawRole === "assistant" || rawRole === "error"
				? rawRole
				: "meta";
		const blocks: NonNullable<WebviewChatMessage["blocks"]> = [];
		const textParts: string[] = [];
		const reasoningParts: string[] = [];
		const toolEvents = new Map<
			string,
			NonNullable<WebviewChatMessage["toolEvents"]>[number]
		>();
		const currentToolBlockIndexes = new Map<string, number>();
		let reasoningRedacted = false;

		const contentParts = historyContentParts(record.content);
		if (contentParts.length === 0) {
			const text = stringifyContent(record.content ?? record.text ?? record);
			pushTextBlock(blocks, textParts, messageKey, 0, text);
		}

		for (const [partIndex, part] of contentParts.entries()) {
			const type = blockType(part);
			if (type === "text") {
				pushTextBlock(
					blocks,
					textParts,
					messageKey,
					partIndex,
					asString(part.text) ?? asString(part.content) ?? "",
				);
				continue;
			}

			if (type === "thinking" || type === "reasoning") {
				reasoningRedacted =
					pushReasoningBlock(
						blocks,
						reasoningParts,
						messageKey,
						partIndex,
						asString(part.thinking) ??
							asString(part.reasoning) ??
							asString(part.text) ??
							"",
						part.redacted === true,
					) || reasoningRedacted;
				continue;
			}

			if (type === "redacted_thinking") {
				reasoningRedacted =
					pushReasoningBlock(
						blocks,
						reasoningParts,
						messageKey,
						partIndex,
						"[redacted]",
						true,
					) || reasoningRedacted;
				continue;
			}

			if (type === "tool_use" || type === "tool-call") {
				const toolCallId =
					toolCallIdForCall(part) ?? `${messageKey}:${partIndex}`;
				const name = toolNameFor(part);
				const toolEvent = {
					id: `${messageKey}:${toolCallId}`,
					toolCallId,
					name,
					text: `Running ${name}...`,
					state: "input-available" as const,
					input: toolInputFor(part),
				};
				toolEvents.set(toolCallId, toolEvent);
				blocks.push({
					id: `${messageKey}:tool:${toolCallId}`,
					type: "tool",
					toolEvent,
				});
				currentToolBlockIndexes.set(toolCallId, blocks.length - 1);
				toolLocations.set(toolCallId, {
					messageIndex: mapped.length,
					blockIndex: blocks.length - 1,
				});
				continue;
			}

			if (type === "tool_result" || type === "tool-result") {
				const toolCallId =
					toolCallIdForResult(part) ?? `${messageKey}:${partIndex}`;
				const name = toolNameFor(part);
				const output = toolOutputFor(part);
				const isError = isErrorToolResult(part);
				const currentBlockIndex = currentToolBlockIndexes.get(toolCallId);
				const existingLocation = toolLocations.get(toolCallId);
				const existing =
					currentBlockIndex !== undefined
						? blocks[currentBlockIndex]
						: existingLocation !== undefined
							? mapped[existingLocation.messageIndex]?.blocks?.[
									existingLocation.blockIndex
								]
							: undefined;
				const existingToolEvent =
					existing?.type === "tool" ? existing.toolEvent : undefined;
				const toolEvent = {
					id: existingToolEvent?.id ?? `${messageKey}:${toolCallId}`,
					toolCallId,
					name: existingToolEvent?.name ?? name,
					text: isError
						? `${existingToolEvent?.name ?? name} failed`
						: `${existingToolEvent?.name ?? name} completed`,
					state: isError
						? ("output-error" as const)
						: ("output-available" as const),
					input: existingToolEvent?.input,
					output,
					error: isError ? stringifyContent(output) : undefined,
				};

				if (currentBlockIndex !== undefined && existing?.type === "tool") {
					blocks[currentBlockIndex] = {
						...existing,
						toolEvent,
					};
					toolEvents.set(toolCallId, toolEvent);
				} else if (
					existingLocation !== undefined &&
					existing?.type === "tool"
				) {
					const target = mapped[existingLocation.messageIndex];
					const targetBlocks = target.blocks;
					const targetBlock = targetBlocks?.[existingLocation.blockIndex];
					if (targetBlocks && targetBlock?.type === "tool") {
						targetBlocks[existingLocation.blockIndex] = {
							...targetBlock,
							toolEvent,
						};
					}
					target.toolEvents = (target.toolEvents ?? []).map((event) =>
						event.toolCallId === toolCallId ? toolEvent : event,
					);
				} else {
					toolEvents.set(toolCallId, toolEvent);
					blocks.push({
						id: `${messageKey}:tool:${toolCallId}`,
						type: "tool",
						toolEvent,
					});
				}
			}
		}

		const text = textParts.join("\n");
		const toolEventList = [...toolEvents.values()];
		if (!text && reasoningParts.length === 0 && toolEventList.length === 0) {
			continue;
		}
		if (!text && role === "user" && toolEventList.length > 0) {
			role = "meta";
		}
		mapped.push({
			id: messageKey,
			role,
			text,
			reasoning:
				reasoningParts.length > 0 ? reasoningParts.join("\n") : undefined,
			reasoningRedacted: reasoningRedacted || undefined,
			toolEvents: toolEventList.length > 0 ? toolEventList : undefined,
			blocks,
		});
	}

	return mapped;
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
		createdAt: session.createdAt,
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
