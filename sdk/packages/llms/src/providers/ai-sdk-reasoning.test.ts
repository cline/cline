import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildAiSdkStreamConfig } from "./ai-sdk";
import {
	resolvePortableReasoning,
	withoutPortableReasoning,
} from "./routing/portable-reasoning";
import { normalizeReasoningRequest } from "./routing/reasoning-options";

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

function bedrockRequest(
	reasoning?: GatewayStreamRequest["reasoning"],
	modelId = "openai.gpt-oss-120b-1:0",
): GatewayStreamRequest {
	return {
		providerId: "bedrock",
		modelId,
		messages: [],
		reasoning,
	};
}

function bedrockContext(
	overrides: Partial<GatewayProviderContext["model"]> = {},
): GatewayProviderContext {
	return {
		provider: {
			id: "bedrock",
			name: "AWS Bedrock",
			defaultModelId: "openai.gpt-oss-120b-1:0",
			models: [],
		},
		model: {
			id: "openai.gpt-oss-120b-1:0",
			name: "gpt-oss-120b",
			providerId: "bedrock",
			capabilities: ["reasoning"],
			reasoningOptions: [
				{ type: "effort", values: ["low", "medium", "high"] },
			],
			...overrides,
		},
	} as unknown as GatewayProviderContext;
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

	it("uses Ollama's top-level reasoning support", () => {
		const ollamaRequest = {
			...request({ effort: "high" }),
			providerId: "ollama",
		};
		expect(
			buildAiSdkStreamConfig(ollamaRequest, undefined as never),
		).toHaveProperty("reasoning", "high");
	});

	it("suppresses Bedrock portable reasoning for models without reasoning support", () => {
		const nonReasoning = bedrockContext({
			id: "meta.llama3-3-70b-instruct-v1:0",
			capabilities: ["tools", "temperature"],
			reasoningOptions: undefined,
		});
		expect(
			resolvePortableReasoning(
				bedrockRequest({ effort: "medium" }, "meta.llama3-3-70b-instruct-v1:0"),
				nonReasoning,
			),
		).toBeUndefined();
		expect(
			resolvePortableReasoning(
				bedrockRequest({ enabled: true }, "meta.llama3-3-70b-instruct-v1:0"),
				nonReasoning,
			),
		).toBeUndefined();
		expect(
			buildAiSdkStreamConfig(
				bedrockRequest({ effort: "medium" }, "meta.llama3-3-70b-instruct-v1:0"),
				nonReasoning,
			),
		).not.toHaveProperty("reasoning");
	});

	it("clamps Bedrock GPT-OSS effort to advertised low/medium/high", () => {
		const context = bedrockContext();
		expect(
			resolvePortableReasoning(bedrockRequest({ effort: "xhigh" }), context),
		).toBe("high");
		expect(
			resolvePortableReasoning(bedrockRequest({ effort: "max" }), context),
		).toBe("high");
		expect(
			resolvePortableReasoning(bedrockRequest({ effort: "medium" }), context),
		).toBe("medium");
	});

	it("keeps Bedrock portable reasoning for unknown custom models (fail open)", () => {
		const unknown = bedrockContext({
			id: "custom-astra-model",
			capabilities: undefined,
			reasoningOptions: undefined,
		});
		expect(
			resolvePortableReasoning(
				bedrockRequest({ effort: "medium" }, "custom-astra-model"),
				unknown,
			),
		).toBe("medium");
	});

	it("leaves Bedrock reasoning in place for normalize to strip on non-reasoning models", () => {
		const nonReasoning = bedrockContext({
			id: "amazon.nova-pro-v1:0",
			capabilities: ["images", "tools", "temperature"],
			reasoningOptions: undefined,
		});
		// Portable is suppressed, so the intent stays for the normalized
		// provider-options path — which must then strip it.
		const kept = withoutPortableReasoning(
			bedrockRequest({ effort: "medium" }, "amazon.nova-pro-v1:0"),
			nonReasoning,
		);
		expect(kept.reasoning).toBeDefined();
		const normalized = normalizeReasoningRequest(kept, nonReasoning);
		expect(normalized.reasoning).toBeUndefined();
	});
});
