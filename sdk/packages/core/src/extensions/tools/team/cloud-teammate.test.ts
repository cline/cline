import { createHash } from "node:crypto";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentResult } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	CloudTeammateControlPlane,
	CloudTeammateProvisionInput,
	CloudTeammateRunInput,
} from "./cloud-teammate";
import { createDelegatedAgentConfigProvider } from "./delegated-agent";
import { AgentTeamsRuntime } from "./multi-agent";
import { bootstrapAgentTeams, createAgentTeamsTools } from "./team-tools";

const temporaryDirectories: string[] = [];

async function temporaryWorkspace(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "cline-cloud-team-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

function result(text: string): AgentResult {
	const startedAt = new Date();
	return {
		text,
		usage: { inputTokens: 1, outputTokens: 1, totalCost: 0 },
		messages: [],
		toolCalls: [],
		iterations: 1,
		finishReason: "completed",
		model: { id: "fake-cloud", provider: "fake-core" },
		startedAt,
		endedAt: new Date(),
		durationMs: 1,
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("cloud teammate Teams integration", () => {
	it("adds explicitly selected local agent config to the immutable capsule", async () => {
		const workspace = await temporaryWorkspace();
		const skill = join(workspace, ".cline", "skills", "local-review");
		await mkdir(skill, { recursive: true });
		await writeFile(join(workspace, "source.ts"), "export {};\n");
		await writeFile(join(skill, "SKILL.md"), "local instructions\n");
		let provisionInput: CloudTeammateProvisionInput | undefined;
		const controlPlane: CloudTeammateControlPlane = {
			provisionTeammate: vi.fn(async (input) => {
				provisionInput = input;
				await readFile(input.initialCapsule.archivePath);
				return { nodeId: "cnd-config" };
			}),
			reattachTeammate: vi.fn(async (input) => ({ nodeId: input.nodeId })),
			runTeammateTask: vi.fn(async () => result("unused")),
			destroyTeammate: vi.fn(async () => undefined),
		};
		const runtime = new AgentTeamsRuntime({ teamName: "local-config" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateConfigProvider: createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "unused",
			}),
			cloudTeammates: {
				enabled: true,
				controlPlane,
				initialCapsule: {
					roots: [{ id: "workspace", path: workspace }],
					selections: [{ rootId: "workspace", path: "source.ts" }],
				},
				agentConfig: {
					skills: [
						{ name: "local-review", source: { type: "local", path: skill } },
					],
				},
			},
		});
		await tools
			.find((tool) => tool.name === "team_spawn_cloud_teammate")
			?.execute(
				{ agentId: "reviewer", rolePrompt: "Review" },
				{ agentId: "lead", iteration: 1 },
			);

		expect(provisionInput?.agentConfig).toEqual({
			extensions: {
				skills: [
					{
						name: "local-review",
						source: {
							type: "capsule",
							path: ".cline-agent-config/skills/local-review",
						},
					},
				],
				rules: [],
			},
		});
		expect(provisionInput?.initialCapsule.manifest.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: ".cline-agent-config/skills/local-review/SKILL.md",
				}),
			]),
		);
	});

	it("builds only the parent-selected capsule and runs through existing team runs", async () => {
		const workspace = await temporaryWorkspace();
		await writeFile(join(workspace, "selected.txt"), "selected\n");
		await writeFile(join(workspace, "not-selected.txt"), "private\n");

		let provisionInput: CloudTeammateProvisionInput | undefined;
		let uploadedArchive: Buffer | undefined;
		const runInputs: CloudTeammateRunInput[] = [];
		const controlPlane: CloudTeammateControlPlane = {
			provisionTeammate: vi.fn(async (input) => {
				provisionInput = input;
				uploadedArchive = await readFile(input.initialCapsule.archivePath);
				return { nodeId: "cnd-local-fake" };
			}),
			reattachTeammate: vi.fn(async (input) => ({ nodeId: input.nodeId })),
			runTeammateTask: vi.fn(async (input) => {
				runInputs.push(input);
				return result(`cloud:${input.message}`);
			}),
			destroyTeammate: vi.fn(async () => undefined),
		};
		const runtime = new AgentTeamsRuntime({ teamName: "local-cloud-test" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateConfigProvider: createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "unused-for-cloud",
			}),
			cloudTeammates: {
				enabled: true,
				controlPlane,
				initialCapsule: {
					roots: [{ id: "workspace", path: workspace }],
					selections: [{ rootId: "workspace", path: "selected.txt" }],
				},
			},
		});

		const spawn = tools.find(
			(tool) => tool.name === "team_spawn_cloud_teammate",
		);
		expect(spawn).toBeDefined();
		await expect(
			spawn?.execute(
				{ agentId: "reviewer", rolePrompt: "Review the selected source" },
				{ agentId: "lead", conversationId: "conv-1", iteration: 1 },
			),
		).resolves.toEqual({
			agentId: "reviewer",
			status: "spawned_cloud",
			skippedPaths: [],
		});

		expect(provisionInput?.initialCapsule.manifest.entries).toEqual([
			expect.objectContaining({ path: "selected.txt", kind: "file" }),
		]);
		expect(provisionInput?.initialCapsule.manifest.git).toBeUndefined();
		expect(provisionInput?.initialCapsule.manifest.team).toEqual({
			teamId: runtime.getTeamId(),
			agentId: "reviewer",
		});
		expect(uploadedArchive).toBeDefined();
		expect(createHash("sha256").update(uploadedArchive!).digest("hex")).toBe(
			provisionInput?.initialCapsule.metadata.sha256,
		);
		await expect(
			access(provisionInput!.initialCapsule.archivePath),
		).rejects.toThrow();

		const task = runtime.createTask({
			title: "Review",
			description: "Review selected source",
			createdBy: "lead",
			assignee: "reviewer",
		});
		const runTool = tools.find((tool) => tool.name === "team_run_task");
		const runResponse = await runTool?.execute(
			{
				agentId: "reviewer",
				task: "Review now",
				taskId: task.id,
				runMode: "async",
			},
			{ agentId: "lead", conversationId: "conv-1", iteration: 2 },
		);
		const runId = (runResponse as { runId: string }).runId;
		await expect(runtime.awaitRun(runId, 1)).resolves.toEqual(
			expect.objectContaining({ status: "completed", taskId: task.id }),
		);
		expect(runInputs).toEqual([
			expect.objectContaining({
				teamId: runtime.getTeamId(),
				nodeId: "cnd-local-fake",
				agentId: "reviewer",
				runId,
				taskId: task.id,
				message: "Review now",
			}),
		]);
	});

	it("exposes no cloud capability without one-time parent enablement", () => {
		const tools = createAgentTeamsTools({
			runtime: new AgentTeamsRuntime({ teamName: "local-only" }),
			requesterId: "lead",
			teammateConfigProvider: createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "local",
			}),
		});
		expect(
			tools.some((tool) => tool.name === "team_spawn_cloud_teammate"),
		).toBe(false);
	});

	it("awaits node destruction and still escalates later team cleanup", async () => {
		const workspace = await temporaryWorkspace();
		await writeFile(join(workspace, "source.ts"), "export {};\n");
		let releaseDestroy: (() => void) | undefined;
		const destroyTeammate = vi.fn((input: { reason?: string }) =>
			input.reason === "explicit_teammate_shutdown"
				? new Promise<void>((resolve) => {
						releaseDestroy = resolve;
					})
				: Promise.resolve(),
		);
		const controlPlane: CloudTeammateControlPlane = {
			provisionTeammate: async (input) => {
				await readFile(input.initialCapsule.archivePath);
				return { nodeId: "cnd-destroy" };
			},
			reattachTeammate: vi.fn(async (input) => ({ nodeId: input.nodeId })),
			runTeammateTask: async () => result("unused"),
			destroyTeammate,
		};
		const runtime = new AgentTeamsRuntime({ teamName: "destroy-test" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateConfigProvider: createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "unused",
			}),
			cloudTeammates: {
				enabled: true,
				controlPlane,
				initialCapsule: {
					roots: [{ id: "workspace", path: workspace }],
					selections: [{ rootId: "workspace", path: "source.ts" }],
				},
			},
		});
		await tools
			.find((tool) => tool.name === "team_spawn_cloud_teammate")
			?.execute(
				{ agentId: "builder", rolePrompt: "Build" },
				{ agentId: "lead", conversationId: "conv", iteration: 1 },
			);
		runtime.shutdownTeammate("builder", "cli_run_shutdown");
		expect(destroyTeammate).not.toHaveBeenCalled();

		const shutdownPromise = tools
			.find((tool) => tool.name === "team_shutdown_teammate")
			?.execute(
				{ agentId: "builder", reason: "cli_run_shutdown" },
				{ agentId: "lead", conversationId: "conv", iteration: 2 },
			) as Promise<unknown>;
		let settled = false;
		void shutdownPromise.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		releaseDestroy?.();
		await shutdownPromise;
		expect(destroyTeammate).toHaveBeenCalledTimes(1);
		expect(destroyTeammate).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "explicit_teammate_shutdown" }),
		);
		expect(runtime.getSnapshot().members).toContainEqual(
			expect.objectContaining({ agentId: "builder", status: "stopped" }),
		);

		await runtime.cleanupAndWait();
		expect(destroyTeammate).toHaveBeenCalledTimes(2);
		expect(destroyTeammate).toHaveBeenLastCalledWith(
			expect.objectContaining({ reason: "team_cleanup" }),
		);
	});

	it("rejects concurrent cloud spawns for the same agent before provisioning twice", async () => {
		const workspace = await temporaryWorkspace();
		await writeFile(join(workspace, "source.ts"), "export {};\n");
		let releaseProvision: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			releaseProvision = resolve;
		});
		const provisionTeammate = vi.fn(
			async (input: CloudTeammateProvisionInput) => {
				await readFile(input.initialCapsule.archivePath);
				await gate;
				return { nodeId: "cnd-single" };
			},
		);
		const runtime = new AgentTeamsRuntime({ teamName: "spawn-race" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateConfigProvider: createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "unused",
			}),
			cloudTeammates: {
				enabled: true,
				controlPlane: {
					provisionTeammate,
					reattachTeammate: vi.fn(async (input) => ({ nodeId: input.nodeId })),
					runTeammateTask: vi.fn(),
					destroyTeammate: vi.fn(),
				},
				initialCapsule: {
					roots: [{ id: "workspace", path: workspace }],
					selections: [{ rootId: "workspace", path: "source.ts" }],
				},
			},
		});
		const spawn = tools.find(
			(tool) => tool.name === "team_spawn_cloud_teammate",
		);
		if (!spawn) throw new Error("Expected cloud spawn tool");
		const context = { agentId: "lead", iteration: 1 };
		const first = spawn.execute(
			{ agentId: "builder", rolePrompt: "Build" },
			context,
		);
		await vi.waitFor(() => expect(provisionTeammate).toHaveBeenCalledTimes(1));
		await expect(
			spawn.execute({ agentId: "builder", rolePrompt: "Build again" }, context),
		).rejects.toThrow("already being provisioned");
		expect(provisionTeammate).toHaveBeenCalledTimes(1);
		releaseProvision?.();
		await first;
	});

	it("releases process-local busy state after client polling is aborted", async () => {
		const workspace = await temporaryWorkspace();
		await writeFile(join(workspace, "source.ts"), "export {};\n");
		let attempts = 0;
		const controlPlane: CloudTeammateControlPlane = {
			provisionTeammate: vi.fn(async (input) => {
				await readFile(input.initialCapsule.archivePath);
				return { nodeId: "cnd-abort" };
			}),
			reattachTeammate: vi.fn(async (input) => ({ nodeId: input.nodeId })),
			runTeammateTask: vi.fn((input: CloudTeammateRunInput) => {
				attempts++;
				if (attempts > 1) return Promise.resolve(result("cloud:second run"));
				return new Promise<AgentResult>((_, reject) => {
					input.signal?.addEventListener(
						"abort",
						() => reject(input.signal?.reason),
						{ once: true },
					);
				});
			}),
			destroyTeammate: vi.fn(),
		};
		const runtime = new AgentTeamsRuntime({ teamName: "abort-safe" });
		const spawn = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateConfigProvider: createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "unused",
			}),
			cloudTeammates: {
				enabled: true,
				controlPlane,
				initialCapsule: {
					roots: [{ id: "workspace", path: workspace }],
					selections: [{ rootId: "workspace", path: "source.ts" }],
				},
			},
		}).find((tool) => tool.name === "team_spawn_cloud_teammate");
		if (!spawn) throw new Error("Expected cloud spawn tool");
		await spawn.execute(
			{ agentId: "builder", rolePrompt: "Build" },
			{ agentId: "lead", iteration: 1 },
		);

		const controller = new AbortController();
		const firstRun = runtime.routeToTeammate("builder", "work", {
			signal: controller.signal,
		});
		await vi.waitFor(() =>
			expect(controlPlane.runTeammateTask).toHaveBeenCalledTimes(1),
		);
		controller.abort(new DOMException("stop polling", "AbortError"));
		await expect(firstRun).rejects.toThrow("stop polling");
		await expect(
			runtime.routeToTeammate("builder", "second run"),
		).resolves.toEqual(expect.objectContaining({ text: "cloud:second run" }));
	});

	it("reattaches a persisted cloud node and resumes its queued run without reprovisioning", async () => {
		const original = new AgentTeamsRuntime({ teamName: "durable-team" });
		const persistedTeamId = original.getTeamId();
		const persisted = original.exportState();
		persisted.members.push({
			agentId: "durable-reviewer",
			role: "teammate",
			description: "Continue review",
			status: "running",
		});
		persisted.runs.push({
			id: "run_00001",
			agentId: "durable-reviewer",
			taskId: "task_0001",
			status: "queued",
			message: "Continue after disconnect",
			priority: 0,
			retryCount: 0,
			maxRetries: 0,
			startedAt: new Date(0),
			lastProgressAt: new Date(),
			lastProgressMessage: "queued",
			currentActivity: "queued",
		});

		const provisionTeammate = vi.fn();
		const runTeammateTask = vi.fn(async (input: CloudTeammateRunInput) =>
			result(`resumed:${input.message}`),
		);
		const controlPlane: CloudTeammateControlPlane = {
			provisionTeammate,
			reattachTeammate: vi.fn(async (input) => ({ nodeId: input.nodeId })),
			runTeammateTask,
			destroyTeammate: vi.fn(async () => undefined),
		};
		const restored = new AgentTeamsRuntime({ teamName: "durable-team" });
		restored.hydrateState(persisted);
		const configuration = {
			enabled: true as const,
			controlPlane,
			initialCapsule: { roots: [], selections: [] },
		};
		const bootstrap = await bootstrapAgentTeams({
			runtime: restored,
			teammateConfigProvider: createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "unused",
			}),
			restoredFromPersistence: true,
			restoredTeammates: [
				{
					agentId: "durable-reviewer",
					rolePrompt: "Continue review",
					execution: "cloud",
					cloudNodeId: "cnd-existing",
				},
			],
			cloudTeammates: configuration,
		});

		expect(restored.getTeamId()).toBe(persistedTeamId);
		expect(bootstrap.restoredTeammates).toEqual(["durable-reviewer"]);
		expect(bootstrap.failedRestoredTeammates).toEqual([]);
		expect(provisionTeammate).not.toHaveBeenCalled();
		restored.recoverActiveRuns("parent_reconnected");
		await expect(restored.awaitRun("run_00001", 1)).resolves.toEqual(
			expect.objectContaining({ status: "completed" }),
		);
		expect(runTeammateTask).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: persistedTeamId,
				nodeId: "cnd-existing",
				agentId: "durable-reviewer",
				runId: "run_00001",
				taskId: "task_0001",
				message: "Continue after disconnect",
			}),
		);
		expect(provisionTeammate).not.toHaveBeenCalled();
	});

	it("keeps the parent session usable when a persisted cloud node cannot reattach", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "durable-team" });
		const persisted = runtime.exportState();
		persisted.members.push({
			agentId: "stale-reviewer",
			role: "teammate",
			description: "Stale cloud reviewer",
			status: "running",
		});
		runtime.hydrateState(persisted);
		const controlPlane: CloudTeammateControlPlane = {
			provisionTeammate: vi.fn(),
			reattachTeammate: vi.fn(async () => {
				throw new Error("node is offline");
			}),
			runTeammateTask: vi.fn(),
			destroyTeammate: vi.fn(),
		};

		const bootstrap = await bootstrapAgentTeams({
			runtime,
			teammateConfigProvider: createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "unused",
			}),
			restoredFromPersistence: true,
			restoredTeammates: [
				{
					agentId: "stale-reviewer",
					rolePrompt: "Stale cloud reviewer",
					execution: "cloud",
					cloudNodeId: "cnd-stale",
				},
			],
			cloudTeammates: {
				enabled: true,
				controlPlane,
				initialCapsule: { roots: [], selections: [] },
			},
		});

		expect(bootstrap.restoredTeammates).toEqual([]);
		expect(bootstrap.failedRestoredTeammates).toEqual(["stale-reviewer"]);
		expect(runtime.getSnapshot().members).toContainEqual(
			expect.objectContaining({ agentId: "stale-reviewer", status: "stopped" }),
		);
	});
});
