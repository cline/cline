import { z } from "zod";

/**
 * Hub wire contract building blocks.
 *
 * Every Hub command and event is declared once as a zod schema. The schemas
 * validate command payloads at the Hub boundary, render the JSON Schema
 * baseline in hub-protocol.released.json, and name the protocol's commands and
 * events for the TypeScript types in hub.ts.
 *
 * Conventions (they keep additive changes compatible across installations):
 * - Objects are loose: unknown keys pass through, so a newer peer may send
 *   fields an older Hub does not know yet.
 * - A field is required only when its handler rejects the command without it.
 *   Everything else is optional; use `.nullish()` where senders pass null.
 * - Deeply nested runtime structures (session configs, messages, provider
 *   settings) stay as `hubRecord` until they get schemas of their own.
 */

/** A JSON object whose shape this contract does not pin down (yet). */
export const hubRecord = z.record(z.string(), z.unknown());

/** Loose object: declared fields are checked, unknown fields pass through. */
export function hubObject<Shape extends z.ZodRawShape>(shape: Shape) {
	return z.looseObject(shape);
}

/** Payload of a command that takes no input. */
export const hubEmptyInput = hubObject({});

export interface HubCommandContract {
	/** Schema for HubCommandEnvelope.payload (absent payloads parse as `{}`). */
	input: z.ZodType;
	/** Schema for a successful HubReplyEnvelope.payload, where specified. */
	output?: z.ZodType;
	description: string;
}

export interface HubEventContract {
	/** Schema for HubEventEnvelope.payload. */
	payload: z.ZodType;
	description: string;
}

export function defineHubCommands<
	const Commands extends Record<string, HubCommandContract>,
>(commands: Commands): Commands {
	return commands;
}

export function defineHubEvents<
	const Events extends Record<string, HubEventContract>,
>(events: Events): Events {
	return events;
}
