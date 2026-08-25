import { describe, expect, it } from "vitest";
import {
	readSessionConnectionUpdate,
	resolveSessionAutoApproveTools,
	selectSessionTools,
} from "./session-handlers";

const tool = (name: string) => ({ name });

describe("selectSessionTools", () => {
	it("excludes tasks in yolo mode and CLI/VS Code sessions", () => {
		const tools = [tool("read_files"), tool("tasks")];

		expect(selectSessionTools(tools, "act").map(({ name }) => name)).toEqual([
			"read_files",
			"tasks",
		]);
		expect(selectSessionTools(tools, "plan").map(({ name }) => name)).toEqual([
			"read_files",
			"tasks",
		]);
		expect(selectSessionTools(tools, "zen").map(({ name }) => name)).toEqual([
			"read_files",
			"tasks",
		]);
		expect(selectSessionTools(tools, "yolo").map(({ name }) => name)).toEqual([
			"read_files",
		]);
		expect(
			selectSessionTools(tools, "act", "cli").map(({ name }) => name),
		).toEqual(["read_files"]);
		expect(
			selectSessionTools(tools, "act", "cline-cli-zen").map(({ name }) => name),
		).toEqual(["read_files"]);
		expect(
			selectSessionTools(tools, "act", "vscode").map(({ name }) => name),
		).toEqual(["read_files"]);
	});
});

describe("readSessionConnectionUpdate", () => {
	it("enables thinking when a positive budget is supplied without thinking", () => {
		expect(readSessionConnectionUpdate({ thinkingBudgetTokens: 2048 })).toEqual(
			{
				thinking: true,
				thinkingBudgetTokens: 2048,
			},
		);
	});

	it("lets explicit thinking disable override reasoning fields", () => {
		const updates = readSessionConnectionUpdate({
			thinking: false,
			reasoningEffort: "high",
			thinkingBudgetTokens: 2048,
		});

		expect(updates.thinking).toBe(false);
		expect(Object.hasOwn(updates, "reasoningEffort")).toBe(true);
		expect(updates.reasoningEffort).toBeUndefined();
		expect(Object.hasOwn(updates, "thinkingBudgetTokens")).toBe(true);
		expect(updates.thinkingBudgetTokens).toBeUndefined();
	});
});

describe("resolveSessionAutoApproveTools", () => {
	it("prefers the effective global tool policy", () => {
		expect(
			resolveSessionAutoApproveTools(
				{ "*": { autoApprove: false } },
				{ autoApproveTools: true },
			),
		).toBe(false);
		expect(
			resolveSessionAutoApproveTools(
				{ "*": { autoApprove: true } },
				{ autoApproveTools: false },
			),
		).toBe(true);
	});

	it("falls back to the runtime option", () => {
		expect(resolveSessionAutoApproveTools(undefined, {})).toBe(false);
		expect(
			resolveSessionAutoApproveTools(undefined, { autoApproveTools: true }),
		).toBe(true);
	});
});
