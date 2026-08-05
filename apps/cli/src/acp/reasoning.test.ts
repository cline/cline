import { describe, expect, it } from "vitest";
import {
	ACP_REASONING_LEVELS,
	buildReasoningConfigOption,
	isAcpReasoningLevel,
	REASONING_CONFIG_ID,
	reasoningConnectionUpdate,
	supportsReasoning,
} from "./reasoning";

describe("buildReasoningConfigOption", () => {
	it("builds a thought_level select reflecting the current value", () => {
		const option = buildReasoningConfigOption("high");

		expect(option).toMatchObject({
			type: "select",
			id: REASONING_CONFIG_ID,
			category: "thought_level",
			currentValue: "high",
		});
	});

	it("offers every reasoning level", () => {
		const option = buildReasoningConfigOption("none");
		if (option.type !== "select") {
			throw new Error("expected a select option");
		}

		expect(option.options.map((o) => ("value" in o ? o.value : o))).toEqual([
			...ACP_REASONING_LEVELS,
		]);
	});
});

describe("supportsReasoning", () => {
	it("matches the TUI's capability check", () => {
		expect(supportsReasoning({ capabilities: ["tools", "reasoning"] })).toBe(
			true,
		);
		expect(supportsReasoning({ capabilities: ["tools"] })).toBe(false);
		expect(supportsReasoning({})).toBe(false);
		expect(supportsReasoning(undefined)).toBe(false);
	});
});

describe("isAcpReasoningLevel", () => {
	it("accepts the CLI thinking levels", () => {
		for (const level of ACP_REASONING_LEVELS) {
			expect(isAcpReasoningLevel(level)).toBe(true);
		}
	});

	it("rejects unknown values", () => {
		expect(isAcpReasoningLevel("max")).toBe(false);
		expect(isAcpReasoningLevel("minimal")).toBe(false);
		expect(isAcpReasoningLevel("")).toBe(false);
		expect(isAcpReasoningLevel(undefined)).toBe(false);
		expect(isAcpReasoningLevel(2)).toBe(false);
	});
});

describe("reasoningConnectionUpdate", () => {
	it("disables thinking for none without carrying an effort", () => {
		expect(reasoningConnectionUpdate("none")).toEqual({ thinking: false });
	});

	it("enables thinking with the selected effort", () => {
		expect(reasoningConnectionUpdate("xhigh")).toEqual({
			thinking: true,
			reasoningEffort: "xhigh",
		});
	});
});
