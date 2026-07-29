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
