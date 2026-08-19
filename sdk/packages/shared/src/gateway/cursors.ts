/**
 * Event replay cursors (Gateway RFC, Phase 0).
 *
 * A cursor names a position in a scope's ordered event stream: "deliver
 * events with `sequence` greater than `lastSequence`". Cursors are opaque
 * strings on the wire (base64url JSON) so their internals can evolve;
 * decoding validates structure and rejects tampered values.
 */

import { z } from "zod";
import { createGatewayError, type GatewayError } from "./errors";

const CURSOR_VERSION = 1 as const;

export const EventCursorSchema = z
	.object({
		v: z.literal(CURSOR_VERSION),
		/** Highest event sequence already seen; -1 means "from the beginning". */
		lastSequence: z.number().int().min(-1),
	})
	.strict();

export type EventCursor = z.infer<typeof EventCursorSchema>;

/** Cursor that replays a stream from its first event. */
export const INITIAL_EVENT_CURSOR: EventCursor = {
	v: CURSOR_VERSION,
	lastSequence: -1,
};

export function createEventCursor(lastSequence: number): EventCursor {
	return EventCursorSchema.parse({ v: CURSOR_VERSION, lastSequence });
}

export function encodeEventCursor(cursor: EventCursor): string {
	const json = JSON.stringify(EventCursorSchema.parse(cursor));
	return Buffer.from(json, "utf8").toString("base64url");
}

export class EventCursorDecodeError extends Error {
	readonly gatewayError: GatewayError;

	constructor(reason: string) {
		const message = `Invalid event cursor: ${reason}`;
		super(message);
		this.name = "EventCursorDecodeError";
		this.gatewayError = createGatewayError("invalid_request", message);
	}
}

export function decodeEventCursor(encoded: string): EventCursor {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		throw new EventCursorDecodeError("not base64url-encoded JSON");
	}
	const result = EventCursorSchema.safeParse(parsed);
	if (!result.success) {
		throw new EventCursorDecodeError("structure does not match the contract");
	}
	return result.data;
}
