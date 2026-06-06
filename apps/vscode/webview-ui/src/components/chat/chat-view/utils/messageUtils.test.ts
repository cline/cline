import type { ClineMessage } from "@shared/ExtensionMessage";
import { describe, expect, it } from "vitest";
import { groupLowStakesTools, isToolGroup } from "./messageUtils";

const createTextMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "text",
	text,
	ts,
});

const createToolMessage = (ts: number, tool: string): ClineMessage => ({
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool, path: "src/file.ts" }),
	ts,
});

const createReasoningMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "reasoning",
	text,
	ts,
});

const createCompletionResultMessage = (
	ts: number,
	text: string,
): ClineMessage => ({
	type: "say",
	say: "completion_result",
	text,
	ts,
});

describe("groupLowStakesTools", () => {
	it("renders text that arrives after a low-stakes tool group below the group", () => {
		// Previously this text was silently dropped (continue); now it should
		// appear as a standalone row after the tool group is committed.
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "readFile"),
			createTextMessage(3, "Late text that should now be visible"),
		]);

		expect(grouped).toHaveLength(3);
		expect(grouped[0]).toMatchObject({
			type: "say",
			say: "text",
			text: "Initial text",
		});
		expect(isToolGroup(grouped[1])).toBe(true);
		expect(grouped[2]).toMatchObject({
			type: "say",
			say: "text",
			text: "Late text that should now be visible",
		});
	});

	it("does not swallow content written after reads and before attempt_completion (issue #9719)", () => {
		// Scenario: agent reads files, then writes a detailed analysis, then calls
		// attempt_completion. The analysis text must not be dropped.
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Let me read the files first."),
			createToolMessage(2, "readFile"),
			createToolMessage(3, "readFile"),
			createTextMessage(4, "# Code Review\n\nP0: Critical bug in auth flow."),
			createCompletionResultMessage(5, "Found 1 critical bug."),
		]);

		const texts = grouped.filter(
			(item) => !Array.isArray(item) && (item as ClineMessage).say === "text",
		) as ClineMessage[];
		const codeReview = texts.find((m) => m.text?.includes("Code Review"));
		expect(codeReview).toBeDefined();
		expect(codeReview?.text).toContain("Code Review");

		const toolGroups = grouped.filter((item) => isToolGroup(item));
		expect(toolGroups).toHaveLength(1);

		const completions = grouped.filter(
			(item) =>
				!Array.isArray(item) &&
				(item as ClineMessage).say === "completion_result",
		) as ClineMessage[];
		expect(completions).toHaveLength(1);
	});

	it("keeps text when no low-stakes tool group is active", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "editedExistingFile"),
			createTextMessage(3, "Follow-up text"),
		]);

		expect(grouped).toHaveLength(3);
		expect(grouped[0]).toMatchObject({
			type: "say",
			say: "text",
			text: "Initial text",
		});
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" });
		expect(grouped[2]).toMatchObject({
			type: "say",
			say: "text",
			text: "Follow-up text",
		});
	});

	it("keeps standalone reasoning when no low-stakes tool group follows", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createTextMessage(2, "Answer text"),
		]);

		expect(grouped).toHaveLength(2);
		expect(grouped[0]).toMatchObject({
			type: "say",
			say: "reasoning",
			text: "Thinking through options",
		});
		expect(grouped[1]).toMatchObject({
			type: "say",
			say: "text",
			text: "Answer text",
		});
	});

	it("keeps standalone reasoning before a non-low-stakes tool", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createToolMessage(2, "editedExistingFile"),
		]);

		expect(grouped).toHaveLength(2);
		expect(grouped[0]).toMatchObject({
			type: "say",
			say: "reasoning",
			text: "Thinking through options",
		});
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" });
	});

	it("keeps reasoning visible when low-stakes tool group starts immediately after", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Planning next read"),
			createToolMessage(2, "readFile"),
		]);

		expect(grouped).toHaveLength(2);
		expect(grouped[0]).toMatchObject({
			type: "say",
			say: "reasoning",
			text: "Planning next read",
		});
		expect(isToolGroup(grouped[1])).toBe(true);
	});
});
