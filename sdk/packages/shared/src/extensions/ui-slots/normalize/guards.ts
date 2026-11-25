import { PLUGIN_UI_SLOTS, type PluginUiSlot } from "../constants";

const utf8 = new TextEncoder();

export function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return (
		typeof value === "string" && (values as readonly string[]).includes(value)
	);
}

export function exceedsUtf8Bytes(text: string, limit: number): boolean {
	return text.length > limit || utf8.encode(text).byteLength > limit;
}

export function isPluginUiSlot(value: unknown): value is PluginUiSlot {
	return isOneOf(PLUGIN_UI_SLOTS, value);
}

export function toPlainJson(
	value: unknown,
	maxBytes: number,
):
	| { ok: true; value: unknown }
	| { ok: false; reason: "unserializable" | "too_large" } {
	let json: string | undefined;
	try {
		json = JSON.stringify(value);
	} catch {
		return { ok: false, reason: "unserializable" };
	}
	if (json === undefined) return { ok: false, reason: "unserializable" };
	if (exceedsUtf8Bytes(json, maxBytes))
		return { ok: false, reason: "too_large" };
	return { ok: true, value: JSON.parse(json) };
}
