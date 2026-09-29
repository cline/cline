import { describe, expect, it, vi } from "vitest";

const createBuiltinToolsMock = vi.fn(() => []);
const bootstrapAgentTeamsMock = vi.fn(() => ({
	tools: [],
	restoreTeammates: vi.fn(),
}));

let runtimeInstance: MockAgentTeamsRuntime | undefined;
type MockTeamEvent = Record<string, unknown>;
type BootstrapCall = {
	teammateConfigProvider: {
		getRuntimeConfig(): unknown;
	};
};

class MockAgentTeamsRuntime {
	private readonly onTeamEvent?: (event: MockTeamEvent) => void;

	constructor(options: { onTeamEvent?: (event: MockTeamEvent) => void }) {
		this.onTeamEvent = options.onTeamEvent;
		runtimeInstance = this;
	}

	emit(event: MockTeamEvent): void {
		this.onTeamEvent?.(event);
	}

	hydrateState = vi.fn();
	exportState = vi.fn(() => ({
		members: [],
		tasks: [],
		mailbox: [],
		missionLog: [],
		runs: [],
		outcomes: [],
		outcomeFragments: [],
	}));
	markStaleRunsInterrupted = vi.fn();
	recoverActiveRuns = vi.fn();
	getTeammateIds = vi.fn((): string[] => []);
	listTasks = vi.fn((): Array<{ status: string }> => []);
	listRuns = vi.fn(() => []);
	shutdownTeammate = vi.fn();
	shutdown = vi.fn(async (reason: string) => {
		for (const id of this.getTeammateIds()) this.shutdownTeammate(id, reason);
	});
}

vi.mock("../../extensions/tools/team", () => ({
	AgentTeamsRuntime: MockAgentTeamsRuntime,
	bootstrapAgentTeams: bootstrapAgentTeamsMock,
	createDelegatedAgentConfigProvider: (config: Record<string, unknown>) => {
		let runtimeConfig = { ...config };
		return {
			getRuntimeConfig: () => runtimeConfig,
			getConnectionConfig: () => ({
				providerId: runtimeConfig.providerId,
				modelId: runtimeConfig.modelId,
				apiKey: runtimeConfig.apiKey,
				baseUrl: runtimeConfig.baseUrl,
				headers: runtimeConfig.headers,
				providerConfig: runtimeConfig.providerConfig,
				knownModels: runtimeConfig.knownModels,
				thinking: runtimeConfig.thinking,
			}),
			updateConnectionDefaults: (overrides: Record<string, unknown>) => {
				runtimeConfig = { ...runtimeConfig, ...overrides };
			},
		};
	},
}));

vi.mock("../../extensions/tools", () => ({
	ALL_DEFAULT_TOOL_NAMES: [],
	createBuiltinTools: createBuiltinToolsMock,
	ToolPresets: {
		development: {},
		readonly: {},
	},
	resolveToolPresetName: () => "development",
	resolveToolRoutingConfig: () => [],
	DEFAULT_MODEL_TOOL_ROUTING_RULES: [],
}));

let teamStoreInstance: MockTeamStore | undefined;
class MockTeamStore {
	constructor() {
		teamStoreInstance = this;
	}

	loadRuntime = vi.fn(() => ({
		state: {
			teamId: "team_1",
			teamName: "test",
			members: [],
			tasks: [],
			mailbox: [],
			missionLog: [],
			runs: [],
			outcomes: [],
			outcomeFragments: [],
		},
		teammates: [
			{
				agentId: "restored-1",
				rolePrompt: "Persisted teammate",
				modelId: "claude-sonnet-4-5-20250929",
				maxIterations: 4,
			},
		],
		interruptedRunIds: [],
	}));
	handleTeamEvent = vi.fn();
	persistRuntime = vi.fn();
}

vi.mock("../../services/storage/team-store", () => ({
	createLocalTeamStore: () => new MockTeamStore(),
}));

describe("DefaultRuntimeBuilder team persistence boundary", () => {
	it("persists teammate specs and runtime state from team events", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const onTeamRestored = vi.fn();

		const environment = await new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				headers: {
					Authorization: "Bearer team-token",
				},
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: true,
			},
			onTeamRestored,
		});

		await environment.activate?.();
		expect(bootstrapAgentTeamsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				teammateConfigProvider: expect.objectContaining({
					getRuntimeConfig: expect.any(Function),
				}),
			}),
		);
		const bootstrapCall = (
			bootstrapAgentTeamsMock.mock.calls as unknown as Array<[BootstrapCall]>
		)[0]?.[0];
		expect(bootstrapCall).toBeDefined();
		expect(bootstrapCall?.teammateConfigProvider.getRuntimeConfig()).toEqual(
			expect.objectContaining({
				headers: {
					Authorization: "Bearer team-token",
				},
			}),
		);
		expect(onTeamRestored).toHaveBeenCalledTimes(1);
		expect(runtimeInstance).toBeDefined();
		expect(teamStoreInstance).toBeDefined();
		if (!runtimeInstance || !teamStoreInstance) {
			throw new Error("Expected mocked runtime and team store instances");
		}

		expect(runtimeInstance.markStaleRunsInterrupted).not.toHaveBeenCalled();
		expect(runtimeInstance.recoverActiveRuns).toHaveBeenCalledWith(
			"runtime_recovered",
		);

		runtimeInstance.emit({
			type: "teammate_spawned",
			agentId: "python-poet",
			teammate: {
				rolePrompt: "Write concise Python-focused haiku",
				modelId: "claude-sonnet-4-5-20250929",
				maxIterations: 7,
			},
		});
		expect(teamStoreInstance.handleTeamEvent).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				type: "teammate_spawned",
				agentId: "python-poet",
			}),
		);
		expect(teamStoreInstance.persistRuntime).toHaveBeenCalled();

		runtimeInstance.emit({
			type: "teammate_shutdown",
			agentId: "python-poet",
		});
		expect(teamStoreInstance.handleTeamEvent).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				type: "teammate_shutdown",
				agentId: "python-poet",
			}),
		);
		expect(teamStoreInstance.persistRuntime).toHaveBeenLastCalledWith(
			expect.any(String),
			expect.any(Object),
			expect.arrayContaining([
				expect.objectContaining({ agentId: "python-poet" }),
			]),
		);

		runtimeInstance.emit({
			type: "teammate_shutdown",
			agentId: "python-poet",
			reason: "manual_restart",
		});
		expect(teamStoreInstance.persistRuntime).toHaveBeenLastCalledWith(
			expect.any(String),
			expect.any(Object),
			expect.not.arrayContaining([
				expect.objectContaining({ agentId: "python-poet" }),
			]),
		);

		runtimeInstance.emit({
			type: "teammate_spawned",
			agentId: "java-poet",
			teammate: {
				rolePrompt: "Write concise Java-focused haiku",
			},
		});
		runtimeInstance.emit({
			type: "teammate_shutdown",
			agentId: "java-poet",
			reason: "cli_run_shutdown",
		});
		expect(teamStoreInstance.persistRuntime).toHaveBeenLastCalledWith(
			expect.any(String),
			expect.any(Object),
			expect.arrayContaining([
				expect.objectContaining({ agentId: "java-poet" }),
			]),
		);
	});

	it.each([
		"session_restart",
		"session_start_failed",
	])("isolates same-ID teams when an environment shuts down for %s", async (reason) => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const builder = new DefaultRuntimeBuilder();
		const config = {
			sessionId: "same-session",
			providerId: "anthropic",
			modelId: "old-model",
			apiKey: "key",
			systemPrompt: "test",
			cwd: process.cwd(),
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: true,
		};
		const resident = await builder.build({ config });
		const residentTeam = runtimeInstance;
		const replacement = await builder.build({
			config: { ...config, modelId: "new-model" },
		});
		const replacementTeam = runtimeInstance;
		if (!residentTeam || !replacementTeam)
			throw new Error("Teams were not created");
		expect(replacement.teamRuntime).not.toBe(resident.teamRuntime);
		expect(replacement.delegatedAgentConfigProvider).not.toBe(
			resident.delegatedAgentConfigProvider,
		);
		expect(
			replacement.delegatedAgentConfigProvider?.getRuntimeConfig().modelId,
		).toBe("new-model");
		expect(
			resident.delegatedAgentConfigProvider?.getRuntimeConfig().modelId,
		).toBe("old-model");
		residentTeam.getTeammateIds.mockReturnValue(["resident-member"]);
		replacementTeam.getTeammateIds.mockReturnValue(["replacement-member"]);
		const discarded = reason === "session_restart" ? resident : replacement;
		const survivor = reason === "session_restart" ? replacement : resident;
		const discardedTeam =
			reason === "session_restart" ? residentTeam : replacementTeam;
		const survivorTeam =
			reason === "session_restart" ? replacementTeam : residentTeam;
		try {
			await discarded.shutdown(reason);
			expect(discardedTeam.shutdownTeammate).toHaveBeenCalledOnce();
			expect(survivorTeam.shutdownTeammate).not.toHaveBeenCalled();
			survivorTeam.listTasks.mockReturnValue([{ status: "in_progress" }]);
			expect(survivor.completionPolicy?.completionGuard?.()).toBeTruthy();
			survivorTeam.listTasks.mockReturnValue([]);
			expect(survivor.completionPolicy?.completionGuard?.()).toBeUndefined();
		} finally {
			await survivor.shutdown("session_stop");
		}
	});

	it.each([
		"session_restart",
		"session_start_failed",
	])("preserves restorable teammate specs on %s", async (reason) => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const environment = await new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "test",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: true,
			},
		});
		await environment.activate?.();
		runtimeInstance?.emit({
			type: "teammate_shutdown",
			agentId: "restored-1",
			reason,
		});
		expect(teamStoreInstance?.persistRuntime).toHaveBeenLastCalledWith(
			expect.any(String),
			expect.any(Object),
			expect.arrayContaining([
				expect.objectContaining({ agentId: "restored-1" }),
			]),
		);
		await environment.shutdown("session_stop");
	});

	it("keeps preparation passive and reloads the latest snapshot on activation", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const onTeamEvent = vi.fn();
		const environment = await new DefaultRuntimeBuilder().build({
			config: {
				sessionId: "replacement",
				providerId: "anthropic",
				modelId: "test",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: true,
			},
			onTeamEvent,
		});
		const runtime = runtimeInstance;
		const store = teamStoreInstance;
		if (!runtime || !store) throw new Error("Missing team runtime");
		expect(store.loadRuntime).not.toHaveBeenCalled();
		expect(runtime.hydrateState).not.toHaveBeenCalled();
		expect(runtime.recoverActiveRuns).not.toHaveBeenCalled();
		runtime.emit({ type: "teammate_spawned", agentId: "premature" });
		expect(onTeamEvent).not.toHaveBeenCalled();
		expect(store.persistRuntime).not.toHaveBeenCalled();
		// The resident finishes work after preparation but before activation.
		const finalSnapshot = store.loadRuntime.getMockImplementation()?.();
		if (!finalSnapshot) throw new Error("Missing persisted snapshot");
		finalSnapshot.state.teamName = "final-snapshot-after-drain";
		store.loadRuntime.mockReturnValue(finalSnapshot);
		await environment.activate?.();
		expect(runtime.hydrateState).toHaveBeenCalledWith(finalSnapshot.state);
		expect(runtime.recoverActiveRuns).toHaveBeenCalledOnce();
		await environment.activate?.();
		expect(runtime.recoverActiveRuns).toHaveBeenCalledOnce();
		await environment.shutdown("session_stop");
	});

	it("discarding an unactivated replacement never restores or persists a team", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const environment = await new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "test",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: true,
			},
		});
		await environment.shutdown("session_start_failed");
		expect(teamStoreInstance?.loadRuntime).not.toHaveBeenCalled();
		expect(teamStoreInstance?.persistRuntime).not.toHaveBeenCalled();
		expect(runtimeInstance?.recoverActiveRuns).not.toHaveBeenCalled();
	});

	it("forwards cline workspace metadata to teammate runtime bootstrap config", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		bootstrapAgentTeamsMock.mockClear();

		const environment = await new DefaultRuntimeBuilder().build({
			config: {
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4.6",
				apiKey: "key",
				systemPrompt: `Base instructions.

# Workspace Configuration
{
  "workspaces": {
    "/repo/demo": {
      "hint": "demo",
      "latestGitBranchName": "main"
    }
  }
}`,
				cwd: "/repo/demo",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: true,
			},
		});

		await environment.activate?.();
		expect(bootstrapAgentTeamsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				teammateConfigProvider: expect.objectContaining({
					getRuntimeConfig: expect.any(Function),
				}),
			}),
		);
		const clineBootstrapCall = (
			bootstrapAgentTeamsMock.mock.calls as unknown as Array<[BootstrapCall]>
		)[0]?.[0];
		expect(clineBootstrapCall).toBeDefined();
		expect(
			clineBootstrapCall?.teammateConfigProvider.getRuntimeConfig(),
		).toEqual(
			expect.objectContaining({
				providerId: "cline",
				cwd: "/repo/demo",
			}),
		);
	});
});
