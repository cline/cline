/**
 * Shared helpers for the per-provider live model-list normalizers
 * (`catalog-live-*.ts`). These normalize raw `/models` payloads from
 * provider APIs into the SDK's `ModelInfo` shape so hosts (VS Code, CLI,
 * desktop) resolve one consistent catalog instead of maintaining their
 * own fetch/parse pipelines.
 */

import type { ModelInfo } from "./types";

/**
 * Placeholder thinking budget attached to live models that advertise
 * reasoning support but do not report a budget. Signals "thinking is
 * configurable" to hosts without asserting a provider-specific limit.
 */
export const LIVE_REASONING_PLACEHOLDER_THINKING_BUDGET = 6_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a per-token price (string or number, as provider APIs report it)
 * into the catalog's per-million-tokens price. Returns `undefined` for
 * missing or unparsable values so callers can distinguish "not priced"
 * from "free".
 */
export function parsePerTokenPrice(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value * 1_000_000 : undefined;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
	}
	return undefined;
}

export function includeCapability(
	capabilities: NonNullable<ModelInfo["capabilities"]>,
	capability: NonNullable<ModelInfo["capabilities"]>[number],
	when: boolean,
): void {
	if (when && !capabilities.includes(capability)) {
		capabilities.push(capability);
	}
}

function mergeDefinedObject<T extends Record<string, unknown>>(
	base: T | undefined,
	overlay: T | undefined,
): T | undefined {
	if (!base && !overlay) {
		return undefined;
	}
	const result = { ...(base ?? {}) } as T;
	for (const [key, value] of Object.entries(overlay ?? {})) {
		if (value !== undefined) {
			Object.assign(result, { [key]: value });
		}
	}
	return result;
}

/**
 * Layer live provider metadata onto a curated model without erasing facts the
 * live endpoint omitted. Provider `/models` responses are often sparse (for
 * example, OpenRouter currently omits max output limits on some models), so a
 * whole-record spread would regress bundled capabilities and limits.
 *
 * Live defined scalars win, capabilities are unioned, and nested pricing /
 * thinking / metadata bags merge by defined key. Explicit zero values are
 * preserved.
 */
export function enrichModelInfo(
	curated: ModelInfo | undefined,
	live: ModelInfo,
): ModelInfo {
	if (!curated) {
		return live;
	}

	const result = { ...curated };
	for (const [key, value] of Object.entries(live)) {
		if (value !== undefined) {
			Object.assign(result, { [key]: value });
		}
	}

	const capabilities = [
		...(curated.capabilities ?? []),
		...(live.capabilities ?? []),
	];
	if (capabilities.length > 0) {
		result.capabilities = [...new Set(capabilities)];
	}
	result.pricing = mergeDefinedObject(curated.pricing, live.pricing);
	result.thinkingConfig = mergeDefinedObject(
		curated.thinkingConfig,
		live.thinkingConfig,
	);
	result.metadata = mergeDefinedObject(curated.metadata, live.metadata);
	return result;
}

/**
 * Extract the model list from an OpenAI-style `{ data: [...] }` payload
 * (the shape all supported provider `/models` endpoints use). Returns an
 * empty list for malformed payloads so a bad response degrades to "no
 * live models" instead of throwing away the bundled catalog.
 */
export function readModelListPayload(
	payload: unknown,
): Record<string, unknown>[] {
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		return [];
	}
	return payload.data.filter(isRecord);
}

export function readModelId(rawModel: Record<string, unknown>): string {
	return typeof rawModel.id === "string" ? rawModel.id.trim() : "";
}
