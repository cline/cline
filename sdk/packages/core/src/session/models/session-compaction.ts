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
	updated_at: z.string().min(1),
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
	return JSON.parse(canonicalJson(messages)) as MessageWithMetadata[];
}

function toCanonicalJsonValue(value: unknown, seen: WeakSet<object>): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "bigint") {
		throw new TypeError("Cannot serialize bigint in session compaction state");
	}
	if (
		value === undefined ||
		typeof value === "function" ||
		typeof value === "symbol"
	) {
		return undefined;
	}
	if (typeof value !== "object") {
		return value;
	}

	const withToJson = value as { toJSON?: () => unknown };
	if (typeof withToJson.toJSON === "function") {
		const jsonValue = withToJson.toJSON();
		if (jsonValue !== value) {
			return toCanonicalJsonValue(jsonValue, seen);
		}
	}

	if (seen.has(value)) {
		throw new TypeError("Cannot serialize circular session compaction state");
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((item) => {
				const normalized = toCanonicalJsonValue(item, seen);
				return normalized === undefined ? null : normalized;
			});
		}

		const record = value as Record<string, unknown>;
		const normalized: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			const item = toCanonicalJsonValue(record[key], seen);
			if (item !== undefined) {
				normalized[key] = item;
			}
		}
		return normalized;
	} finally {
		seen.delete(value);
	}
}

function canonicalJson(value: unknown): string {
	const json = JSON.stringify(
		toCanonicalJsonValue(value, new WeakSet<object>()),
	);
	if (json === undefined) {
		throw new TypeError("Cannot serialize undefined session compaction state");
	}
	return json;
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

function messageBoundaryKey(message: MessageWithMetadata | undefined): string {
	if (!message) {
		return "";
	}
	const normalized = normalizeMessageForSourceHash(message);
	if (typeof normalized.id === "string" && normalized.id.trim()) {
		return `id:${normalized.id.trim()}`;
	}
	if (typeof normalized.ts === "number" && Number.isFinite(normalized.ts)) {
		return `ts:${normalized.role}:${normalized.ts}`;
	}
	return `content:${normalized.role}:${JSON.stringify(normalized.content)}`;
}

function sourcePrefixHash(
	messages: readonly MessageWithMetadata[],
	count = messages.length,
): string {
	const hash = createHash("sha256");
	hash.update("cline-session-compaction-source-v1\n");
	hash.update(`${count}\n`);
	for (const message of messages.slice(0, count)) {
		hash.update(canonicalJson(normalizeMessageForSourceHash(message)));
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
	if (state.source_message_count > sourceMessages.length) {
		return undefined;
	}
	if (state.source_prefix_hash) {
		if (
			sourcePrefixHash(sourceMessages, state.source_message_count) !==
			state.source_prefix_hash
		) {
			return undefined;
		}
	} else if (state.source_message_count > 0 && state.source_last_message_key) {
		const boundary = sourceMessages[state.source_message_count - 1];
		if (messageBoundaryKey(boundary) !== state.source_last_message_key) {
			return undefined;
		}
	} else {
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
