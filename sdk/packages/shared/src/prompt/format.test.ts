import { describe, expect, it } from "vitest";
import {
	createModeSwitchNoticeTracker,
	createShellChangeNoticeTracker,
	formatDisplayUserInput,
	formatModeSwitchNotice,
	formatShellChangeNotice,
	formatUserCommandBlock,
	formatUserInputBlock,
	normalizeUserInput,
	parseUserCommandEnvelope,
	parseUserInputMode,
	stripRuntimeNotices,
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

	it("parses the mode attribute from a user_input wrapper", () => {
		expect(parseUserInputMode(formatUserInputBlock("hello", "plan"))).toBe(
			"plan",
		);
		expect(parseUserInputMode(formatUserInputBlock("hello", "act"))).toBe(
			"act",
		);
	});

	it("parses the mode when a mode notice precedes the wrapper", () => {
		const input = `${formatModeSwitchNotice("act", "plan")}${formatUserInputBlock("hello", "plan")}`;
		expect(parseUserInputMode(input)).toBe("plan");
	});

	it("returns undefined for unwrapped or unknown-mode input", () => {
		expect(parseUserInputMode("plain text")).toBeUndefined();
		expect(parseUserInputMode(undefined)).toBeUndefined();
		expect(
			parseUserInputMode('<user_input mode="warp">hello</user_input>'),
		).toBeUndefined();
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

	it("formats a shell change notice using shell display names", () => {
		expect(
			formatShellChangeNotice(
				"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
				"C:\\Windows\\System32\\cmd.exe",
			),
		).toBe(
			"<environment_notice>The user changed the terminal shell from PowerShell to cmd.exe before sending this message. Commands now run through cmd.exe; write all subsequent commands in cmd.exe syntax.</environment_notice>",
		);
	});

	it("hides shell change notices from displayed user input", () => {
		const wrapped = formatUserInputBlock(
			`${formatShellChangeNotice("/bin/bash", "/bin/zsh")}\nnow run the build`,
			"act",
		);
		expect(formatDisplayUserInput(wrapped)).toBe("now run the build");
	});

	it("keeps shell change notices when normalizing outbound prompts", () => {
		const prompt = `${formatShellChangeNotice("powershell", "cmd.exe")}\ndo it`;
		expect(normalizeUserInput(prompt)).toBe(prompt);
	});

	it("hides stacked mode and shell notices on one message from display", () => {
		const wrapped = formatUserInputBlock(
			`${formatModeSwitchNotice("plan", "act")}\n${formatShellChangeNotice("powershell", "cmd.exe")}\ngo`,
			"act",
		);
		expect(formatDisplayUserInput(wrapped)).toBe("go");
	});

	it("removes every runtime notice and leaves unclosed ones intact", () => {
		expect(
			stripRuntimeNotices(
				"<mode_notice>a</mode_notice>hello<environment_notice>b</environment_notice> there",
			),
		).toBe("hello there");
		expect(stripRuntimeNotices("<mode_notice>dangling")).toBe(
			"<mode_notice>dangling",
		);
	});

	it("strips adversarial repeated open tags in linear time", () => {
		// Regression guard for CodeQL js/polynomial-redos: many unmatched
		// opening tags must not trigger quadratic rescanning.
		const hostile = "<mode_notice>".repeat(50_000);
		const started = performance.now();
		const result = stripRuntimeNotices(hostile);
		expect(performance.now() - started).toBeLessThan(1_000);
		expect(result).toBe(hostile);
	});
});

// Promoted from apps/cli/src/runtime/interactive/mode.ts so the VSCode
// extension shares the exact semantics; the CLI re-exports it from there.
describe("createModeSwitchNoticeTracker", () => {
	it("records a switch and clears it on consume", () => {
		const tracker = createModeSwitchNoticeTracker();

		tracker.record("act", "plan");

		expect(tracker.consume()).toEqual({ from: "act", to: "plan" });
		expect(tracker.consume()).toBeNull();
	});

	it("cancels a round trip that returns to the mode the model last saw", () => {
		const tracker = createModeSwitchNoticeTracker();

		tracker.record("act", "plan");
		tracker.record("plan", "act");

		expect(tracker.consume()).toBeNull();
	});

	it("keeps the original starting mode across chained switches", () => {
		const tracker = createModeSwitchNoticeTracker();

		tracker.record("act", "plan");
		tracker.record("plan", "act");
		tracker.record("act", "plan");

		expect(tracker.consume()).toEqual({ from: "act", to: "plan" });
	});

	it("ignores a no-op switch", () => {
		const tracker = createModeSwitchNoticeTracker();

		tracker.record("plan", "plan");

		expect(tracker.consume()).toBeNull();
	});
});

describe("createShellChangeNoticeTracker", () => {
	it("records a change and cancels a round trip back to the original shell", () => {
		const tracker = createShellChangeNoticeTracker();

		tracker.record("powershell", "cmd.exe");
		expect(tracker.consume()).toEqual({
			from: "powershell",
			to: "cmd.exe",
		});

		tracker.record("powershell", "cmd.exe");
		tracker.record("cmd.exe", "powershell");
		expect(tracker.consume()).toBeNull();
	});
});
