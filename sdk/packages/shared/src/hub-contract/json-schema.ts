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

function types(schema: JsonSchema): Set<string> | undefined {
	const type = schema.type;
	if (Array.isArray(type)) return new Set(type as string[]);
	return typeof type === "string" ? new Set([type]) : undefined;
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

function values(schema: JsonSchema): unknown[] | undefined {
	if (Array.isArray(schema.enum)) return schema.enum;
	if (schema.const !== undefined) return [schema.const];
	return undefined;
}

function compareAllowedValues(
	path: string,
	before: JsonSchema,
	after: JsonSchema,
	direction: Direction,
	out: string[],
): void {
	const beforeValues = values(before);
	const afterValues = values(after);
	if (direction === "accepts") {
		// An omitted enum/const means any value of the schema's type is accepted.
		if (!afterValues) return;
		if (!beforeValues) {
			out.push(`${path}: now restricted to ${JSON.stringify(afterValues)}`);
			return;
		}
		const afterSet = new Set(afterValues.map((value) => JSON.stringify(value)));
		for (const value of beforeValues) {
			if (!afterSet.has(JSON.stringify(value)))
				out.push(`${path}: no longer accepts ${JSON.stringify(value)}`);
		}
		return;
	}

	// Removing an output restriction may let the Hub emit values old clients
	// never handled. Tightening it remains safe for old readers.
	if (!beforeValues) return;
	if (!afterValues) {
		out.push(
			`${path}: may now produce values outside ${JSON.stringify(beforeValues)}`,
		);
		return;
	}
	const beforeSet = new Set(beforeValues.map((value) => JSON.stringify(value)));
	for (const value of afterValues) {
		if (!beforeSet.has(JSON.stringify(value)))
			out.push(`${path}: may now produce ${JSON.stringify(value)}`);
	}
}

function compareNumericBounds(
	path: string,
	before: JsonSchema,
	after: JsonSchema,
	direction: Direction,
	out: string[],
): void {
	const bounds = [
		"minimum",
		"maximum",
		"exclusiveMinimum",
		"exclusiveMaximum",
	] as const;
	for (const bound of bounds) {
		const oldValue = before[bound];
		const newValue = after[bound];
		if (oldValue === newValue) continue;
		const isLowerBound = bound === "minimum" || bound === "exclusiveMinimum";
		const tighter =
			newValue !== undefined &&
			(oldValue === undefined ||
				(isLowerBound
					? Number(newValue) > Number(oldValue)
					: Number(newValue) < Number(oldValue)));
		const looser =
			oldValue !== undefined &&
			(newValue === undefined ||
				(isLowerBound
					? Number(newValue) < Number(oldValue)
					: Number(newValue) > Number(oldValue)));
		if (
			(direction === "accepts" && tighter) ||
			(direction === "emits" && looser)
		) {
			out.push(
				`${path}: ${bound} ${String(oldValue)} changed to ${String(newValue)}`,
			);
		}
	}
}

function compareLimit(
	path: string,
	before: JsonSchema,
	after: JsonSchema,
	key: string,
	tighterWhen: "greater" | "less",
	direction: Direction,
	out: string[],
): void {
	const oldValue = before[key];
	const newValue = after[key];
	if (oldValue === newValue) return;
	const tighter =
		newValue !== undefined &&
		(oldValue === undefined ||
			(tighterWhen === "greater"
				? Number(newValue) > Number(oldValue)
				: Number(newValue) < Number(oldValue)));
	const looser =
		oldValue !== undefined &&
		(newValue === undefined ||
			(tighterWhen === "greater"
				? Number(newValue) < Number(oldValue)
				: Number(newValue) > Number(oldValue)));
	if (
		(direction === "accepts" && tighter) ||
		(direction === "emits" && looser)
	) {
		out.push(
			`${path}: ${key} ${String(oldValue)} changed to ${String(newValue)}`,
		);
	}
}

function compareOtherConstraints(
	path: string,
	before: JsonSchema,
	after: JsonSchema,
	direction: Direction,
	out: string[],
): void {
	// Patterns are opaque to JSON Schema; any change to an input pattern may
	// reject values sent by old clients, while any output pattern widening can
	// emit values an old reader did not expect.
	if (before.pattern !== after.pattern) {
		const isBreaking =
			direction === "accepts"
				? after.pattern !== undefined
				: before.pattern !== undefined;
		if (isBreaking)
			out.push(
				`${path}: pattern ${String(before.pattern)} changed to ${String(after.pattern)}`,
			);
	}
	compareLimit(path, before, after, "minLength", "greater", direction, out);
	compareLimit(path, before, after, "maxLength", "less", direction, out);
	compareLimit(path, before, after, "minItems", "greater", direction, out);
	compareLimit(path, before, after, "maxItems", "less", direction, out);
	compareLimit(path, before, after, "minProperties", "greater", direction, out);
	compareLimit(path, before, after, "maxProperties", "less", direction, out);
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

	const beforeTypes = types(before);
	const afterTypes = types(after);
	const incompatibleTypes =
		direction === "accepts"
			? beforeTypes &&
				afterTypes &&
				[...beforeTypes].filter((type) => !afterTypes.has(type))
			: afterTypes &&
				beforeTypes &&
				[...afterTypes].filter((type) => !beforeTypes.has(type));
	if (
		(direction === "accepts" && !beforeTypes && afterTypes) ||
		(direction === "emits" && beforeTypes && !afterTypes) ||
		(Array.isArray(incompatibleTypes) && incompatibleTypes.length > 0)
	) {
		const previous = beforeTypes ? typeOf(before) : "any";
		const next = afterTypes ? typeOf(after) : "any";
		out.push(`${path}: type changed from ${previous} to ${next}`);
	}

	compareAllowedValues(path, before, after, direction, out);
	compareNumericBounds(path, before, after, direction, out);
	compareOtherConstraints(path, before, after, direction, out);

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
