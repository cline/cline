import { createHash } from "node:crypto";
import {
	formatDisplayUserInput,
	type MessageWithMetadata,
} from "@cline/shared";
import { z } from "zod";

function isMessageWithMetadata(value: unknown): value is MessageWithMetadata {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const candidate = value as Partial<MessageWithMetadata>;
	if (candidate.role !== "user" && candidate.role !== "assistant") {
		return false;
	}
	return (
		typeof candidate.content === "string" || Array.isArray(candidate.content)
	);
}

const MessageWithMetadataSchema = z.custom<MessageWithMetadata>(
	isMessageWithMetadata,
);

export const SessionCompactionStateSchema = z.object({
	version: z.literal(1),
	updated_at: z.string().datetime(),
	conversation_id: z.string().min(1).optional(),
	source_message_count: z.number().int().nonnegative(),
	source_prefix_hash: z.string().min(1).optional(),
	source_last_message_key: z.string().min(1).optional(),
	messages: z.array(MessageWithMetadataSchema),
	system_prompt: z.string().optional(),
});

export type SessionCompactionState = z.infer<
	typeof SessionCompactionStateSchema
>;

function cloneMessages(
	messages: readonly MessageWithMetadata[],
): MessageWithMetadata[] {
	return JSON.parse(JSON.stringify(messages)) as MessageWithMetadata[];
}

function normalizeMessageForSourceHash(
	message: MessageWithMetadata,
): MessageWithMetadata {
	if (message.role !== "user") {
		return message;
	}
	if (typeof message.content === "string") {
		return {
			...message,
			content: formatDisplayUserInput(message.content),
		};
	}
	return {
		...message,
		content: message.content.map((part) =>
			part.type === "text"
				? { ...part, text: formatDisplayUserInput(part.text) }
				: part,
		),
	};
}

function assertBoundaryRole(role: MessageWithMetadata["role"]): void {
	if (role.includes(":")) {
		throw new TypeError(
			"Message role cannot contain ':' in compaction boundary keys",
		);
	}
}

// Hash the persisted message shape in a fixed top-level field order. Nested
// objects keep their persisted JSON order because transcript writes are append-only.
function sourceMessageHashInput(message: MessageWithMetadata): unknown[] {
	const normalized = normalizeMessageForSourceHash(message);
	assertBoundaryRole(normalized.role);
	return [
		["role", normalized.role],
		["content", normalized.content],
		["id", normalized.id ?? null],
		["agent", normalized.agent ?? null],
		["sessionId", normalized.sessionId ?? null],
		["metadata", normalized.metadata ?? null],
		["modelInfo", normalized.modelInfo ?? null],
		["metrics", normalized.metrics ?? null],
		["ts", normalized.ts ?? null],
	];
}

function messageBoundaryKey(message: MessageWithMetadata | undefined): string {
	if (!message) {
		return "";
	}
	const normalized = normalizeMessageForSourceHash(message);
	if (typeof normalized.id === "string" && normalized.id.trim()) {
		return `id:${normalized.id.trim()}`;
	}
	assertBoundaryRole(normalized.role);
	if (typeof normalized.ts === "number" && Number.isFinite(normalized.ts)) {
		return `ts:${normalized.role}:${normalized.ts}`;
	}
	return `content:${normalized.role}:${JSON.stringify(normalized.content)}`;
}

// These anchors are persisted in session sidecars. Changing the format is safe
// for saved transcripts, but invalidates existing compaction sidecars.
function sourcePrefixHash(
	messages: readonly MessageWithMetadata[],
	count = messages.length,
): string {
	const hash = createHash("sha256");
	hash.update("cline-session-compaction-source-v1\n");
	hash.update(`${count}\n`);
	for (const message of messages.slice(0, count)) {
		hash.update(JSON.stringify(sourceMessageHashInput(message)));
		hash.update("\n");
	}
	return `sha256:${hash.digest("hex")}`;
}

export function createSessionCompactionState(input: {
	sourceMessages: readonly MessageWithMetadata[];
	compactedMessages: readonly MessageWithMetadata[];
	conversationId?: string;
	systemPrompt?: string;
	updatedAt?: string;
}): SessionCompactionState {
	const lastSourceMessage = input.sourceMessages.at(-1);
	const sourceLastMessageKey = messageBoundaryKey(lastSourceMessage);
	return SessionCompactionStateSchema.parse({
		version: 1,
		updated_at: input.updatedAt ?? new Date().toISOString(),
		...(input.conversationId?.trim()
			? { conversation_id: input.conversationId.trim() }
			: {}),
		source_message_count: input.sourceMessages.length,
		source_prefix_hash: sourcePrefixHash(input.sourceMessages),
		...(sourceLastMessageKey
			? { source_last_message_key: sourceLastMessageKey }
			: {}),
		messages: cloneMessages(input.compactedMessages),
		...(input.systemPrompt !== undefined
			? { system_prompt: input.systemPrompt }
			: {}),
	});
}

export function projectSessionCompactionState(
	state: SessionCompactionState,
	sourceMessages: readonly MessageWithMetadata[],
): MessageWithMetadata[] | undefined {
	const hasEnoughSourceMessages =
		state.source_message_count <= sourceMessages.length;
	if (!hasEnoughSourceMessages) {
		return undefined;
	}

	const hasMatchingSourcePrefix =
		!!state.source_prefix_hash &&
		sourcePrefixHash(sourceMessages, state.source_message_count) ===
			state.source_prefix_hash;
	const boundary = sourceMessages[state.source_message_count - 1];
	const hasMatchingLegacyBoundary =
		!state.source_prefix_hash &&
		state.source_message_count > 0 &&
		!!state.source_last_message_key &&
		messageBoundaryKey(boundary) === state.source_last_message_key;
	const canProjectState = hasMatchingSourcePrefix || hasMatchingLegacyBoundary;
	if (!canProjectState) {
		return undefined;
	}

	return [
		...cloneMessages(state.messages),
		...cloneMessages(sourceMessages.slice(state.source_message_count)),
	];
}

export function parseSessionCompactionState(
	value: unknown,
): SessionCompactionState | undefined {
	const parsed = SessionCompactionStateSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}
