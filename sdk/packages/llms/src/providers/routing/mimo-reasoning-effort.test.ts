import type { GatewayProviderContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	MIMO_REASONING_EFFORT_ROUTING_METADATA,
	mapMimoReasoningEffortInRequestBody,
	toMimoReasoningEffortWireValue,
} from "./mimo-reasoning-effort";

function makeContext(options?: {
	providerId?: string;
	family?: string;
	metadata?: GatewayProviderContext["provider"]["metadata"];
}): GatewayProviderContext {
	const providerId = options?.providerId ?? "xiaomi";
	const modelId = "mimo-v2.6-pro";
	const modelMetadata = options?.family
		? { family: options.family }
		: undefined;
	return {
		provider: {
			id: providerId,
			name: providerId,
			defaultModelId: modelId,
			models: [
				{ id: modelId, name: modelId, providerId, capabilities: ["text"] },
			],
			metadata: options?.metadata,
		},
		model: {
			id: modelId,
			name: modelId,
			providerId,
			metadata: modelMetadata,
		},
		config: { providerId },
	};
}

describe("toMimoReasoningEffortWireValue", () => {
	it("maps portable reasoning levels onto MiMo thinking strengths", () => {
		expect(toMimoReasoningEffortWireValue("minimal")).toBe("low");
		expect(toMimoReasoningEffortWireValue("low")).toBe("low");
		expect(toMimoReasoningEffortWireValue("medium")).toBe("medium");
		expect(toMimoReasoningEffortWireValue("high")).toBe("high");
		expect(toMimoReasoningEffortWireValue("xhigh")).toBe("extra");
		expect(toMimoReasoningEffortWireValue("max")).toBe("extra");
	});

	it("passes unknown values through unchanged", () => {
		expect(toMimoReasoningEffortWireValue("none")).toBe("none");
		expect(toMimoReasoningEffortWireValue("extra")).toBe("extra");
		expect(toMimoReasoningEffortWireValue("turbo")).toBe("turbo");
		expect(toMimoReasoningEffortWireValue("")).toBe("");
	});
});

describe("mapMimoReasoningEffortInRequestBody", () => {
	const mimoContext = makeContext({
		metadata: MIMO_REASONING_EFFORT_ROUTING_METADATA,
		family: "mimo",
	});

	it("rewrites the top portable levels to MiMo's extra strength", () => {
		expect(
			mapMimoReasoningEffortInRequestBody(
				{ model: "mimo-v2.6-pro", reasoning_effort: "xhigh" },
				mimoContext,
			),
		).toEqual({ model: "mimo-v2.6-pro", reasoning_effort: "extra" });
		expect(
			mapMimoReasoningEffortInRequestBody(
				{ model: "mimo-v2.6-pro", reasoning_effort: "max" },
				mimoContext,
			),
		).toEqual({ model: "mimo-v2.6-pro", reasoning_effort: "extra" });
	});

	it("drops minimal to the lightest MiMo strength", () => {
		expect(
			mapMimoReasoningEffortInRequestBody(
				{ model: "mimo-v2.6-pro", reasoning_effort: "minimal" },
				mimoContext,
			),
		).toEqual({ model: "mimo-v2.6-pro", reasoning_effort: "low" });
	});

	it("keeps shared levels and unknown values on the same body", () => {
		for (const effort of ["low", "medium", "high", "extra", "turbo"]) {
			const body = { model: "mimo-v2.6-pro", reasoning_effort: effort };
			expect(mapMimoReasoningEffortInRequestBody(body, mimoContext)).toBe(body);
		}
	});

	it("leaves bodies without a string reasoning_effort untouched", () => {
		const withoutEffort = { model: "mimo-v2.6-pro", max_tokens: 1024 };
		expect(
			mapMimoReasoningEffortInRequestBody(withoutEffort, mimoContext),
		).toBe(withoutEffort);

		const nonStringEffort = { model: "mimo-v2.6-pro", reasoning_effort: 3 };
		expect(
			mapMimoReasoningEffortInRequestBody(nonStringEffort, mimoContext),
		).toBe(nonStringEffort);
	});

	it("does not rewrite providers without the MiMo reasoning route", () => {
		const body = { model: "mimo-v2.6-pro", reasoning_effort: "xhigh" };
		expect(
			mapMimoReasoningEffortInRequestBody(
				body,
				makeContext({ family: "mimo" }),
			),
		).toBe(body);
		expect(
			mapMimoReasoningEffortInRequestBody(
				body,
				makeContext({ providerId: "openrouter", family: "mimo" }),
			),
		).toBe(body);
	});

	it("does not rewrite non-MiMo models on the Xiaomi route", () => {
		const body = { model: "some-other-model", reasoning_effort: "xhigh" };
		expect(
			mapMimoReasoningEffortInRequestBody(
				body,
				makeContext({
					metadata: MIMO_REASONING_EFFORT_ROUTING_METADATA,
					family: "other",
				}),
			),
		).toBe(body);
		expect(
			mapMimoReasoningEffortInRequestBody(
				body,
				makeContext({ metadata: MIMO_REASONING_EFFORT_ROUTING_METADATA }),
			),
		).toBe(body);
	});
});
