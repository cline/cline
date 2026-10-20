import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listCommandsMock, runMock, createPluginCommandServiceMock } =
	vi.hoisted(() => {
		const listCommandsMock = vi.fn(
			async (): Promise<Array<{ name: string; description?: string }>> => [],
		);
		const runMock = vi.fn(
			async (
				_name: string,
				_input: string,
			): Promise<{ reply?: string; submitPrompt?: string } | undefined> =>
				undefined,
		);
		return {
			listCommandsMock,
			runMock,
			createPluginCommandServiceMock: vi.fn(() => ({
				listCommands: listCommandsMock,
				run: runMock,
				shutdown: vi.fn(),
			})),
		};
	});

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		createPluginCommandService: createPluginCommandServiceMock,
	};
});

import { handleCommand } from "./commands";
import {
	resetPluginCommandServicesForTests,
	runPluginSlashCommand,
	WARMUP_MAX_ATTEMPTS,
	WARMUP_RETRY_DELAY_MS,
} from "./plugin-commands";
import type { SidecarContext } from "./types";

const WORKSPACE = "/projects/app";

function createContext(kind: "local" | "ssh" = "local"): SidecarContext {
	return {
		activeEnvironmentId: "env",
		localWorkspaceRoot: "/local/launch-root",
		runtimeBindings: new Map([
			[
				"env",
				{
					kind,
					environmentId: "env",
					workspaceRoot: "/local/launch-root",
				},
			],
		]),
	} as unknown as SidecarContext;
}

async function flushPromises(): Promise<void> {
	for (let i = 0; i < 5; i += 1) {
		await Promise.resolve();
	}
}

describe("plugin command warmup", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetPluginCommandServicesForTests();
		listCommandsMock.mockReset();
		listCommandsMock.mockResolvedValue([]);
		runMock.mockReset();
		createPluginCommandServiceMock.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("loads the workspace's plugin commands once ahead of the slash menu", async () => {
		listCommandsMock.mockResolvedValue([{ name: "goal" }]);
		const ctx = createContext();
		await expect(
			handleCommand(ctx, "warm_plugin_commands", { workspacePath: WORKSPACE }),
		).resolves.toEqual({ environmentId: "env" });
		await flushPromises();

		// The service is keyed on the reported workspace, not the launch root.
		expect(createPluginCommandServiceMock).toHaveBeenCalledTimes(1);
		expect(createPluginCommandServiceMock).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: WORKSPACE, workspacePath: WORKSPACE }),
		);
		expect(listCommandsMock).toHaveBeenCalledTimes(1);

		// Re-reporting the same workspace does not reload a warmed host.
		await handleCommand(ctx, "warm_plugin_commands", {
			workspacePath: WORKSPACE,
		});
		await flushPromises();
		expect(listCommandsMock).toHaveBeenCalledTimes(1);

		// The slash menu and the command runner reuse the warmed service.
		await expect(
			handleCommand(ctx, "list_plugin_commands", { workspacePath: WORKSPACE }),
		).resolves.toEqual([{ name: "goal" }]);
		expect(createPluginCommandServiceMock).toHaveBeenCalledTimes(1);
	});

	it("recovers from a failed cold load and makes the command available", async () => {
		// First load times out inside the service (which reports it as an
		// empty command set), the retry succeeds.
		listCommandsMock
			.mockResolvedValueOnce([])
			.mockResolvedValue([{ name: "goal", description: "Set a goal" }]);
		runMock.mockResolvedValue({ reply: "Goal set: ship it" });
		const ctx = createContext();

		await handleCommand(ctx, "warm_plugin_commands", {
			workspacePath: WORKSPACE,
		});
		await flushPromises();
		expect(listCommandsMock).toHaveBeenCalledTimes(1);

		// Re-reporting the workspace while the retry is pending does not stack
		// extra loads.
		await handleCommand(ctx, "warm_plugin_commands", {
			workspacePath: WORKSPACE,
		});
		await flushPromises();
		expect(listCommandsMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(WARMUP_RETRY_DELAY_MS);
		await flushPromises();
		expect(listCommandsMock).toHaveBeenCalledTimes(2);

		// Discovery and execution now work without the user reopening the menu.
		await expect(
			handleCommand(ctx, "list_plugin_commands", { workspacePath: WORKSPACE }),
		).resolves.toEqual([{ name: "goal", description: "Set a goal" }]);
		await expect(
			runPluginSlashCommand(ctx, {
				workspacePath: WORKSPACE,
				prompt: "/goal ship it",
			}),
		).resolves.toEqual({ reply: "Goal set: ship it" });
		expect(runMock).toHaveBeenCalledWith("goal", " ship it");

		// Once warmed, no further retries are scheduled.
		await vi.advanceTimersByTimeAsync(WARMUP_RETRY_DELAY_MS * 2);
		expect(listCommandsMock).toHaveBeenCalledTimes(3);
	});

	it("stops retrying after a bounded number of attempts", async () => {
		listCommandsMock.mockRejectedValue(new Error("sandbox boom"));
		const ctx = createContext();
		await handleCommand(ctx, "warm_plugin_commands", {
			workspacePath: WORKSPACE,
		});
		await flushPromises();
		for (let i = 0; i < WARMUP_MAX_ATTEMPTS + 2; i += 1) {
			await vi.advanceTimersByTimeAsync(WARMUP_RETRY_DELAY_MS);
			await flushPromises();
		}
		expect(listCommandsMock).toHaveBeenCalledTimes(WARMUP_MAX_ATTEMPTS);
	});

	it("does not spawn a sandbox for remote workspaces", async () => {
		const ctx = createContext("ssh");
		await handleCommand(ctx, "warm_plugin_commands", {
			workspacePath: "/srv/code",
		});
		await flushPromises();
		expect(createPluginCommandServiceMock).not.toHaveBeenCalled();
	});
});
