import { createAnthropic } from "@ai-sdk/anthropic";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

/**
 * Beta header required for computer-use-2025-01-24 tools (opaque tool type
 * `computer_20250124`). The Anthropic Messages API rejects these tools unless
 * the request carries `anthropic-beta: computer-use-2025-01-24`.
 */
export const ANTHROPIC_COMPUTER_USE_BETA_2025 = "computer-use-2025-01-24";
/** Beta header for the original computer-use-2024-10-22 tools (`computer_20241022`). */
export const ANTHROPIC_COMPUTER_USE_BETA_2024 = "computer-use-2024-10-22";

/**
 * PROTOTYPE HACK (maestro / computer-use branch — NOT for main):
 *
 * The AI SDK provider layer does not model Anthropic's computer-use beta. The
 * clean fix (routing computer_20250124 tools through a beta-aware request path)
 * is a multi-day provider change. For the maestro end-to-end demo we instead
 * unconditionally attach the computer-use beta header to every Anthropic
 * request. `createAnthropic({ headers })` spreads these into the default
 * headers sent on every call, so this is sufficient to make the real
 * `computer_20250124` tool type accepted.
 *
 * Multiple beta values are comma-joined per the Anthropic header convention,
 * and any caller-supplied `anthropic-beta` value is preserved.
 */
export function withComputerUseBetaHeader(
	headers: Record<string, string> | undefined,
	beta: string = ANTHROPIC_COMPUTER_USE_BETA_2025,
): Record<string, string> {
	const merged: Record<string, string> = { ...(headers ?? {}) };
	// Header names are case-insensitive on the wire, but our config map is a
	// plain object; find an existing entry case-insensitively to avoid dupes.
	const existingKey = Object.keys(merged).find(
		(k) => k.toLowerCase() === "anthropic-beta",
	);
	const existing = existingKey ? merged[existingKey] : undefined;
	const values = new Set(
		(existing ?? "")
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean),
	);
	values.add(beta);
	if (existingKey && existingKey !== "anthropic-beta") {
		delete merged[existingKey];
	}
	merged["anthropic-beta"] = [...values].join(",");
	return merged;
}

export async function createAnthropicProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const provider = createAnthropic({
		apiKey,
		baseURL: config.baseUrl,
		// PROTOTYPE HACK: always send the computer-use beta header so the real
		// `computer_20250124` tool type is accepted. See withComputerUseBetaHeader.
		headers: withComputerUseBetaHeader(config.headers),
		fetch: config.fetch,
		name: context.provider.id,
	});
	return {
		model: (modelId) => provider(modelId),
	};
}

