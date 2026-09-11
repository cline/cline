import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const historyMocks = vi.hoisted(() => ({
	runHistoryDelete: vi.fn(async () => 0),
	runHistoryExport: vi.fn(async () => 0),
	runHistoryList: vi.fn(async () => 0),
	runHistoryUpdate: vi.fn(async () => 0),
}));

vi.mock("./history", () => historyMocks);

import { registerHistoryCommand } from "./history-command";

function createHarness(isInteractiveTTY: boolean) {
	const program = new Command()
		.exitOverride()
		.option("--json", "Output as JSON");
	program.configureOutput({
		writeOut: vi.fn(),
		writeErr: vi.fn(),
	});
	const io = {
		writeln: vi.fn(),
		writeErr: vi.fn(),
	};
	const setExitCode = vi.fn();
	const setStartupTarget = vi.fn();
	registerHistoryCommand({
		program,
		io,
		setExitCode,
		setStartupTarget,
		isInteractiveTTY: () => isInteractiveTTY,
	});
	return { program, io, setExitCode, setStartupTarget };
}

describe("registerHistoryCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("opens the in-app history picker for an interactive text terminal", async () => {
		const { program, setExitCode, setStartupTarget } = createHarness(true);

		await program.parseAsync(["history"], { from: "user" });

		expect(setStartupTarget).toHaveBeenCalledOnce();
		expect(setStartupTarget).toHaveBeenCalledWith("history");
		expect(historyMocks.runHistoryList).not.toHaveBeenCalled();
		expect(setExitCode).not.toHaveBeenCalled();
	});

	it("keeps explicit JSON output non-interactive even when a TTY is attached", async () => {
		const { program, io, setExitCode, setStartupTarget } = createHarness(true);

		await program.parseAsync(["history", "--json"], { from: "user" });

		expect(setStartupTarget).not.toHaveBeenCalled();
		expect(historyMocks.runHistoryList).toHaveBeenCalledWith({
			limit: 50,
			outputMode: "json",
			io,
		});
		expect(setExitCode).toHaveBeenCalledWith(0);
	});

	it("prints text history when no interactive terminal is attached", async () => {
		const { program, io, setExitCode, setStartupTarget } = createHarness(false);

		await program.parseAsync(["history", "--limit", "12"], { from: "user" });

		expect(setStartupTarget).not.toHaveBeenCalled();
		expect(historyMocks.runHistoryList).toHaveBeenCalledWith({
			limit: 12,
			outputMode: "text",
			io,
		});
		expect(setExitCode).toHaveBeenCalledWith(0);
	});

	it("returns an error when delete is missing --session-id", async () => {
		const { program, io, setExitCode } = createHarness(false);

		await program.parseAsync(["history", "delete"], { from: "user" });

		expect(io.writeErr).toHaveBeenCalledWith(
			"history delete requires --session-id <id>",
		);
		expect(historyMocks.runHistoryDelete).not.toHaveBeenCalled();
		expect(setExitCode).toHaveBeenCalledWith(1);
	});
});
