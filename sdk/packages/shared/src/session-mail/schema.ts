/**
 * Session mail tool schemas.
 *
 * Zod schemas and schema-derived types for the session-to-session messaging
 * tool surface.
 */

import { z } from "zod";
import {
	SESSION_MESSAGE_BODY_LIMIT,
	SESSION_MESSAGE_SUBJECT_LIMIT,
} from "./types";

const IsoTimestampSchema = z.preprocess(
	(value) => (value instanceof Date ? value.toISOString() : value),
	z.string().datetime(),
);

function nullableOptional<T extends z.ZodTypeAny>(schema: T) {
	return z.preprocess(
		(value) => (value === null ? undefined : value),
		schema.optional(),
	);
}

export const SessionMessageDeliverySchema = z.enum(["queue", "steer"]);

export const SessionMessageStatusSchema = z.enum([
	"pending",
	"delivered",
	"read",
	"dropped",
]);

// ---------------------------------------------------------------------------
// session_list_peers
// ---------------------------------------------------------------------------

export const SessionListPeersInputSchema = z.object({
	reachableOnly: nullableOptional(z.boolean()).describe(
		"Only return sessions that are live and can be woken right now.",
	),
	workspaceRoot: nullableOptional(z.string()).describe(
		"Only return sessions whose workspace root matches this path.",
	),
	limit: nullableOptional(z.number().int().min(1).max(100)),
});
export type SessionListPeersInput = z.infer<typeof SessionListPeersInputSchema>;

export const SessionPeerToolResultSchema = z.object({
	sessionId: z.string(),
	status: z.string(),
	cwd: z.string(),
	workspaceRoot: z.string(),
	provider: z.string(),
	model: z.string(),
	prompt: z.string().optional(),
	startedAt: z.string(),
	updatedAt: z.string(),
	isSubagent: z.boolean(),
	reachable: z.boolean(),
});
export type SessionPeerToolResult = z.infer<typeof SessionPeerToolResultSchema>;

// ---------------------------------------------------------------------------
// session_send_message
// ---------------------------------------------------------------------------

export const SessionSendMessageInputSchema = z.object({
	toSessionId: z
		.string()
		.min(1)
		.describe("Target sessionId, from session_list_peers."),
	subject: z.string().min(1).max(SESSION_MESSAGE_SUBJECT_LIMIT),
	body: z.string().min(1).max(SESSION_MESSAGE_BODY_LIMIT),
	delivery: nullableOptional(SessionMessageDeliverySchema).describe(
		"'queue' (default) runs after the target's current work; 'steer' interrupts it.",
	),
});
export type SessionSendMessageInput = z.infer<
	typeof SessionSendMessageInputSchema
>;

export const SessionSendMessageToolResultSchema = z.object({
	id: z.string(),
	toSessionId: z.string(),
	status: SessionMessageStatusSchema,
	deliveredNow: z.boolean(),
	hopCount: z.number(),
});
export type SessionSendMessageToolResult = z.infer<
	typeof SessionSendMessageToolResultSchema
>;

// ---------------------------------------------------------------------------
// session_read_inbox
// ---------------------------------------------------------------------------

export const SessionReadInboxInputSchema = z.object({
	unreadOnly: nullableOptional(z.boolean()),
	limit: nullableOptional(z.number().int().min(1).max(100)),
});
export type SessionReadInboxInput = z.infer<typeof SessionReadInboxInputSchema>;

export const SessionMessageToolResultSchema = z.object({
	id: z.string(),
	fromSessionId: z.string(),
	fromLabel: z.string().optional(),
	toSessionId: z.string(),
	subject: z.string(),
	body: z.string(),
	delivery: SessionMessageDeliverySchema,
	status: SessionMessageStatusSchema,
	hopCount: z.number(),
	sentAt: IsoTimestampSchema,
	deliveredAt: nullableOptional(IsoTimestampSchema),
	readAt: nullableOptional(IsoTimestampSchema),
});
export type SessionMessageToolResult = z.infer<
	typeof SessionMessageToolResultSchema
>;
