import type { ListValue } from "./generated/google/protobuf/ListValue";
import type { Struct } from "./generated/google/protobuf/Struct";
import type { Value } from "./generated/google/protobuf/Value";

function toValueInternal(input: unknown): Value {
	if (input === null || input === undefined) {
		return { nullValue: "NULL_VALUE" };
	}
	if (typeof input === "string") {
		return { stringValue: input };
	}
	if (typeof input === "number") {
		return { numberValue: Number.isFinite(input) ? input : 0 };
	}
	if (typeof input === "boolean") {
		return { boolValue: input };
	}
	if (Array.isArray(input)) {
		const values = input.map((item) => toValueInternal(item));
		const listValue: ListValue = { values };
		return { listValue };
	}
	if (typeof input === "object") {
		const struct: Struct = { fields: {} };
		for (const [key, value] of Object.entries(input)) {
			struct.fields ??= {};
			struct.fields[key] = toValueInternal(value);
		}
		return { structValue: struct };
	}
	return { stringValue: String(input) };
}

function fromValueInternal(value: Value | undefined): unknown {
	if (!value) {
		return undefined;
	}
	if (value.nullValue !== undefined) {
		return null;
	}
	if (value.stringValue !== undefined) {
		return value.stringValue;
	}
	if (value.numberValue !== undefined) {
		return value.numberValue;
	}
	if (value.boolValue !== undefined) {
		return value.boolValue;
	}
	if (value.listValue) {
		return (value.listValue.values ?? []).map((item) =>
			fromValueInternal(item),
		);
	}
	if (value.structValue) {
		const out: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(
			value.structValue.fields ?? {},
		)) {
			out[key] = fromValueInternal(nested);
		}
		return out;
	}
	return undefined;
}

export function toProtoStruct(
	input: Record<string, unknown> | undefined,
): Struct {
	const fields: Record<string, Value> = {};
	for (const [key, value] of Object.entries(input ?? {})) {
		fields[key] = toValueInternal(value);
	}
	return { fields };
}

export function fromProtoStruct(
	input: Struct | null | undefined,
): Record<string, unknown> | undefined {
	if (!input?.fields) {
		return undefined;
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input.fields)) {
		out[key] = fromValueInternal(value);
	}
	return out;
}

export function toProtoValue(input: unknown): Value {
	return toValueInternal(input);
}

export function fromProtoValue(input: Value | null | undefined): unknown {
	return fromValueInternal(input ?? undefined);
}
