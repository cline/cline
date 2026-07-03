import { describe, expect, it } from "vitest";
import {
	formatDisplayUserInput,
	formatModeSwitchNotice,
	formatUserCommandBlock,
	formatUserInputBlock,
	normalizeUserInput,
	parseUserCommandEnvelope,
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
		expect(normalizeUserInput(wrapped)).toBe("how should we refactor this?");
	});
});
