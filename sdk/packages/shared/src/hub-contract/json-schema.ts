import { z } from "zod";
import type { HubCommandContract, HubEventContract } from "./define";

type JsonSchema = Record<string, unknown>;

export interface HubProtocolDocument {
	protocolVersion: string;
	envelopes: Record<string, JsonSchema>;
	commands: Record<
		string,
		{ description: string; input: JsonSchema; output?: JsonSchema }
	>;
	events: Record<string, { description: string; payload: JsonSchema }>;
}

function toJsonSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
	const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
		io,
		unrepresentable: "any",
	}) as JsonSchema;
	return json;
}

/**
 * Renders the contract as plain JSON Schema: the form recorded per SDK
 * release (hub-protocol.released.json) for compatibility checks.
 * Inputs are rendered as the Hub accepts them, outputs and events as the Hub
 * produces them.
 */
export function toHubProtocolDocument(contract: {
	protocolVersion: string;
	envelopes: Record<string, z.ZodType>;
	commands: Record<string, HubCommandContract>;
	events: Record<string, HubEventContract>;
}): HubProtocolDocument {
	const sorted = <T>(record: Record<string, T>) =>
		Object.keys(record)
			.sort()
			.map((key) => [key, record[key] as T] as const);
	return {
		protocolVersion: contract.protocolVersion,
		envelopes: Object.fromEntries(
			sorted(contract.envelopes).map(([name, schema]) => [
				name,
				toJsonSchema(schema, "input"),
			]),
		),
		commands: Object.fromEntries(
			sorted(contract.commands).map(([name, command]) => [
				name,
				{
					description: command.description,
					input: toJsonSchema(command.input, "input"),
					...(command.output
						? { output: toJsonSchema(command.output, "output") }
						: {}),
				},
			]),
		),
		events: Object.fromEntries(
			sorted(contract.events).map(([name, event]) => [
				name,
				{
					description: event.description,
					payload: toJsonSchema(event.payload, "output"),
				},
			]),
		),
	};
}

/**
 * Which side of the wire reads a schema, which decides what breaks it:
 * - `accepts`: the Hub reads it (command inputs). Old clients keep sending
 *   old payloads, so new requirements, narrower types, and dropped fields
 *   break them.
 * - `emits`: the Hub produces it (outputs, events). Old clients keep reading
 *   old fields, so dropped or no-longer-guaranteed fields and changed types
 *   break them.
 */
type Direction = "accepts" | "emits";

function asSchema(value: unknown): JsonSchema | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonSchema)
		: undefined;
}

function typeOf(schema: JsonSchema): string | undefined {
	const type = schema.type;
	if (Array.isArray(type)) return [...type].sort().join("|");
	return typeof type === "string" ? type : undefined;
}

function variants(schema: JsonSchema): JsonSchema[] | undefined {
	const options = schema.anyOf ?? schema.oneOf;
	return Array.isArray(options)
		? options.map((option) => asSchema(option) ?? {})
		: undefined;
}

/** Pairs union members across versions: by JSON type, else by exact shape. */
function variantKey(schema: JsonSchema): string {
	return typeOf(schema) ?? JSON.stringify(schema);
}

function diffSchema(
	path: string,
	before: JsonSchema,
	after: JsonSchema,
	direction: Direction,
	out: string[],
): void {
	const beforeVariants = variants(before);
	const afterVariants = variants(after);
	if (beforeVariants || afterVariants) {
		const previous = beforeVariants ?? [before];
		const next = afterVariants ?? [after];
		// Accepted inputs: every old shape must still be accepted. Emitted
		// values: every new shape must be one old readers handle.
		const [required, offered] =
			direction === "accepts" ? [previous, next] : [next, previous];
		for (const variant of required) {
			const key = variantKey(variant);
			const match = offered.find((candidate) => variantKey(candidate) === key);
			if (!match) {
				out.push(
					direction === "accepts"
						? `${path}: no longer accepts ${key}`
						: `${path}: may now produce ${key}`,
				);
				continue;
			}
			const [was, is] =
				direction === "accepts" ? [variant, match] : [match, variant];
			diffSchema(path, was, is, direction, out);
		}
		return;
	}

	const beforeType = typeOf(before);
	const afterType = typeOf(after);
	if (beforeType && afterType && beforeType !== afterType) {
		out.push(`${path}: type changed from ${beforeType} to ${afterType}`);
		return;
	}
	if (beforeType && !afterType && direction === "emits") {
		out.push(`${path}: type ${beforeType} is no longer guaranteed`);
	}
	if (!beforeType && afterType && direction === "accepts") {
		out.push(`${path}: now restricted to ${afterType}`);
	}

	if (Array.isArray(before.enum) && Array.isArray(after.enum)) {
		const afterEnum = new Set(after.enum.map((value) => JSON.stringify(value)));
		const beforeEnum = new Set(
			before.enum.map((value) => JSON.stringify(value)),
		);
		if (direction === "accepts") {
			for (const value of beforeEnum) {
				if (!afterEnum.has(value))
					out.push(`${path}: no longer accepts ${value}`);
			}
		} else {
			for (const value of afterEnum) {
				if (!beforeEnum.has(value))
					out.push(`${path}: may now produce ${value}`);
			}
		}
	}
	if (
		before.const !== undefined &&
		JSON.stringify(before.const) !== JSON.stringify(after.const)
	) {
		out.push(`${path}: constant changed`);
	}

	const beforeProperties = asSchema(before.properties) ?? {};
	const afterProperties = asSchema(after.properties) ?? {};
	const beforeRequired = new Set(
		Array.isArray(before.required) ? (before.required as string[]) : [],
	);
	const afterRequired = new Set(
		Array.isArray(after.required) ? (after.required as string[]) : [],
	);
	for (const [name, schema] of Object.entries(beforeProperties)) {
		const next = asSchema(afterProperties[name]);
		const field = `${path}.${name}`;
		if (!next) {
			out.push(
				direction === "accepts"
					? `${field}: removed (senders still pass it)`
					: `${field}: removed (readers still expect it)`,
			);
			continue;
		}
		if (
			direction === "emits" &&
			beforeRequired.has(name) &&
			!afterRequired.has(name)
		) {
			out.push(`${field}: no longer always present`);
		}
		const previous = asSchema(schema);
		if (previous) diffSchema(field, previous, next, direction, out);
	}
	if (direction === "accepts") {
		for (const name of afterRequired) {
			if (!beforeRequired.has(name)) {
				out.push(`${path}.${name}: newly required`);
			}
		}
	}

	const beforeItems = asSchema(before.items);
	const afterItems = asSchema(after.items);
	if (beforeItems && afterItems) {
		diffSchema(`${path}[]`, beforeItems, afterItems, direction, out);
	}
	const beforeValues = asSchema(before.additionalProperties);
	const afterValues = asSchema(after.additionalProperties);
	if (beforeValues && afterValues) {
		diffSchema(`${path}{}`, beforeValues, afterValues, direction, out);
	}
}

/**
 * Lists changes in `after` that break peers built against `before`.
 * Additive changes (new commands, events, and optional fields) are not
 * listed; they are compatible under the protocol version.
 */
export function findBreakingHubProtocolChanges(
	before: HubProtocolDocument,
	after: HubProtocolDocument,
): string[] {
	const out: string[] = [];
	for (const [name, schema] of Object.entries(before.envelopes)) {
		const next = after.envelopes[name];
		// The Hub reads command envelopes and writes replies and events.
		const direction = name === "command" ? "accepts" : "emits";
		if (!next) out.push(`envelope ${name}: removed`);
		else diffSchema(`envelope ${name}`, schema, next, direction, out);
	}
	for (const [name, command] of Object.entries(before.commands)) {
		const next = after.commands[name];
		if (!next) {
			out.push(`command ${name}: removed`);
			continue;
		}
		diffSchema(
			`command ${name} input`,
			command.input,
			next.input,
			"accepts",
			out,
		);
		if (command.output) {
			if (!next.output) out.push(`command ${name} output: no longer specified`);
			else
				diffSchema(
					`command ${name} output`,
					command.output,
					next.output,
					"emits",
					out,
				);
		}
	}
	for (const [name, event] of Object.entries(before.events)) {
		const next = after.events[name];
		if (!next) out.push(`event ${name}: removed`);
		else diffSchema(`event ${name}`, event.payload, next.payload, "emits", out);
	}
	return out;
}
