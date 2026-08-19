import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { normalizeReasoningRequest } from "./reasoning-options";

function makeRequest(
	reasoning: GatewayStreamRequest["reasoning"],
	overrides: Partial<GatewayStreamRequest> = {},
): GatewayStreamRequest {
	return {
		providerId: "test",
		modelId: "test-model",
		messages: [],
		maxTokens: 10_000,
		reasoning,
		...overrides,
	};
}

function makeContext(
	reasoningOptions: readonly ModelReasoningOption[] | undefined,
	options?: {
		modelId?: string;
		metadata?: GatewayProviderContext["provider"]["metadata"];
	},
): GatewayProviderContext {
	const modelId = options?.modelId ?? "test-model";
	return {
		provider: {
			id: "test",
			name: "Test",
			defaultModelId: modelId,
			models: [],
			metadata: options?.metadata,
		},
		model: {
			id: modelId,
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

	it("selects the nearest advertised effort when enabled is the only input", () => {
		expect(
			normalizeReasoningRequest(
				makeRequest({ enabled: true }),
				makeContext([{ type: "effort", values: ["high"] }]),
			).reasoning,
		).toEqual({
			enabled: undefined,
			effort: "high",
			budgetTokens: undefined,
		});
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

	it("reserves output headroom only when the model matches an Anthropic reasoning route", () => {
		const metadata: GatewayProviderContext["provider"]["metadata"] = {
			routing: {
				reasoning: {
					format: "anthropic-thinking",
					routes: [{ matcher: "anthropic-compatible" }],
				},
			},
		};
		const options: ModelReasoningOption[] = [
			{ type: "budget_tokens", min: 128, max: 32_768 },
		];

		expect(
			normalizeReasoningRequest(
				makeRequest(
					{ budgetTokens: 128 },
					{ modelId: "gemini-2.5-pro", maxTokens: 64 },
				),
				makeContext(options, { modelId: "gemini-2.5-pro", metadata }),
			).reasoning,
		).toEqual({ enabled: true, budgetTokens: 128 });

		expect(
			normalizeReasoningRequest(
				makeRequest(
					{ budgetTokens: 4096 },
					{ modelId: "claude-sonnet-4-5", maxTokens: 2048 },
				),
				makeContext(options, {
					modelId: "claude-sonnet-4-5",
					metadata,
				}),
			).reasoning,
		).toEqual({ enabled: true, budgetTokens: 2047 });
	});

	it("does not invent an off control when models.dev does not advertise one", () => {
		expect(
			normalizeReasoningRequest(
				makeRequest({ enabled: false }),
				makeContext([{ type: "effort", values: ["low", "high"] }]),
			).reasoning,
		).toBeUndefined();
	});

	it("ignores Cline Fable's advertised off control because backend reasoning is mandatory", () => {
		const controls: ModelReasoningOption[] = [
			{ type: "toggle" },
			{ type: "effort", values: ["low", "medium", "high", "xhigh"] },
		];
		const context = makeContext(controls, {
			modelId: "anthropic/claude-fable-5",
		});

		expect(
			normalizeReasoningRequest(
				makeRequest(
					{ enabled: false },
					{
						providerId: "cline",
						modelId: "anthropic/claude-fable-5",
					},
				),
				context,
			).reasoning,
		).toBeUndefined();
		expect(
			normalizeReasoningRequest(
				makeRequest(
					{ enabled: false },
					{
						providerId: "vercel-ai-gateway",
						modelId: "anthropic/claude-fable-5",
					},
				),
				context,
			).reasoning,
		).toEqual({ enabled: false });
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
