import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	readSessionManifest,
	sharedSessionMessagesPath,
	sharedSessionMessagesWritePath,
} from "../paths";
import type { JsonRecord, SidecarContext } from "../types";
import {
	parseF64Value,
	parseU64Value,
	stringifyMessageContent,
} from "./common";

type ChatTurnResult = {
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalCost?: number;
	};
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
};

const nowMs = () => Date.now();

function readMessageMetadata(message: JsonRecord): JsonRecord | undefined {
	return message.metadata && typeof message.metadata === "object"
		? (message.metadata as JsonRecord)
		: undefined;
}

function resolveDisplayRole(
	role: string,
	metadata: JsonRecord | undefined,
): string {
	const displayRole =
		typeof metadata?.displayRole === "string"
			? metadata.displayRole.trim().toLowerCase()
			: "";
	if (
		displayRole === "system" ||
		displayRole === "status" ||
		displayRole === "error"
	) {
		return displayRole;
	}
	return role;
}

function extractStoredMessageMeta(message: JsonRecord): JsonRecord | undefined {
	const metadata = readMessageMetadata(message);
	if (!metadata) {
		return undefined;
	}
	const hookEventName =
		typeof metadata.kind === "string" ? "history_notice" : undefined;
	const messageKind =
		typeof metadata.kind === "string" ? metadata.kind : undefined;
	const displayRole =
		typeof metadata.displayRole === "string" ? metadata.displayRole : undefined;
	const reason =
		typeof metadata.reason === "string" ? metadata.reason : undefined;
	if (!hookEventName && !messageKind && !displayRole && !reason) {
		return undefined;
	}
	return {
		hookEventName,
		messageKind,
		displayRole,
		reason,
	};
}

function extractMessageUsageMeta(message: JsonRecord): JsonRecord | undefined {
	const metrics =
		message.metrics && typeof message.metrics === "object"
			? (message.metrics as JsonRecord)
			: undefined;
	const modelInfo =
		message.modelInfo && typeof message.modelInfo === "object"
			? (message.modelInfo as JsonRecord)
			: undefined;
	const inputTokens = parseU64Value(metrics?.inputTokens);
	const outputTokens = parseU64Value(metrics?.outputTokens);
	const totalCost = parseF64Value(metrics?.cost);
	const providerId =
		(typeof message.providerId === "string" && message.providerId) ||
		(typeof modelInfo?.provider === "string" ? modelInfo.provider : undefined);
	const modelId =
		(typeof message.modelId === "string" && message.modelId) ||
		(typeof modelInfo?.id === "string" ? modelInfo.id : undefined);
	if (
		inputTokens === undefined &&
		outputTokens === undefined &&
		totalCost === undefined &&
		!providerId &&
		!modelId
	) {
		return undefined;
	}
	return {
		inputTokens,
		outputTokens,
		totalCost,
		providerId,
		modelId,
	};
}

function trimNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readPersistedChatMessages(sessionId: string): unknown[] | null {
	const path = sharedSessionMessagesPath(sessionId);
	if (!existsSync(path)) {
		return null;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as
			| { messages?: unknown[] }
			| unknown[];
		if (Array.isArray(parsed)) {
			return parsed;
		}
		return Array.isArray(parsed.messages) ? parsed.messages : [];
	} catch {
		return null;
	}
}

export function persistUsageInMessages(
	messages: unknown[],
	config: JsonRecord,
	result: ChatTurnResult,
): unknown[] {
	const next = [...messages];
	let assistantIndex = -1;
	for (let i = next.length - 1; i >= 0; i -= 1) {
		const item = next[i];
		if (!item || typeof item !== "object") {
			continue;
		}
		if ((item as JsonRecord).role === "assistant") {
			assistantIndex = i;
			break;
		}
	}
	if (assistantIndex < 0) {
		return next;
	}

	const assistantMessage = next[assistantIndex];
	if (!assistantMessage || typeof assistantMessage !== "object") {
		return next;
	}

	const record = { ...(assistantMessage as JsonRecord) };
	const metrics =
		record.metrics && typeof record.metrics === "object"
			? { ...(record.metrics as JsonRecord) }
			: {};
	const inputTokens = result.usage?.inputTokens ?? result.inputTokens;
	const outputTokens = result.usage?.outputTokens ?? result.outputTokens;
	const totalCost = result.usage?.totalCost ?? result.totalCost;
	if (typeof inputTokens === "number") {
		metrics.inputTokens = inputTokens;
	}
	if (typeof outputTokens === "number") {
		metrics.outputTokens = outputTokens;
	}
	if (
		typeof totalCost === "number" &&
		Number.isFinite(totalCost) &&
		totalCost >= 0
	) {
		metrics.cost = totalCost;
	}
	record.metrics = metrics;
	const modelInfo =
		record.modelInfo && typeof record.modelInfo === "object"
			? { ...(record.modelInfo as JsonRecord) }
			: {};
	const modelId =
		trimNonEmptyString(modelInfo.id) ?? trimNonEmptyString(config.model);
	const providerId =
		trimNonEmptyString(modelInfo.provider) ??
		trimNonEmptyString(config.provider);
	delete record.providerId;
	delete record.modelId;
	if (modelId && providerId) {
		record.modelInfo = {
			...modelInfo,
			id: modelId,
			provider: providerId,
		};
	}
	if (!record.ts) {
		record.ts = nowMs();
	}
	next[assistantIndex] = record;
	return next;
}

function buildToolPayloadJson(
	toolName: string,
	input: unknown,
	result: unknown,
	isError: boolean,
): string {
	return JSON.stringify({
		toolName,
		input,
		result,
		isError,
	});
}

function normalizeRole(role: unknown): string {
	switch (role) {
		case "user":
		case "assistant":
		case "tool":
		case "system":
		case "status":
		case "error":
			return String(role);
		default:
			return "assistant";
	}
}

type StoredCheckpointEntry = {
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
};

function readCheckpointEntriesByRunCount(
	sessionId: string,
): Map<number, StoredCheckpointEntry> {
	const metadata = readSessionManifest(sessionId)?.metadata;
	if (!metadata || typeof metadata !== "object") {
		return new Map();
	}
	const checkpoint = (metadata as JsonRecord).checkpoint;
	if (!checkpoint || typeof checkpoint !== "object") {
		return new Map();
	}
	const history = (checkpoint as JsonRecord).history;
	if (!Array.isArray(history)) {
		return new Map();
	}
	const entries = new Map<number, StoredCheckpointEntry>();
	for (const item of history) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const entry = item as JsonRecord;
		if (
			typeof entry.ref !== "string" ||
			typeof entry.createdAt !== "number" ||
			typeof entry.runCount !== "number"
		) {
			continue;
		}
		entries.set(entry.runCount, {
			ref: entry.ref,
			createdAt: entry.createdAt,
			runCount: entry.runCount,
			kind:
				entry.kind === "stash" || entry.kind === "commit"
					? entry.kind
					: undefined,
		});
	}
	return entries;
}

export async function readSessionMessages(
	ctx: Pick<SidecarContext, "liveSessions">,
	sessionId: string,
	maxMessages = 800,
): Promise<unknown[]> {
	const persisted = readPersistedChatMessages(sessionId);
	const messages =
		persisted && persisted.length > 0
			? persisted
			: (ctx.liveSessions.get(sessionId)?.messages ?? []);
	const max = Math.max(1, maxMessages);
	const start = Math.max(0, messages.length - max);
	const baseTs = nowMs() - messages.length;
	const out: JsonRecord[] = [];
	const checkpointsByRunCount = readCheckpointEntriesByRunCount(sessionId);
	const pendingToolMessages = new Map<string, [number, string, unknown]>();
	let nextCreatedAt = baseTs;
	let userRunCount = 0;

	for (let idx = start; idx < messages.length; idx += 1) {
		const rawMessage = messages[idx];
		if (!rawMessage || typeof rawMessage !== "object") {
			continue;
		}
		const message = rawMessage as JsonRecord;
		let textMeta = extractMessageUsageMeta(message);
		const storedMeta = extractStoredMessageMeta(message);
		if (storedMeta) {
			textMeta = { ...(textMeta ?? {}), ...storedMeta };
		}
		const role = resolveDisplayRole(
			normalizeRole(message.role),
			readMessageMetadata(message),
		);
		const metadata = readMessageMetadata(message);
		const isRecoveryNotice =
			typeof metadata?.kind === "string" && metadata.kind === "recovery_notice";
		if (role === "user" && !isRecoveryNotice) {
			userRunCount += 1;
			const checkpoint = checkpointsByRunCount.get(userRunCount);
			if (checkpoint) {
				textMeta = {
					...(textMeta ?? {}),
					checkpoint,
				};
			}
		}
		const messageIdBase =
			(typeof message.id === "string" && message.id.trim()) ||
			`history_message_${idx}`;
		const contentBlocks = Array.isArray(message.content)
			? (message.content as unknown[])
			: null;

		if (!contentBlocks) {
			const content = stringifyMessageContent(message.content);
			if (!content.trim()) {
				continue;
			}
			out.push({
				id: messageIdBase,
				sessionId,
				role,
				content,
				createdAt: nextCreatedAt++,
				meta: textMeta,
			});
			continue;
		}

		const textParts: string[] = [];
		const reasoningParts: string[] = [];
		let reasoningRedacted = false;
		let textSegmentIndex = 0;
		const outStartIndex = out.length;
		const flushTextParts = () => {
			if (textParts.length === 0) {
				return;
			}
			const joined = textParts.join("\n");
			textParts.length = 0;
			if (!joined.trim()) {
				return;
			}
			out.push({
				id: `${messageIdBase}_text_${textSegmentIndex}`,
				sessionId,
				role,
				content: joined,
				createdAt: nextCreatedAt++,
				meta: textMeta,
			});
			textSegmentIndex += 1;
			textMeta = undefined;
		};

		for (let blockIdx = 0; blockIdx < contentBlocks.length; blockIdx += 1) {
			const block = contentBlocks[blockIdx];
			if (!block || typeof block !== "object") {
				const line = stringifyMessageContent(block);
				if (line.trim()) {
					textParts.push(line);
				}
				continue;
			}
			const record = block as JsonRecord;
			const blockType = typeof record.type === "string" ? record.type : "";
			if (blockType === "tool_use") {
				flushTextParts();
				const toolName =
					typeof record.name === "string" ? record.name : "tool_call";
				const toolUseId = typeof record.id === "string" ? record.id : "";
				const input = record.input ?? null;
				const outIndex = out.length;
				out.push({
					id: `${messageIdBase}_tool_use_${blockIdx}`,
					sessionId,
					role: "tool",
					content: buildToolPayloadJson(toolName, input, null, false),
					createdAt: nextCreatedAt++,
					meta: {
						toolName,
						hookEventName: "history_tool_use",
					},
				});
				if (toolUseId.trim()) {
					pendingToolMessages.set(toolUseId, [outIndex, toolName, input]);
				}
				continue;
			}
			if (blockType === "tool_result") {
				flushTextParts();
				const toolUseId =
					typeof record.tool_use_id === "string" ? record.tool_use_id : "";
				const result = record.content ?? null;
				const isError = Boolean(record.is_error);
				const existing = pendingToolMessages.get(toolUseId);
				if (existing) {
					const [outIndex, toolName, input] = existing;
					const target = out[outIndex];
					if (target) {
						target.content = buildToolPayloadJson(
							toolName,
							input,
							result,
							isError,
						);
						target.meta = {
							toolName,
							hookEventName: "history_tool_result",
						};
					}
					pendingToolMessages.delete(toolUseId);
				} else {
					out.push({
						id: `${messageIdBase}_tool_result_${blockIdx}`,
						sessionId,
						role: "tool",
						content: buildToolPayloadJson("tool_result", null, result, isError),
						createdAt: nextCreatedAt++,
						meta: {
							toolName: "tool_result",
							hookEventName: "history_tool_result",
						},
					});
				}
				continue;
			}
			if (blockType === "thinking") {
				const thinking =
					typeof record.thinking === "string" ? record.thinking : "";
				if (thinking.trim()) {
					reasoningParts.push(thinking);
				}
				continue;
			}
			if (blockType === "redacted_thinking") {
				reasoningRedacted = true;
				continue;
			}
			const line = stringifyMessageContent(block);
			if (line.trim()) {
				textParts.push(line);
			}
		}

		flushTextParts();
		if (reasoningParts.length > 0 || reasoningRedacted) {
			const reasoning = reasoningParts.join("\n").trim();
			const target = out
				.slice(outStartIndex)
				.find((item) => item.role === role);
			if (target) {
				if (reasoning) {
					target.reasoning = reasoning;
				}
				if (reasoningRedacted) {
					target.reasoningRedacted = true;
				}
			} else {
				out.push({
					id: `${messageIdBase}_reasoning`,
					sessionId,
					role,
					content: "",
					reasoning: reasoning || undefined,
					reasoningRedacted: reasoningRedacted || undefined,
					createdAt: nextCreatedAt++,
					meta: textMeta,
				});
				textMeta = undefined;
			}
		}
		if (textMeta && out[outStartIndex]) {
			out[outStartIndex].meta = {
				...(typeof out[outStartIndex].meta === "object"
					? (out[outStartIndex].meta as JsonRecord)
					: {}),
				...textMeta,
			};
		}
	}

	return out;
}

export function persistSessionMessages(
	sessionId: string,
	persistedMessages: unknown[],
) {
	const writePath = sharedSessionMessagesWritePath(sessionId);
	mkdirSync(dirname(writePath), { recursive: true });
	writeFileSync(
		writePath,
		JSON.stringify(
			{
				messages: persistedMessages,
				ts: nowMs(),
			},
			null,
			2,
		),
	);
}
