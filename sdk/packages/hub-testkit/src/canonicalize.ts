/**
 * Canonicalization of recorded Hub protocol v1 frames.
 *
 * A recorded transcript is only useful as a committed fixture if replaying the
 * same scenario produces the same bytes. Every source of run-to-run drift is
 * rewritten here: generated ids become stable placeholders (while preserving
 * referential integrity), clocks collapse to a placeholder, ephemeral ports
 * disappear, and secret-shaped material is redacted.
 *
 * This module is deliberately dependency-free so UI/browser tests can import it
 * without pulling in the node-only hub harness.
 */

export const FIXTURE_SCHEMA = "hub-v1-fixture@1";
export const TIMESTAMP_PLACEHOLDER = "<ts>";
export const REDACTED_PLACEHOLDER = "<redacted>";
export const PORT_PLACEHOLDER = "<port>";

export type FrameDirection = "in" | "out";

/** A frame exactly as it crossed the socket, already JSON-parsed. */
export interface RecordedFrame {
	direction: FrameDirection;
	frame: Record<string, unknown>;
}

/** A frame after canonicalization, ready to serialize into a fixture. */
export interface CanonicalFrame {
	direction: FrameDirection;
	/** Human-readable frame name; makes fixture diffs reviewable. */
	label: string;
	frame: Record<string, unknown>;
}

/**
 * Registration fields the testkit asserts on. The hub's `client.register`
 * request/reply may gain additive protocol metadata and capability lists; a
 * fixture that snapshotted the whole frame would churn on every such addition,
 * so both directions are projected onto this allowlist before canonicalization.
 */
export const REGISTER_COMMAND_ENVELOPE_KEYS = [
	"version",
	"command",
	"requestId",
	"clientId",
	"sessionId",
] as const;

/**
 * `protocolVersion` is deliberately pinned even though it is handshake metadata:
 * a client that stops advertising its version is silently treated by the hub as
 * pre-handshake, which is a regression no assertion elsewhere would catch. It
 * changes only when the protocol version itself does, so it does not churn.
 */
export const REGISTER_COMMAND_PAYLOAD_KEYS = [
	"clientId",
	"clientType",
	"displayName",
	"transport",
	"actorKind",
	"workspaceContext",
	"protocolVersion",
] as const;

export const REGISTER_REPLY_ENVELOPE_KEYS = [
	"version",
	"requestId",
	"ok",
	"error",
] as const;

export const REGISTER_REPLY_PAYLOAD_KEYS = ["clientId"] as const;

/**
 * Reply projection for the scenario that exists to pin the handshake itself.
 * Opt-in per scenario (`recordRegisterHandshake`) so the hub can keep adding
 * capabilities without rewriting every other fixture.
 */
export const REGISTER_REPLY_HANDSHAKE_PAYLOAD_KEYS = [
	"clientId",
	"protocol",
	"capabilities",
] as const;

export interface CanonicalizeOptions {
	/**
	 * Record the register reply's `protocol` metadata and `capabilities` instead
	 * of projecting them away. Additive-only: unknown reply fields stay projected
	 * out, so this widens the allowlist rather than disabling it.
	 */
	recordRegisterHandshake?: boolean;
}

/**
 * Id classes. `createSessionId(prefix)` produces `<prefix><epochMs>_<nanoid5>`,
 * so both the prefix and the field name are usable signals.
 */
const ID_CLASS_BY_KEY: Record<string, string> = {
	sessionId: "session",
	parentSessionId: "session",
	approvalId: "approval",
	clientId: "client",
	createdByClientId: "client",
	targetClientId: "client",
	respondedByClientId: "client",
	requestId: "request",
	eventId: "event",
	hubId: "hub",
	sourceHubId: "hub",
	peerHubId: "hub",
	toolCallId: "toolCall",
	agentId: "agent",
	parentAgentId: "agent",
	conversationId: "conversation",
	promptId: "prompt",
};

/**
 * Delimiter for the composite `<idClass><delimiter><id>` placeholder-map key. It
 * is a NUL because no id class or id value can contain one, so the class and the
 * id stay independently addressable however either grows. It is written as an
 * escape rather than a literal control character on purpose: a literal NUL in
 * the source makes git classify this file as binary and stop showing its diffs.
 */
const PLACEHOLDER_KEY_DELIMITER = "\u0000";

const ID_CLASS_BY_PREFIX: Record<string, string> = {
	hub_: "hub",
	client_: "client",
	approval_: "approval",
	hubreq_: "request",
	hevt_: "event",
	capreq_: "request",
	session_: "session",
};

/** `<epochMs>_<nanoid5>`, optionally behind one of the known prefixes. */
const GENERATED_ID_BODY = "\\d{13}_[0-9a-z]{5}";
const PREFIXED_ID_PATTERN = new RegExp(
	`\\b(${Object.keys(ID_CLASS_BY_PREFIX)
		.map((prefix) => prefix.replace("_", "_"))
		.join("|")})(${GENERATED_ID_BODY})\\b`,
	"g",
);
const BARE_ID_PATTERN = new RegExp(`^${GENERATED_ID_BODY}$`);

const TIMESTAMP_NUMBER_KEYS = new Set([
	"timestamp",
	"createdAt",
	"updatedAt",
	"connectedAt",
	"lastSeenAt",
	"attachedAt",
	// Pending-approval deadline: `createdAt + timeoutMs`, so absolute like the rest.
	"expiresAt",
	"durationMs",
	"elapsedMs",
	"ts",
	"startedAt",
	"endedAt",
]);

const SECRET_KEY_PATTERN =
	/(^|[._-])(authtoken|token|secret|credential|password|passphrase|authorization|apikey|api_key|accesskey)([._-]|$)/i;

const ISO_TIMESTAMP_PATTERN =
	/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})/g;

/** 32+ hex chars is the shape of a hub auth token; never a meaningful literal. */
const HEX_SECRET_PATTERN = /\b[a-f0-9]{32,}\b/g;

const HUB_AUTH_SUBPROTOCOL_PREFIX = "cline-hub-auth.";

/** `scheme://host:port` — only the port varies between runs. */
const URL_PORT_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+):\d{2,5}/gi;

export interface Canonicalizer {
	canonicalize(value: unknown): unknown;
	/** Real id -> placeholder, in first-seen order. Useful for assertions. */
	placeholders(): Record<string, string>;
	placeholderFor(id: string): string | undefined;
}

export function createCanonicalizer(): Canonicalizer {
	const placeholders = new Map<string, string>();
	const counters = new Map<string, number>();

	const placeholderFor = (idClass: string, value: string): string => {
		const key = `${idClass}${PLACEHOLDER_KEY_DELIMITER}${value}`;
		const existing = placeholders.get(key);
		if (existing) {
			return existing;
		}
		const next = (counters.get(idClass) ?? 0) + 1;
		counters.set(idClass, next);
		const placeholder = `<${idClass}_${next}>`;
		placeholders.set(key, placeholder);
		return placeholder;
	};

	const rewriteEmbedded = (text: string): string =>
		text
			.replace(PREFIXED_ID_PATTERN, (match, prefix: string) => {
				const idClass = ID_CLASS_BY_PREFIX[prefix];
				return idClass ? placeholderFor(idClass, match) : match;
			})
			.replace(ISO_TIMESTAMP_PATTERN, TIMESTAMP_PLACEHOLDER)
			.replace(URL_PORT_PATTERN, `$1:${PORT_PLACEHOLDER}`)
			.replace(HEX_SECRET_PATTERN, REDACTED_PLACEHOLDER);

	const canonicalizeString = (value: string, key?: string): string => {
		if (key && SECRET_KEY_PATTERN.test(key)) {
			// Keep the auth scheme visible so auth-mode regressions still show up.
			const bearer = /^Bearer\s+/i.exec(value);
			return bearer
				? `${bearer[0]}${REDACTED_PLACEHOLDER}`
				: REDACTED_PLACEHOLDER;
		}
		if (value.startsWith(HUB_AUTH_SUBPROTOCOL_PREFIX)) {
			return `${HUB_AUTH_SUBPROTOCOL_PREFIX}${REDACTED_PLACEHOLDER}`;
		}
		const keyClass = key ? ID_CLASS_BY_KEY[key] : undefined;
		if (keyClass && (BARE_ID_PATTERN.test(value) || isPrefixedId(value))) {
			return placeholderFor(keyClass, value);
		}
		if (keyClass && isOpaqueIdLiteral(value)) {
			// Test-authored ids (`call-1`, `agent_7`) are still per-run stable but
			// keying them by class keeps fixtures readable and future-proof.
			return placeholderFor(keyClass, value);
		}
		return rewriteEmbedded(value);
	};

	const walk = (value: unknown, key?: string): unknown => {
		if (typeof value === "string") {
			return canonicalizeString(value, key);
		}
		if (typeof value === "number") {
			if (key && SECRET_KEY_PATTERN.test(key)) {
				return REDACTED_PLACEHOLDER;
			}
			return key && TIMESTAMP_NUMBER_KEYS.has(key) ? 0 : value;
		}
		if (Array.isArray(value)) {
			return value.map((entry) => walk(entry, key));
		}
		if (value && typeof value === "object") {
			// Sorted keys make serialization independent of insertion order, which
			// is what makes an unchanged re-record byte-identical.
			const out: Record<string, unknown> = {};
			for (const entryKey of Object.keys(
				value as Record<string, unknown>,
			).sort()) {
				const entryValue = (value as Record<string, unknown>)[entryKey];
				if (entryValue === undefined) {
					continue;
				}
				out[entryKey] = walk(entryValue, entryKey);
			}
			return out;
		}
		return value;
	};

	return {
		canonicalize: (value) => walk(value),
		placeholders: () => {
			const out: Record<string, string> = {};
			for (const [key, placeholder] of placeholders) {
				out[idFromPlaceholderKey(key)] = placeholder;
			}
			return out;
		},
		placeholderFor: (id) => {
			for (const [key, placeholder] of placeholders) {
				if (idFromPlaceholderKey(key) === id) {
					return placeholder;
				}
			}
			return undefined;
		},
	};
}

/** Inverse of the composite placeholder-map key: recovers the id verbatim. */
function idFromPlaceholderKey(key: string): string {
	return key.slice(key.indexOf(PLACEHOLDER_KEY_DELIMITER) + 1);
}

function isPrefixedId(value: string): boolean {
	for (const prefix of Object.keys(ID_CLASS_BY_PREFIX)) {
		if (
			value.startsWith(prefix) &&
			BARE_ID_PATTERN.test(value.slice(prefix.length))
		) {
			return true;
		}
	}
	return false;
}

/**
 * An id-shaped literal: short, no whitespace, and not obviously prose. Applied
 * only to values sitting under a known id key.
 */
function isOpaqueIdLiteral(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= 64 &&
		/^[A-Za-z0-9_.:-]+$/.test(value) &&
		!/^(hub|native|client|unknown|creator|participant|act|plan|yolo|core|cli|web|api)$/.test(
			value,
		)
	);
}

function pick(
	source: Record<string, unknown> | undefined,
	keys: readonly string[],
): Record<string, unknown> | undefined {
	if (!source) {
		return undefined;
	}
	const out: Record<string, unknown> = {};
	for (const key of keys) {
		if (source[key] !== undefined) {
			out[key] = source[key];
		}
	}
	return out;
}

function envelopeOf(
	frame: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const envelope = frame.envelope;
	return envelope && typeof envelope === "object" && !Array.isArray(envelope)
		? (envelope as Record<string, unknown>)
		: undefined;
}

function payloadOf(
	envelope: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const payload = envelope?.payload;
	return payload && typeof payload === "object" && !Array.isArray(payload)
		? (payload as Record<string, unknown>)
		: undefined;
}

/** Human-readable name used for the fixture `label` field. */
export function frameLabel(
	frame: Record<string, unknown>,
	replyCommands?: Map<string, string>,
): string {
	const kind = frame.kind;
	const envelope = envelopeOf(frame);
	if (kind === "command") {
		return String(envelope?.command ?? "command");
	}
	if (kind === "event") {
		return String(envelope?.event ?? "event");
	}
	if (kind === "reply") {
		const requestId =
			typeof envelope?.requestId === "string" ? envelope.requestId : "";
		const command = replyCommands?.get(requestId);
		return command ? `reply ${command}` : "reply";
	}
	return String(kind ?? "unknown");
}

/**
 * Project + canonicalize an ordered frame stream.
 *
 * Projection happens first (and needs request/reply correlation), so
 * `client.register` frames are reduced to their allowlisted fields before any
 * id or timestamp rewriting takes place.
 */
export function canonicalizeFrames(
	frames: RecordedFrame[],
	options: CanonicalizeOptions = {},
): CanonicalFrame[] {
	return canonicalizeTranscript({ frames, ...options }).frames;
}

/**
 * Canonicalizes frames plus an optional scenario outcome (e.g. the typed error a
 * command rejected with) through a single canonicalizer, so ids referenced by
 * the outcome share placeholders with the frames that produced them.
 */
export function canonicalizeTranscript(
	input: CanonicalizeOptions & {
		frames: RecordedFrame[];
		outcome?: unknown;
	},
): { frames: CanonicalFrame[]; outcome?: unknown } {
	const canonicalizer = createCanonicalizer();
	const commandByRequestId = new Map<string, string>();
	for (const recorded of input.frames) {
		if (recorded.frame.kind !== "command") {
			continue;
		}
		const envelope = envelopeOf(recorded.frame);
		const requestId =
			typeof envelope?.requestId === "string" ? envelope.requestId : "";
		if (requestId) {
			commandByRequestId.set(requestId, String(envelope?.command ?? ""));
		}
	}

	const replyPayloadKeys = input.recordRegisterHandshake
		? REGISTER_REPLY_HANDSHAKE_PAYLOAD_KEYS
		: REGISTER_REPLY_PAYLOAD_KEYS;
	const canonicalFrames = input.frames.map((recorded) => {
		const projected = projectFrame(
			recorded.frame,
			commandByRequestId,
			replyPayloadKeys,
		);
		return {
			direction: recorded.direction,
			label: frameLabel(recorded.frame, commandByRequestId),
			frame: canonicalizer.canonicalize(projected) as Record<string, unknown>,
		};
	});
	return {
		frames: canonicalFrames,
		...(input.outcome === undefined
			? {}
			: { outcome: canonicalizer.canonicalize(input.outcome) }),
	};
}

function projectFrame(
	frame: Record<string, unknown>,
	commandByRequestId: Map<string, string>,
	replyPayloadKeys: readonly string[] = REGISTER_REPLY_PAYLOAD_KEYS,
): Record<string, unknown> {
	const envelope = envelopeOf(frame);
	if (!envelope) {
		return frame;
	}
	if (frame.kind === "command" && envelope.command === "client.register") {
		return {
			kind: "command",
			envelope: {
				...pick(envelope, REGISTER_COMMAND_ENVELOPE_KEYS),
				...(payloadOf(envelope)
					? {
							payload: pick(payloadOf(envelope), REGISTER_COMMAND_PAYLOAD_KEYS),
						}
					: {}),
			},
		};
	}
	if (frame.kind === "reply") {
		const requestId =
			typeof envelope.requestId === "string" ? envelope.requestId : "";
		if (commandByRequestId.get(requestId) === "client.register") {
			return {
				kind: "reply",
				envelope: {
					...pick(envelope, REGISTER_REPLY_ENVELOPE_KEYS),
					...(payloadOf(envelope)
						? { payload: pick(payloadOf(envelope), replyPayloadKeys) }
						: {}),
				},
			};
		}
	}
	return frame;
}
