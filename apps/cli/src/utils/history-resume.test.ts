import { describe, expect, it } from "vitest";
import { buildHistoryResumeArgs } from "./history-resume";

describe("buildHistoryResumeArgs", () => {
	it("replaces the history subcommand with --id", () => {
		expect(
			buildHistoryResumeArgs({
				sessionId: "sess_1",
				normalizedArgs: ["history"],
				remainingArgs: ["history"],
			}),
		).toEqual(["--id", "sess_1"]);
	});

	it("preserves global flags that precede the subcommand", () => {
		expect(
			buildHistoryResumeArgs({
				sessionId: "sess_1",
				normalizedArgs: [
					"--data-dir",
					"/tmp/data",
					"-m",
					"claude-sonnet-4-6",
					"history",
					"--limit",
					"5",
				],
				remainingArgs: ["history", "--limit", "5"],
			}),
		).toEqual([
			"--data-dir",
			"/tmp/data",
			"-m",
			"claude-sonnet-4-6",
			"--id",
			"sess_1",
		]);
	});

	it("keeps a global flag value that matches the subcommand alias", () => {
		expect(
			buildHistoryResumeArgs({
				sessionId: "sess_1",
				normalizedArgs: ["-m", "h", "h"],
				remainingArgs: ["h"],
			}),
		).toEqual(["-m", "h", "--id", "sess_1"]);
	});

	it("forwards a config dir passed as a subcommand option", () => {
		expect(
			buildHistoryResumeArgs({
				sessionId: "sess_1",
				normalizedArgs: ["history", "--config", "/tmp/conf"],
				remainingArgs: ["history", "--config", "/tmp/conf"],
				configDir: "/tmp/conf",
			}),
		).toEqual(["--config", "/tmp/conf", "--id", "sess_1"]);
	});

	it("does not duplicate a config dir already in the global flags", () => {
		expect(
			buildHistoryResumeArgs({
				sessionId: "sess_1",
				normalizedArgs: ["--config", "/tmp/conf", "history"],
				remainingArgs: ["history"],
				configDir: "/tmp/conf",
			}),
		).toEqual(["--config", "/tmp/conf", "--id", "sess_1"]);
	});

	it("recognizes the --config=<dir> spelling in global flags", () => {
		expect(
			buildHistoryResumeArgs({
				sessionId: "sess_1",
				normalizedArgs: ["--config=/tmp/conf", "history"],
				remainingArgs: ["history"],
				configDir: "/tmp/conf",
			}),
		).toEqual(["--config=/tmp/conf", "--id", "sess_1"]);
	});

	it("returns undefined when remaining args are not a suffix of argv", () => {
		expect(
			buildHistoryResumeArgs({
				sessionId: "sess_1",
				normalizedArgs: ["history", "--limit", "5"],
				remainingArgs: ["history", "--limit", "9"],
			}),
		).toBeUndefined();
		expect(
			buildHistoryResumeArgs({
				sessionId: "sess_1",
				normalizedArgs: ["history"],
				remainingArgs: ["extra", "history"],
			}),
		).toBeUndefined();
	});
});
