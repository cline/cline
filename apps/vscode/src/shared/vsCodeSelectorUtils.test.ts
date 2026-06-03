import { describe, expect, it } from "vitest";
import {
	parseVsCodeLmModelSelector,
	stringifyVsCodeLmModelSelector,
} from "./vsCodeSelectorUtils";

describe("VS Code LM selector string encoding", () => {
	it("round-trips vendor/family selectors", () => {
		const selector = { vendor: "copilot", family: "claude-sonnet" };
		const value = stringifyVsCodeLmModelSelector(selector);

		expect(value).toBe("copilot/claude-sonnet");
		expect(parseVsCodeLmModelSelector(value)).toEqual(selector);
	});

	it("preserves family values containing slashes", () => {
		const selector = { vendor: "copilot", family: "openai/gpt-4o" };
		const value = stringifyVsCodeLmModelSelector(selector);

		expect(value).toBe("copilot/openai%2Fgpt-4o");
		expect(parseVsCodeLmModelSelector(value)).toEqual(selector);
	});

	it("round-trips optional version and id segments", () => {
		const selector = {
			vendor: "copilot",
			family: "anthropic/claude",
			version: "2026/06",
			id: "model/id",
		};
		const value = stringifyVsCodeLmModelSelector(selector);

		expect(parseVsCodeLmModelSelector(value)).toEqual(selector);
	});

	it("keeps compatibility with old unencoded vendor/family values", () => {
		expect(parseVsCodeLmModelSelector("copilot/claude-sonnet")).toEqual({
			vendor: "copilot",
			family: "claude-sonnet",
		});
	});
});
