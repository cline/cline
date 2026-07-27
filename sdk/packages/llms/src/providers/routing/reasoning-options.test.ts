import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { normalizeReasoningRequest } from "./reasoning-options";

function makeRequest(
	reasoning: GatewayStreamRequest["reasoning"],
): GatewayStreamRequest {
	return {
		providerId: "test",
		modelId: "test-model",
		messages: [],
		maxTokens: 10_000,
		reasoning,
	};
}

function makeContext(
	reasoningOptions: readonly ModelReasoningOption[] | undefined,
): GatewayProviderContext {
	return {
		provider: {
			id: "test",
			name: "Test",
			defaultModelId: "test-model",
			models: [],
		},
		model: {
			id: "test-model",
			name: "Test model",
			providerId: "test",
			maxOutputTokens: 10_000,
			reasoningOptions,
		},
		config: { providerId: "test" },
	};
}

describe("normalizeReasoningRequest", () => {
	it("omits controls for an explicitly empty models.dev option list", () => {
		expect(
			normalizeReasoningRequest(
				makeRequest({ enabled: true, effort: "max" }),
				makeContext([]),
			).reasoning,
		).toBeUndefined();
	});

	it("maps effort to the nearest advertised value, preferring higher on ties", () => {
		const context = makeContext([{ type: "effort", values: ["low", "high"] }]);
		expect(
			normalizeReasoningRequest(makeRequest({ effort: "medium" }), context)
				.reasoning,
		).toEqual({ enabled: undefined, effort: "high", budgetTokens: undefined });
	});

	it("emits only enabled state for toggle-only models", () => {
		expect(
			normalizeReasoningRequest(
				makeRequest({ effort: "max" }),
				makeContext([{ type: "toggle" }]),
			).reasoning,
		).toEqual({ enabled: true });
	});

	it("preserves an enabled request for a provider-default effort control", () => {
		expect(
			normalizeReasoningRequest(
				makeRequest({ enabled: true }),
				makeContext([{ type: "effort", values: ["none", "default"] }]),
			).reasoning,
		).toEqual({ enabled: true });
	});

	it("derives and clamps a budget for budget-controlled models", () => {
		const context = makeContext([
			{ type: "budget_tokens", min: 512, max: 4096 },
		]);
		expect(
			normalizeReasoningRequest(makeRequest({ effort: "high" }), context)
				.reasoning,
		).toEqual({ enabled: true, budgetTokens: 4096 });
		expect(
			normalizeReasoningRequest(makeRequest({ budgetTokens: 128 }), context)
				.reasoning,
		).toEqual({ enabled: true, budgetTokens: 512 });
	});

	it("does not invent an off control when models.dev does not advertise one", () => {
		expect(
			normalizeReasoningRequest(
				makeRequest({ enabled: false }),
				makeContext([{ type: "effort", values: ["low", "high"] }]),
			).reasoning,
		).toBeUndefined();
	});

	it("uses conservative effort values for custom models without metadata", () => {
		expect(
			normalizeReasoningRequest(
				makeRequest({ effort: "max" }),
				makeContext(undefined),
			).reasoning?.effort,
		).toBe("high");
	});
});
