import type { GatewayStreamRequest } from "@cline/shared";
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
});
