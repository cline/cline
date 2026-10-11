import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../utils/types";
import { runInteractive } from "./run-interactive";

const mocks = vi.hoisted(() => ({
	createComputerUse: vi.fn(),
	render: vi.fn(),
	readRepoStatus: vi.fn(),
	cleanup: vi.fn(),
}));

vi.mock("./interactive/computer-use", () => ({
	createInteractiveComputerUse: mocks.createComputerUse,
}));
vi.mock("./interactive/preflight", () => ({
	assertInteractivePreflight: vi.fn(),
}));
vi.mock("../utils/repo-status", () => ({
	readRepoStatus: mocks.readRepoStatus,
}));
vi.mock("../tui/interactive-welcome", () => ({
	listInteractiveSlashCommands: () => [],
}));
vi.mock("./interactive/approvals", () => ({
	createInteractiveApprovalController: () => ({
		autoApproveAllRef: { current: false },
		tuiToolApprover: { current: null },
		tuiAskQuestion: { current: null },
	}),
}));
vi.mock("./interactive/mistakes", () => ({
	createMistakeLimitDecisionResolver: vi.fn(),
}));
vi.mock("./interactive/session-runtime", () => ({
	createInteractiveSessionRuntime: () => ({ cleanup: mocks.cleanup }),
}));
vi.mock("./interactive/config-data", () => ({
	createInteractiveConfigDataLoader: () => ({}),
}));
vi.mock("./session-events", () => ({
	getUIEventEmitter: () => new EventEmitter(),
}));
vi.mock("../tui/index", () => ({ renderOpenTui: mocks.render }));

describe("interactive computer-use ownership", () => {
	const originalSigint = process.rawListeners("SIGINT");
	const originalSigterm = process.rawListeners("SIGTERM");

	afterEach(() => {
		for (const name of ["SIGINT", "SIGTERM"] as const) {
			const original = name === "SIGINT" ? originalSigint : originalSigterm;
			for (const listener of process.rawListeners(name)) {
				if (!original.includes(listener)) process.off(name, listener);
			}
		}
		vi.clearAllMocks();
	});

	it.each([
		"repository discovery",
		"TUI render",
		"TUI exit",
	])("disposes the computer host when %s fails", async (failure) => {
		const error = new Error(`${failure} failed`);
		const dispose = vi.fn(async () => {});
		mocks.createComputerUse.mockResolvedValue({
			driverTools: [],
			driverRecordingHooks: {},
			dispose,
		});
		mocks.readRepoStatus.mockResolvedValue(undefined);
		mocks.cleanup.mockResolvedValue(undefined);
		mocks.render.mockResolvedValue({
			waitUntilExit: async () => {
				throw error;
			},
		});
		if (failure === "repository discovery") {
			mocks.readRepoStatus.mockRejectedValue(error);
		} else if (failure === "TUI render") {
			mocks.render.mockRejectedValue(error);
		}

		await expect(
			runInteractive(
				{ mode: "act", cwd: "/tmp/project" } as Config,
				undefined,
				undefined,
				{
					startupTarget: "history",
				},
			),
		).rejects.toThrow(error);
		expect(dispose).toHaveBeenCalledOnce();
		if (failure !== "repository discovery")
			expect(mocks.cleanup).toHaveBeenCalledOnce();
		expect(process.rawListeners("SIGINT")).toEqual(originalSigint);
		expect(process.rawListeners("SIGTERM")).toEqual(originalSigterm);
	});
});
