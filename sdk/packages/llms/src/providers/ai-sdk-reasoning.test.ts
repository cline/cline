import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildAiSdkStreamConfig } from "./ai-sdk";
import {
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

/**
 * A provider context is required by the reasoning gate, so every call needs
 * one. `reasoningOptions` is the only field the gate reads: `undefined` stands
 * for a model the catalog does not describe, `[]` for one that advertises no
 * user-facing control.
 */
function contextFor(
	request: GatewayStreamRequest,
	reasoningOptions: readonly ModelReasoningOption[] | null = EFFORT_OPTIONS,
): GatewayProviderContext {
	return {
		provider: {
			id: request.providerId,
			name: request.providerId,
			defaultModelId: request.modelId,
			models: [],
		},
		model: {
			id: request.modelId,
			name: request.modelId,
			providerId: request.providerId,
			reasoningOptions: reasoningOptions ?? undefined,
		},
		config: { providerId: request.providerId },
	};
}

const EFFORT_OPTIONS: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high"] },
];

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
		const req = request(reasoning);
		expect(resolvePortableReasoning(req, contextFor(req))).toBe(expected);
	});

	it("leaves an exact token budget to provider-specific options", () => {
		const req = request({
			enabled: true,
			effort: "high",
			budgetTokens: 12_000,
		});
		expect(resolvePortableReasoning(req, contextFor(req))).toBeUndefined();
	});

	it("gives explicit disable precedence over an exact token budget", () => {
		const req = request({ enabled: false, budgetTokens: 12_000 });
		expect(resolvePortableReasoning(req, contextFor(req))).toBe("none");
	});

	it("removes conflicting controls from native disable requests", () => {
		const req: GatewayStreamRequest = {
			...request({ enabled: false, effort: "high", budgetTokens: 12_000 }),
			providerId: "custom-provider",
		};
		expect(withoutPortableReasoning(req, contextFor(req)).reasoning).toEqual({
			enabled: false,
		});
	});

	it("omits reasoning when the caller has no explicit intent", () => {
		for (const req of [request(), request({})]) {
			expect(resolvePortableReasoning(req, contextFor(req))).toBeUndefined();
		}
	});

	it("adds portable reasoning to supported provider stream settings", () => {
		const req = request({ effort: "high" });
		expect(buildAiSdkStreamConfig(req, contextFor(req))).toMatchObject({
			reasoning: "high",
		});
	});

	// Bedrock's adapter turns the portable effort into `reasoningConfig` for
	// every model it does not recognise; Bedrock rejects that field for models
	// without reasoning support and for OpenAI models routed through inference
	// profiles (cline/cline#14095).
	describe("on Bedrock", () => {
		const bedrock = (
			modelId: string,
			reasoning: GatewayStreamRequest["reasoning"],
		): GatewayStreamRequest => ({
			...request(reasoning),
			providerId: "bedrock",
			modelId,
		});

		it("keeps portable reasoning for catalog models with advertised controls", () => {
			const req = bedrock("anthropic.claude-sonnet-4-6", { effort: "high" });
			const context = contextFor(req);
			expect(resolvePortableReasoning(req, context)).toBe("high");
			expect(buildAiSdkStreamConfig(req, context)).toMatchObject({
				reasoning: "high",
			});
			expect(withoutPortableReasoning(req, context).reasoning).toBeUndefined();
		});

		it("withholds portable reasoning from unlisted ids such as inference-profile ARNs", () => {
			const req = bedrock(
				"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123",
				{ effort: "medium" },
			);
			const context = contextFor(req, null);
			expect(resolvePortableReasoning(req, context)).toBeUndefined();
			expect(buildAiSdkStreamConfig(req, context)).not.toHaveProperty(
				"reasoning",
			);
			// The intent stays on the request so provider-option routing can
			// decide what (if anything) to send.
			expect(withoutPortableReasoning(req, context).reasoning).toEqual({
				effort: "medium",
			});
		});

		it("withholds portable reasoning from models that advertise no controls", () => {
			const req = bedrock("amazon.nova-2-lite-v1:0", { enabled: true });
			expect(
				resolvePortableReasoning(req, contextFor(req, [])),
			).toBeUndefined();
		});

		it("keeps portable reasoning for OpenAI catalog models, prefixed or not", () => {
			// @ai-sdk/amazon-bedrock 5.0.65+ recognises inference-profile prefixed
			// OpenAI ids and emits `reasoning.effort` for them (cline/cline#14451).
			for (const modelId of [
				"openai.gpt-6-astra",
				"us.openai.gpt-6-astra",
				"global.openai.gpt-5.6-luna",
			]) {
				const req = bedrock(modelId, { effort: "high" });
				expect(resolvePortableReasoning(req, contextFor(req))).toBe("high");
			}
		});
	});

	it("uses Ollama's top-level reasoning support", () => {
		const ollamaRequest: GatewayStreamRequest = {
			...request({ effort: "high" }),
			providerId: "ollama",
		};
		expect(
			buildAiSdkStreamConfig(ollamaRequest, contextFor(ollamaRequest)),
		).toHaveProperty("reasoning", "high");
	});
});
