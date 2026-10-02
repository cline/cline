import { z } from "zod";
import { automationCommands } from "./commands/automation";
import { clientHubCommands } from "./commands/client-hub";
import { runCommands } from "./commands/run";
import { sessionCommands } from "./commands/session";
import {
	type HubCommandContract,
	type HubEventContract,
	hubObject,
	hubRecord,
} from "./define";
import { hubEvents } from "./events";
import { type HubProtocolDocument, toHubProtocolDocument } from "./json-schema";

export * from "./define";
export * from "./json-schema";

/** Every Hub command, keyed by its wire name. */
export const hubCommands = {
	...clientHubCommands,
	...sessionCommands,
	...runCommands,
	...automationCommands,
} as const satisfies Record<string, HubCommandContract>;

export { hubEvents };

export type HubContractCommandName = keyof typeof hubCommands;
export type HubContractEventName = keyof typeof hubEvents;

export type HubCommandPayload<Command extends HubContractCommandName> = z.input<
	(typeof hubCommands)[Command]["input"]
>;
export type HubEventPayload<Event extends HubContractEventName> = z.input<
	(typeof hubEvents)[Event]["payload"]
>;

export const HUB_COMMAND_NAMES = Object.keys(
	hubCommands,
) as HubContractCommandName[];
export const HUB_EVENT_NAMES = Object.keys(hubEvents) as HubContractEventName[];

const optionalString = z.string().optional();

export const hubEnvelopes = {
	command: hubObject({
		version: z.string(),
		command: z.string(),
		requestId: optionalString,
		clientId: optionalString,
		sessionId: optionalString,
		timeoutMs: z.number().nullable().optional(),
		payload: hubRecord.optional(),
	}),
	reply: hubObject({
		version: z.string(),
		requestId: optionalString,
		ok: z.boolean(),
		payload: hubRecord.optional(),
		error: hubObject({
			code: z.string(),
			message: z.string(),
			details: hubRecord.optional(),
		}).optional(),
	}),
	event: hubObject({
		version: z.string(),
		event: z.string(),
		eventId: optionalString,
		sequence: z.number().optional(),
		sessionId: optionalString,
		clientId: optionalString,
		sourceHubId: optionalString,
		timestamp: z.number().optional(),
		payload: hubRecord.optional(),
	}),
} as const;

export function getHubCommandContract(
	command: string,
): HubCommandContract | undefined {
	return Object.hasOwn(hubCommands, command)
		? hubCommands[command as HubContractCommandName]
		: undefined;
}

export function getHubEventContract(
	event: string,
): HubEventContract | undefined {
	return Object.hasOwn(hubEvents, event)
		? hubEvents[event as HubContractEventName]
		: undefined;
}

export type HubPayloadValidationResult =
	| { ok: true }
	| { ok: false; message: string; issues: HubPayloadIssue[] };

export interface HubPayloadIssue {
	path: string;
	message: string;
}

/**
 * Checks a command payload against its contract. Commands without a
 * contract pass: the dispatcher reports unknown commands itself.
 */
export function validateHubCommandPayload(
	command: string,
	payload: unknown,
): HubPayloadValidationResult {
	const contract = getHubCommandContract(command);
	if (!contract) {
		return { ok: true };
	}
	const result = contract.input.safeParse(payload ?? {});
	if (result.success) {
		return { ok: true };
	}
	const issues = result.error.issues.map((issue) => ({
		path: issue.path.map(String).join("."),
		message: issue.message,
	}));
	return {
		ok: false,
		issues,
		message: `Invalid ${command} payload: ${issues
			.map((issue) =>
				issue.path ? `${issue.path}: ${issue.message}` : issue.message,
			)
			.join("; ")}`,
	};
}

/** The whole contract as JSON Schema, as recorded in hub-protocol.released.json. */
export function buildHubProtocolDocument(
	protocolVersion: string,
): HubProtocolDocument {
	return toHubProtocolDocument({
		protocolVersion,
		envelopes: hubEnvelopes,
		commands: hubCommands,
		events: hubEvents,
	});
}
