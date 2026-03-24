import { resolveTeamDataDir } from "@clinebot/shared/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTeamsRuntime } from "./multi-agent";
import { createAgentTeamsTools } from "./team-tools";

type EnvSnapshot = {
	CLINE_DATA_DIR: string | undefined;
	CLINE_TEAM_DATA_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_TEAM_DATA_DIR: process.env.CLINE_TEAM_DATA_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_TEAM_DATA_DIR = snapshot.CLINE_TEAM_DATA_DIR;
}

describe("resolveTeamDataDir", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("uses CLINE_TEAM_DATA_DIR when set", () => {
		snapshot = captureEnv();
		process.env.CLINE_TEAM_DATA_DIR = "/tmp/team-dir";
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		expect(resolveTeamDataDir()).toBe("/tmp/team-dir");
	});

	it("falls back to CLINE_DATA_DIR/teams", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_TEAM_DATA_DIR;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		expect(resolveTeamDataDir()).toBe("/tmp/cline-data/teams");
	});
});

describe("createAgentTeamsTools schema surface", () => {
	it("exposes strict object schemas for split team tools", () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});

		const spawn = tools.find((tool) => tool.name === "team_spawn_teammate");
		const createTask = tools.find((tool) => tool.name === "team_create_task");
		const send = tools.find((tool) => tool.name === "team_send_message");
		const createOutcome = tools.find(
			(tool) => tool.name === "team_create_outcome",
		);
		const teamAwaitRun = tools.find((tool) => tool.name === "team_await_run");
		const teamLogUpdate = tools.find((tool) => tool.name === "team_log_update");

		expect(spawn?.inputSchema.type).toBe("object");
		expect(createTask?.inputSchema.type).toBe("object");
		expect(send?.inputSchema.type).toBe("object");
		expect(createOutcome?.inputSchema.type).toBe("object");
		expect(teamAwaitRun?.inputSchema.type).toBe("object");
		const schema = teamLogUpdate?.inputSchema as
			| { properties: Record<string, unknown>; required: unknown[] }
			| undefined;
		expect(schema?.properties.kind).toEqual({
			type: "string",
			enum: ["progress", "handoff", "blocked", "decision", "done", "error"],
		});
		expect(schema?.required).toEqual(["kind", "summary"]);
	});

	it("rejects extra fields for strict spawn schema", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const spawn = tools.find((tool) => tool.name === "team_spawn_teammate");
		expect(spawn).toBeDefined();

		await expect(
			spawn?.execute(
				{
					agentId: "python-poet",
					rolePrompt: "Write concise Python-focused haiku",
					action: "spawn",
				},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow("Unrecognized key");
	});

	it("rejects non-object payloads for task tools", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const createTask = tools.find((tool) => tool.name === "team_create_task");
		expect(createTask).toBeDefined();

		await expect(
			createTask?.execute(["create", "task"], {
				agentId: "lead",
				conversationId: "conv-1",
				iteration: 1,
			}),
		).rejects.toThrow("expected object");
	});

	it("rejects null placeholders for required fields", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const completeTask = tools.find(
			(tool) => tool.name === "team_complete_task",
		);
		expect(completeTask).toBeDefined();

		await expect(
			completeTask?.execute(
				{
					taskId: "task_0001",
					summary: null,
				},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow("expected string");
	});

	it("rejects null placeholders for optional fields", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const createTask = tools.find((tool) => tool.name === "team_create_task");
		expect(createTask).toBeDefined();

		await expect(
			createTask?.execute(
				{
					title: "Investigate llms boundaries",
					description: "Deep dive models and providers",
					dependsOn: null,
				},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow("expected array");
	});

	it("defaults requiredSections for team_create_outcome", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const createOutcome = tools.find(
			(tool) => tool.name === "team_create_outcome",
		);
		expect(createOutcome).toBeDefined();

		await expect(
			createOutcome?.execute(
				{
					title: "LLMS boundary redesign",
				},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).resolves.toMatchObject({
			outcomeId: expect.stringMatching(/^out_/),
			status: "draft",
		});

		const outcomes = runtime.listOutcomes();
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0]?.requiredSections).toEqual([
			"current_state",
			"boundary_analysis",
			"interface_proposal",
		]);
	});

	it("can list outcomes via dedicated list tool", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const createOutcome = tools.find(
			(tool) => tool.name === "team_create_outcome",
		);
		const listOutcomes = tools.find(
			(tool) => tool.name === "team_list_outcomes",
		);
		expect(createOutcome).toBeDefined();
		expect(listOutcomes).toBeDefined();

		await createOutcome?.execute(
			{ title: "LLMS redesign" },
			{
				agentId: "lead",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		await expect(
			listOutcomes?.execute(
				{},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: expect.any(String),
				}),
			]),
		);
	});
});

describe("createAgentTeamsTools runtime behavior", () => {
	it("forwards teammateRuntime headers when spawning teammates", async () => {
		const spawnTeammate = vi.fn();
		const runtime = {
			getMemberRole: vi.fn(() => "lead"),
			isTeammateActive: vi.fn(() => false),
			spawnTeammate,
		} as unknown as AgentTeamsRuntime;

		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4.6",
				headers: { Authorization: "Bearer token" },
			},
			createBaseTools: () => [],
		});
		const spawnTool = tools.find((tool) => tool.name === "team_spawn_teammate");
		expect(spawnTool).toBeDefined();

		await spawnTool?.execute(
			{
				agentId: "investigator",
				rolePrompt: "Investigate code boundaries",
			},
			{
				agentId: "lead",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(spawnTeammate).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					headers: { Authorization: "Bearer token" },
				}),
			}),
		);
	});

	it("injects workspace metadata into cline teammate system prompt", async () => {
		const spawnTeammate = vi.fn();
		const runtime = {
			getMemberRole: vi.fn(() => "lead"),
			isTeammateActive: vi.fn(() => false),
			spawnTeammate,
		} as unknown as AgentTeamsRuntime;

		const workspaceMetadata = `# Workspace Configuration
{
  "workspaces": {
    "/repo/app": {
      "hint": "app",
      "latestGitBranchName": "main"
    }
  }
}`;

		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4.6",
				cwd: "/repo/app",
				clineWorkspaceMetadata: workspaceMetadata,
			},
		});
		const spawnTool = tools.find((tool) => tool.name === "team_spawn_teammate");
		expect(spawnTool).toBeDefined();

		await spawnTool?.execute(
			{
				agentId: "researcher",
				rolePrompt: "Investigate runtime boundary regressions.",
			},
			{
				agentId: "lead",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(spawnTeammate).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					systemPrompt: expect.stringContaining(workspaceMetadata),
				}),
			}),
		);
		expect(spawnTeammate).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					systemPrompt: expect.stringContaining(
						"# Team Teammate Role\nInvestigate runtime boundary regressions.",
					),
				}),
			}),
		);
	});

	it("throws from team_await_run when async delegated run fails", async () => {
		const runtime = {
			awaitRun: vi.fn(async () => ({
				id: "run_0001",
				status: "failed",
				error: "Authentication failed",
			})),
		} as unknown as AgentTeamsRuntime;

		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const awaitRun = tools.find((tool) => tool.name === "team_await_run");
		expect(awaitRun).toBeDefined();

		await expect(
			awaitRun?.execute(
				{ runId: "run_0001" },
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow('Run "run_0001" failed: Authentication failed');
	});

	it("throws from team_await_all_runs when any delegated run is not successful", async () => {
		const runtime = {
			awaitAllRuns: vi.fn(async () => [
				{ id: "run_ok", status: "completed" },
				{ id: "run_bad", status: "failed", error: "Auth expired" },
			]),
		} as unknown as AgentTeamsRuntime;

		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const awaitAllRuns = tools.find(
			(tool) => tool.name === "team_await_all_runs",
		);
		expect(awaitAllRuns).toBeDefined();

		await expect(
			awaitAllRuns?.execute(
				{},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow(
			"One or more runs did not complete successfully: run_bad:failed(Auth expired)",
		);
	});

	it("returns compact summaries from team_await_run without full teammate transcripts", async () => {
		const runtime = {
			awaitRun: vi.fn(async () => ({
				id: "run_0001",
				agentId: "models-investigator",
				status: "completed",
				message:
					"Investigate the models directory and summarize the boundaries",
				priority: 0,
				retryCount: 0,
				maxRetries: 0,
				startedAt: new Date("2026-03-24T09:00:00.000Z"),
				endedAt: new Date("2026-03-24T09:01:00.000Z"),
				lastProgressAt: new Date("2026-03-24T09:00:59.000Z"),
				lastProgressMessage: "completed",
				currentActivity: "completed",
				result: {
					text: "Models are the public catalog and provider files are provider-specific defaults.",
					usage: {
						inputTokens: 1200,
						outputTokens: 300,
						cacheReadTokens: 900,
						cacheWriteTokens: 120,
						totalCost: 0.12,
					},
					messages: [{ role: "user", content: "huge transcript omitted" }],
					toolCalls: [{ name: "read_file", input: {}, output: "omitted" }],
					iterations: 3,
					finishReason: "completed",
					model: { id: "claude-sonnet-4-5-20250929", provider: "anthropic" },
					startedAt: new Date("2026-03-24T09:00:00.000Z"),
					endedAt: new Date("2026-03-24T09:01:00.000Z"),
					durationMs: 60_000,
				},
			})),
		} as unknown as AgentTeamsRuntime;

		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const awaitRun = tools.find((tool) => tool.name === "team_await_run");

		await expect(
			awaitRun?.execute(
				{ runId: "run_0001" },
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).resolves.toEqual({
			id: "run_0001",
			agentId: "models-investigator",
			status: "completed",
			messagePreview:
				"Investigate the models directory and summarize the boundaries",
			priority: 0,
			retryCount: 0,
			maxRetries: 0,
			startedAt: new Date("2026-03-24T09:00:00.000Z"),
			endedAt: new Date("2026-03-24T09:01:00.000Z"),
			lastProgressAt: new Date("2026-03-24T09:00:59.000Z"),
			lastProgressMessage: "completed",
			currentActivity: "completed",
			resultSummary: {
				textPreview:
					"Models are the public catalog and provider files are provider-specific defaults.",
				iterations: 3,
				finishReason: "completed",
				durationMs: 60_000,
				usage: {
					inputTokens: 1200,
					outputTokens: 300,
					cacheReadTokens: 900,
					cacheWriteTokens: 120,
					totalCost: 0.12,
				},
			},
		});
	});

	it("returns compact summaries from team_list_runs", async () => {
		const runtime = {
			listRuns: vi.fn(() => [
				{
					id: "run_0001",
					agentId: "providers-investigator",
					status: "running",
					message: "Investigate providers directory in detail",
					priority: 0,
					retryCount: 0,
					maxRetries: 0,
					startedAt: new Date("2026-03-24T09:00:00.000Z"),
					lastProgressAt: new Date("2026-03-24T09:00:30.000Z"),
					lastProgressMessage: "reading files",
					currentActivity: "reading_files",
				},
			]),
		} as unknown as AgentTeamsRuntime;

		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const listRuns = tools.find((tool) => tool.name === "team_list_runs");

		await expect(
			listRuns?.execute(
				{},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).resolves.toEqual([
			{
				id: "run_0001",
				agentId: "providers-investigator",
				status: "running",
				messagePreview: "Investigate providers directory in detail",
				priority: 0,
				retryCount: 0,
				maxRetries: 0,
				startedAt: new Date("2026-03-24T09:00:00.000Z"),
				lastProgressAt: new Date("2026-03-24T09:00:30.000Z"),
				lastProgressMessage: "reading files",
				currentActivity: "reading_files",
				resultSummary: undefined,
			},
		]);
	});

	it("sets long timeout for team await tools", () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const awaitRun = tools.find((tool) => tool.name === "team_await_run");
		const awaitAllRuns = tools.find(
			(tool) => tool.name === "team_await_all_runs",
		);
		expect(awaitRun?.timeoutMs).toBe(60 * 60 * 1000);
		expect(awaitAllRuns?.timeoutMs).toBe(60 * 60 * 1000);
	});

	it("lists ready-to-claim tasks through team_list_tasks", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const createTask = tools.find((tool) => tool.name === "team_create_task");
		const listTasks = tools.find((tool) => tool.name === "team_list_tasks");
		expect(createTask).toBeDefined();
		expect(listTasks).toBeDefined();

		const first = (await createTask?.execute(
			{
				title: "Ready task",
				description: "Claim immediately",
			},
			{
				agentId: "lead",
				conversationId: "conv-1",
				iteration: 1,
			},
		)) as { taskId: string };
		await createTask?.execute(
			{
				title: "Blocked task",
				description: "Wait on dependency",
				dependsOn: [first.taskId],
			},
			{
				agentId: "lead",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		await expect(
			listTasks?.execute(
				{ readyOnly: true },
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).resolves.toEqual([
			expect.objectContaining({
				id: first.taskId,
				isReady: true,
				blockedBy: [],
			}),
		]);
	});
});
