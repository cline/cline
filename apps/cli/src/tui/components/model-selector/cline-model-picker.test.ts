import { describe, expect, it } from "vitest";
import {
	buildClineModelEntries,
	buildClinePassModelEntries,
} from "./cline-model-entries";

const model = (id: string) => ({ id, name: id, description: "", tags: [] });

describe("cline model picker entries", () => {
	it("builds Recommended/Free sections for the cline provider", () => {
		const entries = buildClineModelEntries({
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
			clinePass: [model("cline-pass/glm-5.1")],
		});

		expect(entries).toEqual([
			{
				kind: "model",
				model: model("anthropic/claude-sonnet-5"),
				tier: "recommended",
			},
			{
				kind: "model",
				model: model("deepseek/deepseek-v4-flash"),
				tier: "free",
			},
			{ kind: "browse" },
		]);
	});

	it("builds Subscribed/Free sections for the cline-pass provider", () => {
		const entries = buildClinePassModelEntries({
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
			clinePass: [model("cline-pass/glm-5.1"), model("cline-pass/kimi-k2.6")],
		});

		expect(entries).toEqual([
			{ kind: "model", model: model("cline-pass/glm-5.1"), tier: "subscribed" },
			{
				kind: "model",
				model: model("cline-pass/kimi-k2.6"),
				tier: "subscribed",
			},
			{
				kind: "model",
				model: model("deepseek/deepseek-v4-flash"),
				tier: "free",
			},
			{ kind: "browse" },
		]);
	});
});
