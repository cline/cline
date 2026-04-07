import { describe, expect, it, vi } from "vitest";

const createBuiltinToolsMock = vi.fn(() => []);
const bootstrapAgentTeamsMock = vi.fn(() => ({
	tools: [],
	restoredFromPersistence: true,
	restoredTeammates: ["restored-1"],
}));

let runtimeInstance: MockAgentTeamsRuntime | undefined;
class MockAgentTeamsRuntime {
	private readonly onTeamEvent?: (event: any) => void;

	constructor(options: { onTeamEvent?: (event: any) => void }) {
		this.onTeamEvent = options.onTeamEvent;
		runtimeInstance = this;
	}

	emit(event: any): void {
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
	getTeammateIds = vi.fn(() => []);
	shutdownTeammate = vi.fn();
}

vi.mock("../team", () => ({
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

vi.mock("../default-tools", () => ({
	ALL_DEFAULT_TOOL_NAMES: [],
	createBuiltinTools: createBuiltinToolsMock,
	ToolPresets: {
		development: {},
		readonly: {},
	},
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
		interruptedRunIds: ["run_00001"],
	}));
	handleTeamEvent = vi.fn();
	persistRuntime = vi.fn();
}

vi.mock("../storage/team-store", () => ({
	createLocalTeamStore: () => new MockTeamStore(),
}));

describe("DefaultRuntimeBuilder team persistence boundary", () => {
	it("persists teammate specs and runtime state from team events", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const onTeamRestored = vi.fn();

		await new DefaultRuntimeBuilder().build({
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

		expect(bootstrapAgentTeamsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				restoredFromPersistence: true,
				restoredTeammates: [expect.objectContaining({ agentId: "restored-1" })],
				teammateConfigProvider: expect.objectContaining({
					getRuntimeConfig: expect.any(Function),
				}),
			}),
		);
		const bootstrapCall = (
			bootstrapAgentTeamsMock.mock.calls as unknown as Array<
				[Record<string, any>]
			>
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

		expect(runtimeInstance.markStaleRunsInterrupted).toHaveBeenCalledWith(
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
	});

	it("forwards cline workspace metadata to teammate runtime bootstrap config", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		bootstrapAgentTeamsMock.mockClear();

		await new DefaultRuntimeBuilder().build({
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

		expect(bootstrapAgentTeamsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				teammateConfigProvider: expect.objectContaining({
					getRuntimeConfig: expect.any(Function),
				}),
			}),
		);
		const clineBootstrapCall = (
			bootstrapAgentTeamsMock.mock.calls as unknown as Array<
				[Record<string, any>]
			>
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
