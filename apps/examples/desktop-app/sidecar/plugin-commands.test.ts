import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeBinding } from "./context";

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
const commandMock = vi.fn(
	async (command: string, payload: Record<string, string>) => {
		if (command === "plugins.commands.list")
			return { ok: true, payload: { commands: await listCommandsMock() } };
		const result = await runMock(payload.name, payload.input);
		return { ok: true, payload: { handled: result !== undefined, result } };
	},
);

import { handleCommand } from "./commands";
import {
	disposePluginCommandWarmups,
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
					hubClient: { command: commandMock },
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
		disposePluginCommandWarmups();
		listCommandsMock.mockReset();
		listCommandsMock.mockResolvedValue([]);
		runMock.mockReset();
		commandMock.mockClear();
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
		expect(commandMock).toHaveBeenCalledWith(
			"plugins.commands.list",
			{
				workspaceRoot: WORKSPACE,
			},
			undefined,
			{ timeoutMs: null },
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
		expect(commandMock).toHaveBeenCalledWith(
			"plugins.commands.list",
			{
				workspaceRoot: WORKSPACE,
			},
			undefined,
			{ timeoutMs: null },
		);
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
			runPluginSlashCommand({
				workspacePath: WORKSPACE,
				prompt: "/goal ship it",
				binding: getRuntimeBinding(ctx, "env"),
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

	it("asks the SSH Hub to warm remote workspaces", async () => {
		const ctx = createContext("ssh");
		await handleCommand(ctx, "warm_plugin_commands", {
			workspacePath: "/srv/code",
		});
		await flushPromises();
		expect(commandMock).toHaveBeenCalledWith(
			"plugins.commands.list",
			{
				workspaceRoot: "/srv/code",
			},
			undefined,
			{ timeoutMs: null },
		);
	});
});

it("does not schedule a new retry after an in-flight warmup is disposed", async () => {
	vi.useFakeTimers();
	try {
		let complete: (commands: Array<{ name: string }>) => void = () => {};
		listCommandsMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const ctx = createContext();
		await handleCommand(ctx, "warm_plugin_commands", {
			workspacePath: WORKSPACE,
		});
		disposePluginCommandWarmups([getRuntimeBinding(ctx, "env").hubClient]);
		complete([]);
		await flushPromises();
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		disposePluginCommandWarmups();
		vi.useRealTimers();
	}
});

it("uses the selected SSH workspace and Hub for discovery and command execution", async () => {
	const ctx = createContext("ssh");
	const binding = getRuntimeBinding(ctx, "env");
	binding.workspaceRoot = "/srv/project";
	runMock.mockResolvedValueOnce({ reply: "remote reply" });
	await handleCommand(ctx, "list_plugin_commands");
	expect(commandMock).toHaveBeenLastCalledWith(
		"plugins.commands.list",
		{
			workspaceRoot: "/srv/project",
		},
		undefined,
		{ timeoutMs: null },
	);
	expect(
		await runPluginSlashCommand({
			binding,
			workspacePath: binding.workspaceRoot,
			prompt: "/hello remote",
		}),
	).toEqual({ reply: "remote reply" });
	expect(commandMock).toHaveBeenLastCalledWith(
		"plugins.commands.run",
		{
			workspaceRoot: "/srv/project",
			name: "hello",
			input: " remote",
		},
		undefined,
		{ timeoutMs: null },
	);
});
