import {
	type AgentModelRequest,
	computeRecordedRequestMatchKey,
	recordedMessageContentSha256,
	recordedToolDefinitions,
	type SessionRecordedModelCall,
} from "@cline/shared";
import {
	alignByKey,
	canonicalJson,
	canonicalSha256,
	excerptAround,
	excerptText,
	excerptValue,
	firstStructuralDifference,
	firstTextDifference,
	type SessionReplayDiffEntry,
	type SessionReplayDivergence,
	sha256Hex,
	structurallyEqual,
	textDiffEntry,
} from "./replay-diff";

export interface SessionReplayRequestMessage {
	role: string;
	/** sha256 of `[role, content]`, the per-message input of the match key. */
	contentSha256: string;
	/** The message content; absent when the recording lacks the blob. */
	content?: unknown;
}

export interface SessionReplayToolDefinition {
	name: string;
	description: string;
	inputSchema: unknown;
}

/**
 * A model request in the form replay compares: the `cline-replay-match-v1`
 * key and its inputs, plus the values behind them when known, so a mismatch
 * can be explained structurally rather than as two different hashes.
 */
export interface SessionReplayRequestSnapshot {
	matchKey: string;
	/** Model id the request went to; null when unknown. */
	model: string | null;
	systemPromptSha256: string | null;
	systemPrompt?: string;
	toolsSha256: string;
	tools?: SessionReplayToolDefinition[];
	messages: SessionReplayRequestMessage[];
}

/** Request blobs by sha256, as loaded from a bundle or a recording. */
export type SessionReplayBlobLookup = ReadonlyMap<
	string,
	{ kind: string; contentSha256?: string; value: unknown }
>;

/**
 * Snapshot of a live request, hashed exactly as the session recorder hashes
 * it, so `matchKey` equals the recorded key when the request is the same.
 */
export function describeLiveModelRequest(
	request: Pick<AgentModelRequest, "systemPrompt" | "messages" | "tools">,
	options: { model?: string | null } = {},
): SessionReplayRequestSnapshot {
	const systemPromptSha256 =
		request.systemPrompt !== undefined
			? sha256Hex(JSON.stringify(request.systemPrompt))
			: null;
	const tools = recordedToolDefinitions(request.tools);
	const toolsSha256 = sha256Hex(JSON.stringify(tools));
	const messages = request.messages.map((message) => ({
		role: message.role,
		contentSha256: recordedMessageContentSha256(message),
		content: message.content,
	}));
	return {
		matchKey: computeRecordedRequestMatchKey({
			systemPromptSha256,
			toolsSha256,
			messageContentSha256s: messages.map((message) => message.contentSha256),
		}),
		model: options.model ?? null,
		systemPromptSha256,
		...(request.systemPrompt !== undefined
			? { systemPrompt: request.systemPrompt }
			: {}),
		toolsSha256,
		tools,
		messages,
	};
}

function messageFromBlob(
	sha256: string,
	blobs: SessionReplayBlobLookup,
): SessionReplayRequestMessage {
	const blob = blobs.get(sha256);
	const value =
		blob?.value && typeof blob.value === "object"
			? (blob.value as { role?: unknown; content?: unknown })
			: undefined;
	const role = typeof value?.role === "string" ? value.role : "unknown";
	if (!value || !("content" in value)) {
		return { role, contentSha256: blob?.contentSha256 ?? sha256 };
	}
	return {
		role,
		contentSha256:
			blob?.contentSha256 ??
			recordedMessageContentSha256({ role, content: value.content }),
		content: value.content,
	};
}

/**
 * Snapshot of a recorded request. `messageSha256s` is the call's full
 * message blob list from `resolveRecordedRequestMessages`; without it only
 * the messages stored on the record itself (after its prefix) are known.
 */
export function describeRecordedModelRequest(
	record: Pick<SessionRecordedModelCall, "request">,
	blobs: SessionReplayBlobLookup,
	messageSha256s?: readonly string[],
): SessionReplayRequestSnapshot {
	const { request } = record;
	const systemPrompt = request.systemPromptSha256
		? blobs.get(request.systemPromptSha256)?.value
		: undefined;
	const tools = blobs.get(request.toolsSha256)?.value;
	const model = request.provider.model;
	return {
		matchKey: request.matchKey,
		model: typeof model === "string" ? model : null,
		systemPromptSha256: request.systemPromptSha256,
		...(typeof systemPrompt === "string" ? { systemPrompt } : {}),
		toolsSha256: request.toolsSha256,
		...(Array.isArray(tools)
			? { tools: tools as SessionReplayToolDefinition[] }
			: {}),
		messages: (messageSha256s ?? request.messageSha256s).map((sha256) =>
			messageFromBlob(sha256, blobs),
		),
	};
}

function partSummary(part: unknown): string {
	if (!part || typeof part !== "object") return String(part);
	const record = part as Record<string, unknown>;
	switch (record.type) {
		case "text":
			return typeof record.text === "string" ? record.text : "";
		case "reasoning":
			return `[reasoning] ${typeof record.text === "string" ? record.text : ""}`;
		case "tool-call":
			return `${String(record.toolName)}(${canonicalJson(record.input)})`;
		case "tool-result":
			return `${String(record.toolName)} → ${
				typeof record.output === "string"
					? record.output
					: canonicalJson(record.output)
			}`;
		default:
			return `[${String(record.type)}]`;
	}
}

/** One-line summary of a request message's content. */
export function summarizeRequestMessageContent(content: unknown): string {
	if (content === undefined) return "(content not recorded)";
	if (typeof content === "string") return excerptText(content);
	if (Array.isArray(content)) {
		return excerptText(content.map(partSummary).join(" | "));
	}
	return excerptValue(content);
}

function isInheritedMessage(message: SessionReplayRequestMessage): boolean {
	if (message.role === "assistant" || message.role === "tool") return true;
	return (
		Array.isArray(message.content) &&
		message.content.length > 0 &&
		message.content.every(
			(part) =>
				!!part &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "tool-result",
		)
	);
}

function messagesEqual(
	recorded: SessionReplayRequestMessage,
	live: SessionReplayRequestMessage,
): boolean {
	if (recorded.contentSha256 === live.contentSha256) return true;
	return (
		recorded.role === live.role &&
		recorded.content !== undefined &&
		live.content !== undefined &&
		structurallyEqual(recorded.content, live.content)
	);
}

function changedMessageValues(
	recorded: SessionReplayRequestMessage,
	live: SessionReplayRequestMessage,
): Pick<SessionReplayDiffEntry, "path" | "recorded" | "live"> {
	if (recorded.role !== live.role) {
		return {
			path: "role",
			recorded: {
				sha256: recorded.contentSha256,
				excerpt: `${recorded.role}: ${summarizeRequestMessageContent(recorded.content)}`,
			},
			live: {
				sha256: live.contentSha256,
				excerpt: `${live.role}: ${summarizeRequestMessageContent(live.content)}`,
			},
		};
	}
	const difference =
		recorded.content !== undefined && live.content !== undefined
			? firstStructuralDifference(recorded.content, live.content, "content")
			: undefined;
	const excerpts = (() => {
		if (!difference) {
			return {
				recorded: summarizeRequestMessageContent(recorded.content),
				live: summarizeRequestMessageContent(live.content),
			};
		}
		if (
			typeof difference.recorded === "string" &&
			typeof difference.live === "string"
		) {
			const offset =
				firstTextDifference(difference.recorded, difference.live)?.offset ?? 0;
			return {
				recorded: excerptAround(difference.recorded, offset),
				live: excerptAround(difference.live, offset),
			};
		}
		return {
			recorded: excerptValue(difference.recorded),
			live: excerptValue(difference.live),
		};
	})();
	return {
		...(difference ? { path: difference.path } : {}),
		recorded: { sha256: recorded.contentSha256, excerpt: excerpts.recorded },
		live: { sha256: live.contentSha256, excerpt: excerpts.live },
	};
}

/** Per-message differences, aligned by content hash. */
export function diffRequestMessages(
	recorded: readonly SessionReplayRequestMessage[],
	live: readonly SessionReplayRequestMessage[],
): SessionReplayDiffEntry[] {
	const entries: SessionReplayDiffEntry[] = [];
	for (const pair of alignByKey(
		recorded,
		live,
		(message) => message.contentSha256,
	)) {
		const r = pair.recorded !== undefined ? recorded[pair.recorded] : undefined;
		const l = pair.live !== undefined ? live[pair.live] : undefined;
		const index = pair.recorded ?? pair.live ?? 0;
		const message = r ?? l;
		if (!message) continue;
		const label = `message ${index + 1} (${message.role})`;
		if (r && l) {
			if (messagesEqual(r, l)) continue;
			entries.push({
				label,
				change: "changed",
				index,
				...changedMessageValues(r, l),
				inherited: isInheritedMessage(r) && isInheritedMessage(l),
			});
		} else if (r) {
			entries.push({
				label,
				change: "removed",
				index,
				recorded: {
					sha256: r.contentSha256,
					excerpt: summarizeRequestMessageContent(r.content),
				},
				inherited: isInheritedMessage(r),
			});
		} else if (l) {
			entries.push({
				label,
				change: "added",
				index,
				live: {
					sha256: l.contentSha256,
					excerpt: summarizeRequestMessageContent(l.content),
				},
				inherited: isInheritedMessage(l),
			});
		}
	}
	return entries;
}

function diffTools(
	recorded: SessionReplayRequestSnapshot,
	live: SessionReplayRequestSnapshot,
): SessionReplayDiffEntry[] {
	if (!recorded.tools || !live.tools) {
		return [
			{
				label: "tools",
				change: "changed",
				recorded: {
					sha256: recorded.toolsSha256,
					excerpt: recorded.tools
						? recorded.tools.map((tool) => tool.name).join(", ")
						: "(definitions not recorded)",
				},
				live: {
					sha256: live.toolsSha256,
					excerpt: live.tools
						? live.tools.map((tool) => tool.name).join(", ")
						: "(definitions not recorded)",
				},
			},
		];
	}
	const recordedByName = new Map(
		recorded.tools.map((tool) => [tool.name, tool]),
	);
	const liveByName = new Map(live.tools.map((tool) => [tool.name, tool]));
	const entries: SessionReplayDiffEntry[] = [];
	for (const tool of recorded.tools) {
		const other = liveByName.get(tool.name);
		if (!other) {
			entries.push({
				label: `tool ${tool.name}`,
				change: "removed",
				recorded: {
					sha256: canonicalSha256(tool),
					excerpt: excerptText(tool.description),
				},
			});
			continue;
		}
		const difference = firstStructuralDifference(tool, other);
		if (!difference) continue;
		const strings =
			typeof difference.recorded === "string" &&
			typeof difference.live === "string";
		const offset = strings
			? (firstTextDifference(
					difference.recorded as string,
					difference.live as string,
				)?.offset ?? 0)
			: 0;
		entries.push({
			label: `tool ${tool.name}`,
			change: "changed",
			path: difference.path,
			recorded: {
				sha256: canonicalSha256(tool),
				excerpt: strings
					? excerptAround(difference.recorded as string, offset)
					: excerptValue(difference.recorded),
			},
			live: {
				sha256: canonicalSha256(other),
				excerpt: strings
					? excerptAround(difference.live as string, offset)
					: excerptValue(difference.live),
			},
		});
	}
	for (const tool of live.tools) {
		if (recordedByName.has(tool.name)) continue;
		entries.push({
			label: `tool ${tool.name}`,
			change: "added",
			live: {
				sha256: canonicalSha256(tool),
				excerpt: excerptText(tool.description),
			},
		});
	}
	if (entries.length === 0 && !structurallyEqual(recorded.tools, live.tools)) {
		entries.push({
			label: "tool order",
			change: "changed",
			recorded: {
				sha256: recorded.toolsSha256,
				excerpt: recorded.tools.map((tool) => tool.name).join(", "),
			},
			live: {
				sha256: live.toolsSha256,
				excerpt: live.tools.map((tool) => tool.name).join(", "),
			},
		});
	}
	return entries;
}

function countChanges(entries: readonly SessionReplayDiffEntry[]): string {
	const counts = { changed: 0, added: 0, removed: 0 };
	for (const entry of entries) counts[entry.change] += 1;
	return (["changed", "added", "removed"] as const)
		.filter((change) => counts[change] > 0)
		.map((change) => `${counts[change]} ${change}`)
		.join(", ");
}

export interface DiffSessionReplayRequestsOptions {
	/** 1-based session iteration the request belongs to. */
	iteration: number;
	/**
	 * Keep message differences that come from earlier iterations' output
	 * (assistant and tool-result messages). Default true; the iteration
	 * comparison turns it off because those outputs are compared on their own.
	 */
	includeInheritedMessages?: boolean;
}

/**
 * Differences between a recorded and a live request, one divergence per
 * differing aspect, in the order model, system prompt, tools, messages.
 * Values are compared structurally, so a request that differs from the
 * recording only in JSON field order has no divergence even though its
 * match key differs.
 */
export function diffSessionReplayRequests(
	recorded: SessionReplayRequestSnapshot,
	live: SessionReplayRequestSnapshot,
	options: DiffSessionReplayRequestsOptions,
): SessionReplayDivergence[] {
	const { iteration } = options;
	const divergences: SessionReplayDivergence[] = [];
	if (recorded.model && live.model && recorded.model !== live.model) {
		divergences.push({
			kind: "request-model",
			iteration,
			counted: true,
			summary: `model differs: recorded ${recorded.model}, live ${live.model}`,
			entries: [
				{
					label: "model",
					change: "changed",
					recorded: { excerpt: recorded.model },
					live: { excerpt: live.model },
				},
			],
		});
	}
	if (recorded.systemPromptSha256 !== live.systemPromptSha256) {
		if (
			recorded.systemPrompt !== undefined &&
			live.systemPrompt !== undefined
		) {
			if (recorded.systemPrompt !== live.systemPrompt) {
				const { entry, position } = textDiffEntry(
					"system prompt",
					recorded.systemPrompt,
					live.systemPrompt,
					{
						...(recorded.systemPromptSha256
							? { recorded: recorded.systemPromptSha256 }
							: {}),
						...(live.systemPromptSha256
							? { live: live.systemPromptSha256 }
							: {}),
					},
				);
				divergences.push({
					kind: "request-system-prompt",
					iteration,
					counted: true,
					summary: `system prompt differs${position ? ` at ${position}` : ""}`,
					entries: [entry],
				});
			}
		} else {
			divergences.push({
				kind: "request-system-prompt",
				iteration,
				counted: true,
				summary: "system prompt differs",
				entries: [
					{
						label: "system prompt",
						change: "changed",
						recorded: {
							...(recorded.systemPromptSha256
								? { sha256: recorded.systemPromptSha256 }
								: {}),
							excerpt:
								recorded.systemPromptSha256 === null
									? "(none)"
									: "(text not recorded)",
						},
						live: {
							...(live.systemPromptSha256
								? { sha256: live.systemPromptSha256 }
								: {}),
							excerpt:
								live.systemPromptSha256 === null
									? "(none)"
									: "(text not available)",
						},
					},
				],
			});
		}
	}
	if (recorded.toolsSha256 !== live.toolsSha256) {
		const entries = diffTools(recorded, live);
		if (entries.length > 0) {
			divergences.push({
				kind: "request-tools",
				iteration,
				counted: true,
				summary: `tool definitions differ: ${entries
					.map((entry) => `${entry.label} ${entry.change}`)
					.join(", ")}`,
				entries,
			});
		}
	}
	const messageEntries = diffRequestMessages(
		recorded.messages,
		live.messages,
	).filter(
		(entry) => options.includeInheritedMessages !== false || !entry.inherited,
	);
	if (messageEntries.length > 0) {
		const first = messageEntries[0];
		divergences.push({
			kind: "request-messages",
			iteration,
			counted: true,
			summary: `messages differ from ${first?.label ?? "the start"}: ${countChanges(messageEntries)} (recorded ${recorded.messages.length}, live ${live.messages.length})`,
			entries: messageEntries,
		});
	}
	return divergences;
}
