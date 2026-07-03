import { describe, expect, it } from "vitest";
import {
	formatDisplayUserInput,
	formatModeSwitchNotice,
	formatUserCommandBlock,
	formatUserInputBlock,
	normalizeUserInput,
	parseUserCommandEnvelope,
	stripModeNotices,
} from "./format";

describe("prompt format helpers", () => {
	it("parses a user command wrapper", () => {
		expect(
			parseUserCommandEnvelope(
				'<user_command slash="team">spawn a team of agents for the following task: inspect rpc startup</user_command>',
			),
		).toEqual({
			slash: "team",
			content:
				"spawn a team of agents for the following task: inspect rpc startup",
		});
	});

	it("normalizes wrapped user command content for model input", () => {
		expect(
			normalizeUserInput(
				'<user_command slash="team">spawn a team of agents for the following task: inspect rpc startup</user_command>',
			),
		).toBe(
			"spawn a team of agents for the following task: inspect rpc startup",
		);
	});

	it("formats wrapped team commands for display", () => {
		const wrapped = formatUserCommandBlock(
			"spawn a team of agents for the following task: inspect rpc startup",
			"team",
		);
		expect(formatDisplayUserInput(wrapped)).toBe("/team inspect rpc startup");
	});

	it("formats a mode switch notice", () => {
		expect(formatModeSwitchNotice("plan", "act")).toBe(
			"<mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>",
		);
	});

	it("hides mode switch notices from displayed user input", () => {
		const wrapped = formatUserInputBlock(
			`${formatModeSwitchNotice("act", "plan")}\nhow should we refactor this?`,
			"plan",
		);
		expect(formatDisplayUserInput(wrapped)).toBe(
			"how should we refactor this?",
		);
	});

	it("keeps mode switch notices when normalizing outbound prompts", () => {
		// prepareTurnInput sanitizes prompts with normalizeUserInput before the
		// host wraps them; stripping notices here would delete the switch
		// signal before the model ever sees it.
		const prompt = `${formatModeSwitchNotice("plan", "act")}\ndo it`;
		expect(normalizeUserInput(prompt)).toBe(prompt);
	});

	it("removes every mode notice and leaves unclosed ones intact", () => {
		expect(
			stripModeNotices(
				"<mode_notice>a</mode_notice>hello<mode_notice>b</mode_notice> there",
			),
		).toBe("hello there");
		expect(stripModeNotices("<mode_notice>dangling")).toBe(
			"<mode_notice>dangling",
		);
	});

	it("strips adversarial repeated open tags in linear time", () => {
		// Regression guard for CodeQL js/polynomial-redos: many unmatched
		// opening tags must not trigger quadratic rescanning.
		const hostile = "<mode_notice>".repeat(50_000);
		const started = performance.now();
		const result = stripModeNotices(hostile);
		expect(performance.now() - started).toBeLessThan(1_000);
		expect(result).toBe(hostile);
	});
});
