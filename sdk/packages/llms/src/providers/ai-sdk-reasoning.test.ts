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

function bedrockContext(
	modelId: string,
	reasoningOptions: readonly ModelReasoningOption[] | undefined,
): GatewayProviderContext {
	return {
		provider: {
			id: "bedrock",
			name: "Amazon Bedrock",
			defaultModelId: modelId,
			models: [],
		},
		model: {
			id: modelId,
			name: modelId,
			providerId: "bedrock",
			reasoningOptions,
		},
		config: { providerId: "bedrock" },
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
		expect(resolvePortableReasoning(request(reasoning))).toBe(expected);
	});

	it("leaves an exact token budget to provider-specific options", () => {
		expect(
			resolvePortableReasoning(
				request({ enabled: true, effort: "high", budgetTokens: 12_000 }),
			),
		).toBeUndefined();
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

	it("omits reasoning when the caller has no explicit intent", () => {
		expect(resolvePortableReasoning(request())).toBeUndefined();
		expect(resolvePortableReasoning(request({}))).toBeUndefined();
	});

	it("adds portable reasoning to supported provider stream settings", () => {
		expect(
			buildAiSdkStreamConfig(request({ effort: "high" }), undefined as never),
		).toMatchObject({ reasoning: "high" });
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
			const context = bedrockContext(req.modelId, EFFORT_OPTIONS);
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
			const context = bedrockContext(req.modelId, undefined);
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
				resolvePortableReasoning(req, bedrockContext(req.modelId, [])),
			).toBeUndefined();
		});

		it("withholds portable reasoning from OpenAI models, prefixed or not", () => {
			for (const modelId of [
				"openai.gpt-6-astra",
				"us.openai.gpt-6-astra",
				"global.openai.gpt-5.6-luna",
			]) {
				const req = bedrock(modelId, { effort: "high" });
				expect(
					resolvePortableReasoning(
						req,
						bedrockContext(modelId, EFFORT_OPTIONS),
					),
				).toBeUndefined();
			}
		});

		it("falls back to provider-id gating when no context is available", () => {
			expect(
				resolvePortableReasoning(
					bedrock("openai.gpt-6-astra", { effort: "high" }),
				),
			).toBe("high");
		});
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
