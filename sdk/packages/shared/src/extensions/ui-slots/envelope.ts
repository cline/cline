import type { PluginUiSlot } from "./constants";
import type { PluginUiOrder, PluginUiStateEnvelope } from "./contracts";
import { isPluginUiSlot } from "./normalize/guards";
import { normalizePluginUiState } from "./normalize/state";

export function comparePluginUiOrder(
	a: PluginUiOrder,
	b: PluginUiOrder,
): number {
	return a.epoch - b.epoch || a.seq - b.seq;
}

export function applyPluginUiState<S extends PluginUiSlot>(
	current: PluginUiStateEnvelope<S> | undefined,
	next: PluginUiStateEnvelope<S>,
): PluginUiStateEnvelope<S> {
	return !current || comparePluginUiOrder(next, current) > 0 ? next : current;
}

function isEnvelopeShaped(
	value: unknown,
): value is Omit<PluginUiStateEnvelope, "state"> & { state: unknown } {
	if (typeof value !== "object" || value === null) return false;
	const envelope = value as Record<string, unknown>;
	return (
		typeof envelope.sessionId === "string" &&
		envelope.sessionId.length > 0 &&
		isPluginUiSlot(envelope.slot) &&
		typeof envelope.plugin === "string" &&
		typeof envelope.epoch === "number" &&
		Number.isFinite(envelope.epoch) &&
		Number.isSafeInteger(envelope.seq) &&
		(envelope.seq as number) >= 0 &&
		(envelope.state === null || typeof envelope.state === "object")
	);
}

/** Structural check plus lenient re-normalization of `state`. Renderers use this on every inbound envelope. */
export function readPluginUiEnvelope(
	value: unknown,
): PluginUiStateEnvelope | undefined {
	if (!isEnvelopeShaped(value)) return undefined;
	const normalized = normalizePluginUiState(value.slot, value.state);
	if (!normalized.ok) return undefined;
	return {
		sessionId: value.sessionId,
		slot: value.slot,
		plugin: value.plugin,
		epoch: value.epoch,
		seq: value.seq,
		state: normalized.state,
	};
}

/** Deep equality with a plain JSON value: an extra key, a `toJSON` or a non-plain value differs. */
function equalsJson(value: unknown, json: unknown): boolean {
	if (typeof json !== "object" || json === null) return value === json;
	if (typeof value !== "object" || value === null) return false;
	if (Array.isArray(json))
		return (
			Array.isArray(value) &&
			value.length === json.length &&
			json.every((entry, index) => equalsJson(value[index], entry))
		);
	if (Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(json);
	return (
		Object.keys(record).length === keys.length &&
		keys.every(
			(key) =>
				Object.hasOwn(record, key) &&
				equalsJson(record[key], (json as Record<string, unknown>)[key]),
		)
	);
}

/**
 * The envelope's own fields are well formed and its state is already
 * normalized, so narrowing never skips the sanitizers. A state that would
 * still change when normalized fails; read those with `readPluginUiEnvelope`.
 */
export function isPluginUiStateEnvelope(
	value: unknown,
): value is PluginUiStateEnvelope {
	if (!isEnvelopeShaped(value)) return false;
	const normalized = normalizePluginUiState(value.slot, value.state);
	return normalized.ok && equalsJson(value.state, normalized.state);
}
