import { describe, expect, it } from "vitest";
import {
	detachedCommandBackgroundStatus,
	formatDetachedCompletionNote,
	matchDetachedCommandNotice,
} from "./detached";

describe("detached command vocabulary", () => {
	it("formats each outcome kind", () => {
		expect(formatDetachedCompletionNote({ kind: "exited", exitCode: 0 })).toBe(
			"[Detached command completed with exit code 0]",
		);
		expect(formatDetachedCompletionNote({ kind: "exited", exitCode: 3 })).toBe(
			"[Detached command completed with exit code 3]",
		);
		expect(
			formatDetachedCompletionNote({ kind: "signaled", signal: "SIGTERM" }),
		).toBe("[Detached command ended from signal SIGTERM]");
		expect(formatDetachedCompletionNote({ kind: "hard_killed" })).toBe(
			"[Detached command reached its hard deadline and was terminated]",
		);
		expect(
			formatDetachedCompletionNote({ kind: "failed", error: "boom" }),
		).toBe("[Detached command failed: boom]");
	});

	it("maps outcomes to row statuses the way the live completion path does", () => {
		expect(
			detachedCommandBackgroundStatus({ kind: "exited", exitCode: 0 }),
		).toBe("succeeded");
		expect(
			detachedCommandBackgroundStatus({ kind: "exited", exitCode: 1 }),
		).toBe("failed");
		expect(detachedCommandBackgroundStatus({ kind: "hard_killed" })).toBe(
			"killed",
		);
		expect(
			detachedCommandBackgroundStatus({ kind: "signaled", signal: "SIGKILL" }),
		).toBe("indeterminate");
		expect(
			detachedCommandBackgroundStatus({ kind: "failed", error: "nope" }),
		).toBe("failed");
	});

	it("extracts the log path from a detached notice", () => {
		expect(
			matchDetachedCommandNotice(
				"[Command is still running. Output will continue in /tmp/cline-command-x/output.log]",
			),
		).toBe("/tmp/cline-command-x/output.log");
		expect(matchDetachedCommandNotice("done")).toBeNull();
	});

	it.each([
		["[Command is still running. Output will continue in ]", null],
		[
			"[Command is still running. Output will continue in ][Command is still running. Output will continue in C:\\logs\\output.log]",
			"C:\\logs\\output.log",
		],
		[
			"[Command is still running. Output will continue in /tmp/[nested/output.log] later]",
			"/tmp/[nested/output.log",
		],
		[
			"[Command is still running. Output will continue in /tmp/line\nbreak.log]",
			"/tmp/line\nbreak.log",
		],
	])("matches the first nonempty notice path in %s", (text, expected) => {
		expect(matchDetachedCommandNotice(text)).toBe(expected);
	});

	it("handles repeated unterminated notices without rescanning the output", () => {
		const output =
			"[Command is still running. Output will continue in \\".repeat(20_000);
		const start = performance.now();
		expect(matchDetachedCommandNotice(output)).toBeNull();
		// A linear scan of this 1 MB input leaves ample headroom on CI; retrying
		// the entire suffix for each prefix takes several seconds.
		expect(performance.now() - start).toBeLessThan(1_000);
	});
});
