/**
 * Catalog invariants that protect against silent drift in the generated
 * `models.dev` snapshot and the handwritten overrides layered on top of it.
 *
 * Both failure modes these cover are invisible at build time and only surface
 * as provider-side 400s or a wrong default model in front of users.
 */

import type { GatewayProviderContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { BUILTIN_SPECS } from "./builtins";
import { resolveClaudeThinkingEra } from "./model-facts";
import { getModelsForProvider } from "./model-registry";
import { GENERATED_PROVIDER_SPECS } from "./providers.generated";
import { resolveAnthropicReasoningRequestPolicy } from "./routing/anthropic-compatible";

function makeAnthropicContext(
	modelId: string,
	model: { name?: string; reasoningOptions?: unknown; family?: string },
): GatewayProviderContext {
	return {
		provider: {
			id: "anthropic",
			name: "Anthropic",
			defaultModelId: modelId,
			models: [],
			metadata: {
				routing: {
					reasoning: {
						format: "anthropic-thinking",
						routes: [{ matcher: "anthropic-compatible" }],
					},
				},
			},
		},
		model: {
			id: modelId,
			name: model.name,
			providerId: "anthropic",
			reasoningOptions: model.reasoningOptions,
			metadata: model.family ? { family: model.family } : undefined,
		},
		config: { providerId: "anthropic" },
	} as unknown as GatewayProviderContext;
}

describe("generated catalog reasoning invariants", () => {
	// `builtins.test.ts` spot-checks a hardcoded list of adaptive-era ids. This
	// sweeps the whole catalog instead, so a newly generated Claude model that
	// arrives without effort options fails here rather than in production,
	// where it would be sent the manual `thinking.type: "enabled"` shape and
	// rejected by the Anthropic API.
	it("gives every adaptive-era Claude model an effort reasoning option", async () => {
		const models = await getModelsForProvider("anthropic");
		const adaptiveEraIds = Object.keys(models).filter(
			(modelId) => resolveClaudeThinkingEra(modelId) === "adaptive",
		);

		expect(adaptiveEraIds.length).toBeGreaterThan(0);

		const missingEffort = adaptiveEraIds.filter(
			(modelId) =>
				!models[modelId]?.reasoningOptions?.some(
					(option) => option.type === "effort",
				),
		);

		expect(missingEffort).toEqual([]);
	});

	it("routes every adaptive-era Claude model to adaptive thinking", async () => {
		const models = await getModelsForProvider("anthropic");
		const adaptiveEraIds = Object.keys(models).filter(
			(modelId) => resolveClaudeThinkingEra(modelId) === "adaptive",
		);

		const manualThinking = adaptiveEraIds.filter((modelId) => {
			const policy = resolveAnthropicReasoningRequestPolicy(
				{
					providerId: "anthropic",
					modelId,
					messages: [],
					reasoning: { enabled: true },
				},
				makeAnthropicContext(modelId, models[modelId] ?? {}),
			);
			return policy.kind !== "anthropic-adaptive";
		});

		expect(manualThinking).toEqual([]);
	});
});

describe("builtin overrides do not shadow generated defaults", () => {
	// #11218 removed a stale handwritten MiniMax default so the generated
	// models.dev value wins. Re-adding a `defaultModelId` override here would
	// silently pin users to an outdated model again.
	it("keeps the generated MiniMax default model", () => {
		const generated = GENERATED_PROVIDER_SPECS.find(
			(spec) => spec.id === "minimax",
		);
		const merged = BUILTIN_SPECS.find((spec) => spec.id === "minimax");

		expect(generated?.defaultModelId).toBeDefined();
		expect(merged?.defaultModelId).toBe(generated?.defaultModelId);
	});

	it("still applies the handwritten MiniMax regional API lines", () => {
		const merged = BUILTIN_SPECS.find((spec) => spec.id === "minimax");
		expect(merged?.apiLineBaseUrls).toMatchObject({
			china: expect.stringContaining("minimaxi.com"),
			international: expect.stringContaining("minimax.io"),
		});
	});
});
