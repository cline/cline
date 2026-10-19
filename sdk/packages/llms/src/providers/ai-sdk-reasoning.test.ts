import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildAiSdkStreamConfig } from "./ai-sdk";
import {
	reconcilePortableReasoning,
	resolvePortableReasoning,
	withoutPortableReasoning,
} from "./routing/portable-reasoning";

function request(
	reasoning?: GatewayStreamRequest["reasoning"],
): GatewayStreamRequest {
	return {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		messages: [],
		reasoning,
	};
}

describe("resolvePortableReasoning", () => {
	it.each([
		[{ enabled: false }, "none"],
		[{ effort: "minimal" }, "minimal"],
		[{ effort: "low" }, "low"],
		[{ effort: "medium" }, "medium"],
		[{ effort: "high" }, "high"],
		[{ effort: "xhigh" }, "xhigh"],
		[{ effort: "max" }, "xhigh"],
		[{ enabled: true }, "medium"],
	] as const)("maps %o to %s", (reasoning, expected) => {
		expect(resolvePortableReasoning(request(reasoning))).toBe(expected);
	});

	it("keeps the effort beside an exact budget for providers that cannot take one", () => {
		expect(
			resolvePortableReasoning(
				request({ enabled: true, effort: "high", budgetTokens: 12_000 }),
			),
		).toBe("high");
	});

	it("leaves an exact budget in the request for provider rules", () => {
		const budget = request({
			enabled: true,
			effort: "high",
			budgetTokens: 12_000,
		});
		expect(withoutPortableReasoning(budget).reasoning).toEqual(
			budget.reasoning,
		);
	});

	it("gives explicit disable precedence over an exact token budget", () => {
		expect(
			resolvePortableReasoning(
				request({ enabled: false, budgetTokens: 12_000 }),
			),
		).toBe("none");
	});

	it("removes conflicting controls from native disable requests", () => {
		const normalized = withoutPortableReasoning({
			...request({ enabled: false, effort: "high", budgetTokens: 12_000 }),
			providerId: "custom-provider",
		});
		expect(normalized.reasoning).toEqual({ enabled: false });
	});

	it("disables reasoning on providers without a native toggle", () => {
		expect(
			resolvePortableReasoning({
				...request({ enabled: false }),
				providerId: "custom-provider",
			}),
		).toBe("none");
	});

	it("leaves a disable alone for providers that own reasoning natively", () => {
		expect(
			resolvePortableReasoning({
				...request({ enabled: false }),
				providerId: "mistral",
			}),
		).toBeUndefined();
	});

	it("skips the disable for a model known not to reason", () => {
		const context = {
			model: { id: "llama", capabilities: ["text"] },
		} as unknown as GatewayProviderContext;
		expect(
			resolvePortableReasoning(
				{ ...request({ enabled: false }), providerId: "custom-provider" },
				{ context },
			),
		).toBeUndefined();
	});

	it("keeps a disable for native provider rules", () => {
		const disable = { ...request({ enabled: false }), providerId: "zai" };
		expect(withoutPortableReasoning(disable).reasoning).toEqual({
			enabled: false,
		});
	});

	it("defers to a native provider control", () => {
		expect(
			reconcilePortableReasoning("none", {
				zai: { thinking: { type: "disabled" } },
			}),
		).toBeUndefined();
		expect(
			reconcilePortableReasoning("none", {
				"custom-provider": { strictJsonSchema: false },
			}),
		).toBe("none");
		expect(
			reconcilePortableReasoning("high", {
				google: { thinkingConfig: { thinkingBudget: 4096 } },
			}),
		).toBeUndefined();
		expect(
			reconcilePortableReasoning("high", {
				"custom-provider": { strictJsonSchema: false },
			}),
		).toBe("high");
	});

	it("omits reasoning when the caller has no explicit intent", () => {
		expect(resolvePortableReasoning(request())).toBeUndefined();
		expect(resolvePortableReasoning(request({}))).toBeUndefined();
	});

	it("adds portable reasoning to supported provider stream settings", () => {
		expect(
			buildAiSdkStreamConfig(request({ effort: "high" }), undefined as never),
		).toMatchObject({ reasoning: "high" });
	});

	it("uses Ollama's top-level reasoning support", () => {
		const ollamaRequest = {
			...request({ effort: "high" }),
			providerId: "ollama",
		};
		expect(
			buildAiSdkStreamConfig(ollamaRequest, undefined as never),
		).toHaveProperty("reasoning", "high");
	});
});

function wire(
	adapter: "cline" | "openai-compatible" | "anthropic",
	reasoningOptions: readonly ModelReasoningOption[] | undefined,
) {
	return {
		adapter,
		context: {
			model: { id: "test-model", name: "Test", reasoningOptions },
		} as unknown as GatewayProviderContext,
	};
}

describe("resolvePortableReasoning against an advertised effort ladder", () => {
	const kimiK3: ModelReasoningOption[] = [
		{ type: "effort", values: ["low", "high", "max"] },
	];
	const throughXhigh: ModelReasoningOption[] = [
		{ type: "effort", values: ["low", "medium", "high", "xhigh"] },
	];

	it.each([
		[{ effort: "minimal" }, "low"],
		[{ effort: "medium" }, "high"],
		[{ effort: "high" }, "high"],
		[{ enabled: true }, "high"],
		// The nearest advertised level is max, which the portable setting
		// cannot carry, so the requested level is kept instead of lowered.
		[{ effort: "xhigh" }, "xhigh"],
		[{ effort: "max" }, "xhigh"],
	] as const)("snaps %o to %s for a verbatim adapter", (reasoning, expected) => {
		expect(
			resolvePortableReasoning(
				{ ...request(reasoning), providerId: "custom-provider" },
				wire("openai-compatible", kimiK3),
			),
		).toBe(expected);
	});

	it("snaps for the Cline gateway adapter too", () => {
		expect(
			resolvePortableReasoning(
				{ ...request({ effort: "minimal" }), providerId: "cline" },
				wire("cline", throughXhigh),
			),
		).toBe("low");
	});

	it("leaves the level to adapters that map effort per model themselves", () => {
		expect(
			resolvePortableReasoning(
				request({ effort: "medium" }),
				wire("anthropic", [{ type: "effort", values: ["low", "high"] }]),
			),
		).toBe("medium");
	});

	it.each([
		["no catalog facts", undefined],
		["a toggle-only control", [{ type: "toggle" }]],
		["an explicitly empty control list", []],
	] as const)("keeps the requested level for a model with %s", (_label, options) => {
		expect(
			resolvePortableReasoning(
				{ ...request({ effort: "medium" }), providerId: "custom-provider" },
				wire("openai-compatible", options),
			),
		).toBe("medium");
	});

	it("sends no disable to a model whose catalog has no off option", () => {
		expect(
			resolvePortableReasoning(
				request({ enabled: false }),
				wire("openai-compatible", kimiK3),
			),
		).toBeUndefined();
	});
});
