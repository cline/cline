import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeammateLifecycleSpec } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDelegatedAgentConfigProvider } from "./delegated-agent";
import { HttpCloudTeammateControlPlane } from "./http-cloud-teammate-control-plane";
import {
	AgentTeamsRuntime,
	type TeamEvent,
	TeamMessageType,
} from "./multi-agent";
import { bootstrapAgentTeams, createAgentTeamsTools } from "./team-tools";

const coreBaseUrl = process.env.CLINE_CLOUD_AGENT_E2E_BASE_URL;
const coreToken = process.env.CLINE_CLOUD_AGENT_E2E_TOKEN;
const e2eRequired = process.env.CLINE_CLOUD_AGENT_E2E_REQUIRE === "1";
if (e2eRequired && (!coreBaseUrl || !coreToken)) {
	throw new Error(
		"CLINE_CLOUD_AGENT_E2E_BASE_URL and CLINE_CLOUD_AGENT_E2E_TOKEN are required",
	);
}
const selectedContents = "export const selected = true;\n";
const localSkillContents = "local review instructions\n";
const dmgContents = Buffer.from([0, 1, 2, 3, 4, 5]);

interface HydratedWorkspaceEntry {
	path: string;
	sha256: string;
	size: number;
	utf8?: string;
}

interface CoreE2EState {
	teams: Array<Record<string, unknown>>;
	nodes: Array<Record<string, unknown>>;
	runs: Array<Record<string, unknown>>;
	outcomes: Array<Record<string, unknown>>;
	capsules: Array<{
		manifest?: {
			entries?: Array<{ path?: string; purpose?: string }>;
		};
	}>;
	storage: { objectCount: number; paths: string[] };
	cloud: {
		instances: Array<{
			instanceId: string;
			state: string;
			workspace: { entries: HydratedWorkspaceEntry[] };
			securityEvidence?: unknown;
		}>;
		activeWorkspaces: number;
		deprovisioned: string[];
	};
	apiKeys: { activeCount: number };
	executor: { started: string[]; blocked: string[]; released: string[] };
}

async function coreE2EState(): Promise<CoreE2EState> {
	if (!coreBaseUrl || !coreToken) {
		throw new Error("Core cross-repository E2E environment is not configured");
	}
	const response = await fetch(new URL("/_e2e/state", coreBaseUrl), {
		headers: { Authorization: `Bearer ${coreToken}` },
	});
	if (!response.ok) {
		throw new Error(`Core E2E state failed with HTTP ${response.status}`);
	}
	const body = (await response.json()) as CoreE2EState | { data: CoreE2EState };
	return "data" in body ? body.data : body;
}

async function waitForCoreState(
	predicate: (state: CoreE2EState) => boolean,
	timeoutMs = 5_000,
): Promise<CoreE2EState> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const state = await coreE2EState();
		if (predicate(state)) return state;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(
		`Core E2E state did not satisfy predicate within ${timeoutMs}ms`,
	);
}

async function waitForCondition(
	predicate: () => boolean,
	timeoutMs = 5_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Condition was not satisfied within ${timeoutMs}ms`);
}

async function releaseCoreRun(runId: string): Promise<void> {
	if (!coreBaseUrl || !coreToken) {
		throw new Error("Core cross-repository E2E environment is not configured");
	}
	const response = await fetch(
		new URL(`/_e2e/runs/${encodeURIComponent(runId)}/release`, coreBaseUrl),
		{
			method: "POST",
			headers: { Authorization: `Bearer ${coreToken}` },
		},
	);
	if (response.status !== 204) {
		throw new Error(`Core E2E run release failed with HTTP ${response.status}`);
	}
}

function findTool(
	tools: ReturnType<typeof createAgentTeamsTools>,
	name: string,
) {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Expected ${name} tool`);
	return tool;
}

describe.skipIf(!coreBaseUrl || !coreToken)(
	"cloud teammate cross-repository HTTP lifecycle",
	() => {
		let workspace = "";
		let artifacts = "";

		beforeAll(async () => {
			workspace = await mkdtemp(
				join(tmpdir(), "cline-cloud-cross-e2e-workspace-"),
			);
			artifacts = await mkdtemp(
				join(tmpdir(), "cline-cloud-cross-e2e-artifact-"),
			);
			await mkdir(join(workspace, "src"));
			await mkdir(join(workspace, ".cline", "skills", "local-review"), {
				recursive: true,
			});
			await mkdir(join(workspace, ".git"));
			await writeFile(join(workspace, "src", "selected.ts"), selectedContents);
			await writeFile(
				join(workspace, ".cline", "skills", "local-review", "SKILL.md"),
				localSkillContents,
			);
			await writeFile(join(workspace, ".git", "config"), "local metadata\n");
			await writeFile(join(workspace, ".env"), "SECRET=never-upload\n");
			await writeFile(
				join(workspace, ".envrc"),
				"export SECRET=never-upload\n",
			);
			await writeFile(
				join(workspace, ".env.example"),
				"API_KEY=example-placeholder\n",
			);
			await writeFile(join(artifacts, "Cline.dmg"), dmgContents);
		});

		afterAll(async () => {
			await Promise.all(
				[workspace, artifacts]
					.filter(Boolean)
					.map((path) => rm(path, { recursive: true, force: true })),
			);
		});

		it("builds, uploads, survives parent disconnect, and explicitly destroys a cloud teammate", async () => {
			if (!coreBaseUrl || !coreToken) throw new Error("unreachable");
			const runSubmitAttempts: string[] = [];
			const controlPlane = new HttpCloudTeammateControlPlane({
				baseUrl: coreBaseUrl,
				headers: { Authorization: `Bearer ${coreToken}` },
				fetch: async (input, init) => {
					const target = new URL(
						typeof input === "string"
							? input
							: input instanceof URL
								? input.href
								: input.url,
					);
					if (
						init?.method === "POST" &&
						target.pathname.endsWith("/runs") &&
						typeof init.body === "string"
					) {
						const body = JSON.parse(init.body) as { runId?: unknown };
						if (typeof body.runId === "string") {
							runSubmitAttempts.push(body.runId);
						}
					}
					return await fetch(input, init);
				},
				pollIntervalMs: 10,
				provisioningPollIntervalMs: 10,
				provisioningTimeoutMs: 10_000,
				requestTimeoutMs: 5_000,
				runPollTimeoutMs: 10_000,
			});
			const teammateConfigProvider = createDelegatedAgentConfigProvider({
				providerId: "anthropic",
				modelId: "not-used-by-cloud-e2e",
			});
			const events: TeamEvent[] = [];
			const runtime = new AgentTeamsRuntime({
				teamName: `cross-e2e-${Date.now()}`,
				leadAgentId: "lead",
				onTeamEvent: (event) => events.push(event),
			});
			let activeRuntime = runtime;
			let cleaned = false;

			try {
				const tools = createAgentTeamsTools({
					runtime,
					requesterId: "lead",
					teammateConfigProvider,
					cloudTeammates: {
						enabled: true,
						controlPlane,
						initialCapsule: {
							roots: [
								{ id: "workspace", path: workspace },
								{ id: "artifacts", path: artifacts },
							],
							selections: [
								{ rootId: "workspace", path: "." },
								{
									rootId: "artifacts",
									path: "Cline.dmg",
									purpose: "artifact",
									destination: "artifacts/Cline.dmg",
								},
							],
						},
						agentConfig: {
							skills: [
								{
									name: "local-review",
									source: {
										type: "local",
										path: join(workspace, ".cline", "skills", "local-review"),
									},
								},
							],
						},
					},
				});
				const spawnResult = (await findTool(
					tools,
					"team_spawn_cloud_teammate",
				).execute(
					{ agentId: "reviewer", rolePrompt: "Inspect selected inputs" },
					{ agentId: "lead", iteration: 1, toolCallId: "cross-e2e-spawn" },
				)) as {
					agentId: string;
					status: string;
					skippedPaths: Array<{
						rootId: string;
						path: string;
						reason: string;
					}>;
				};
				expect(spawnResult).toEqual({
					agentId: "reviewer",
					status: "spawned_cloud",
					skippedPaths: [
						{ rootId: "workspace", path: ".cline", reason: "blocked_path" },
						{ rootId: "workspace", path: ".env", reason: "blocked_path" },
						{
							rootId: "workspace",
							path: ".env.example",
							reason: "blocked_path",
						},
						{ rootId: "workspace", path: ".envrc", reason: "blocked_path" },
						{ rootId: "workspace", path: ".git", reason: "blocked_path" },
					],
				});

				const spawned = events.find(
					(event) =>
						event.type === TeamMessageType.TeammateSpawned &&
						event.agentId === "reviewer",
				);
				if (!spawned || spawned.type !== TeamMessageType.TeammateSpawned) {
					throw new Error("Cloud teammate spawn event was not emitted");
				}
				const nodeId = spawned.teammate.runtimeAgentId;
				if (!nodeId) throw new Error("Cloud spawn did not return a node id");

				const provisionedState = await coreE2EState();
				expect(provisionedState.teams).toHaveLength(1);
				expect(provisionedState.nodes).toHaveLength(1);
				expect(provisionedState.capsules).toHaveLength(1);
				expect(provisionedState.storage.objectCount).toBe(1);
				expect(provisionedState.cloud.instances).toHaveLength(1);
				expect(provisionedState.cloud.activeWorkspaces).toBe(1);
				expect(provisionedState.apiKeys.activeCount).toBe(1);
				const entries = provisionedState.capsules[0]?.manifest?.entries ?? [];
				expect(entries).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ path: "src/selected.ts" }),
						expect.objectContaining({
							path: "artifacts/Cline.dmg",
							purpose: "artifact",
						}),
						expect.objectContaining({
							path: ".cline-agent-config/skills/local-review/SKILL.md",
							purpose: "artifact",
						}),
					]),
				);
				expect(entries.map((entry) => entry.path)).not.toContain(".env");
				expect(entries.map((entry) => entry.path)).not.toContain(
					".env.example",
				);
				expect(entries.map((entry) => entry.path)).not.toContain(".envrc");
				expect(entries.some((entry) => entry.path?.startsWith(".git"))).toBe(
					false,
				);
				const hydratedEntries =
					provisionedState.cloud.instances[0]?.workspace.entries ?? [];
				expect(hydratedEntries).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							path: "src/selected.ts",
							sha256: createHash("sha256")
								.update(selectedContents)
								.digest("hex"),
							size: Buffer.byteLength(selectedContents),
							utf8: selectedContents,
						}),
						expect.objectContaining({
							path: "artifacts/Cline.dmg",
							sha256: createHash("sha256").update(dmgContents).digest("hex"),
							size: dmgContents.byteLength,
						}),
						expect.objectContaining({
							path: ".cline-agent-config/skills/local-review/SKILL.md",
							sha256: createHash("sha256")
								.update(localSkillContents)
								.digest("hex"),
							size: Buffer.byteLength(localSkillContents),
							utf8: localSkillContents,
						}),
					]),
				);
				expect(hydratedEntries.some((entry) => entry.path === ".env")).toBe(
					false,
				);
				expect(
					hydratedEntries.some((entry) => entry.path.startsWith(".git")),
				).toBe(false);

				const firstRun = runtime
					.routeToTeammate("reviewer", "first deterministic task", {
						runId: "cross-e2e-run-1",
						fromAgentId: "lead",
					})
					.catch(async (error) => {
						console.error(
							`Core local E2E run state: ${JSON.stringify((await coreE2EState()).runs)}`,
						);
						throw error;
					});
				await expect(firstRun).resolves.toEqual(
					expect.objectContaining({
						text: "e2e:first deterministic task",
						finishReason: "completed",
					}),
				);
				// Core owns durable run idempotency. Repeating the same client run id
				// and body must return the existing terminal result, not execute twice.
				await expect(
					runtime.routeToTeammate("reviewer", "first deterministic task", {
						runId: "cross-e2e-run-1",
						fromAgentId: "lead",
					}),
				).resolves.toEqual(
					expect.objectContaining({ text: "e2e:first deterministic task" }),
				);
				const idempotentState = await coreE2EState();
				expect(idempotentState.runs).toHaveLength(1);
				expect(idempotentState.outcomes).toHaveLength(1);

				// Hold the durable Core execution while the parent-side request is
				// interrupted. Snapshot only after the interruption event, matching the
				// state that the production event-driven store actually persists.
				const disconnectController = new AbortController();
				const heldRun = runtime.startTeammateRun(
					"reviewer",
					"hold:disconnect durability",
					{
						signal: disconnectController.signal,
						maxRetries: 0,
					},
				);
				await waitForCoreState((state) =>
					state.executor.blocked.includes(heldRun.id),
				);
				disconnectController.abort(
					new DOMException("parent runtime disconnected", "AbortError"),
				);
				await expect(runtime.awaitRun(heldRun.id, 10)).resolves.toEqual(
					expect.objectContaining({ status: "interrupted" }),
				);
				const exportedState = runtime.exportState();
				expect(exportedState.runs).toContainEqual(
					expect.objectContaining({
						id: heldRun.id,
						status: "interrupted",
					}),
				);
				runtime.shutdownTeammate("reviewer", "parent_runtime_shutdown");
				const detachedState = await coreE2EState();
				expect(detachedState.nodes).toHaveLength(1);
				expect(detachedState.runs).toHaveLength(2);
				expect(detachedState.outcomes).toHaveLength(1);
				expect(detachedState.executor.blocked).toContain(heldRun.id);

				const restored = new AgentTeamsRuntime({
					teamName: "restored-name-is-replaced-by-hydration",
					leadAgentId: "lead",
				});
				restored.hydrateState(exportedState);
				activeRuntime = restored;
				const lifecycle: TeammateLifecycleSpec = spawned.teammate;
				const bootstrap = await bootstrapAgentTeams({
					runtime: restored,
					leadAgentId: "lead",
					teammateConfigProvider,
					restoredFromPersistence: true,
					restoredTeammates: [
						{
							agentId: "reviewer",
							rolePrompt: lifecycle.rolePrompt,
							execution: "cloud",
							cloudNodeId: nodeId,
						},
					],
					cloudTeammates: {
						enabled: true,
						controlPlane,
						initialCapsule: { roots: [], selections: [] },
					},
				});
				expect(bootstrap.restoredTeammates).toEqual(["reviewer"]);
				expect(bootstrap.failedRestoredTeammates).toEqual([]);
				expect(restored.recoverActiveRuns("parent_reconnected")).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ id: heldRun.id, status: "queued" }),
					]),
				);
				await waitForCondition(
					() =>
						runSubmitAttempts.filter((runId) => runId === heldRun.id).length >=
						2,
				);
				await releaseCoreRun(heldRun.id);
				await expect(restored.awaitRun(heldRun.id, 10)).resolves.toEqual(
					expect.objectContaining({ id: heldRun.id, status: "completed" }),
				);
				const durableState = await coreE2EState();
				expect(durableState.teams).toHaveLength(1);
				expect(durableState.nodes).toHaveLength(1);
				expect(durableState.capsules).toHaveLength(1);
				expect(durableState.runs).toHaveLength(2);
				expect(durableState.outcomes).toHaveLength(2);
				expect(durableState.executor.released).toContain(heldRun.id);

				await findTool(bootstrap.tools, "team_cleanup").execute(
					{},
					{ agentId: "lead", iteration: 2, toolCallId: "cross-e2e-cleanup" },
				);
				cleaned = true;
				const cleanedState = await coreE2EState();
				expect(cleanedState.teams).toEqual([]);
				expect(cleanedState.nodes).toEqual([]);
				expect(cleanedState.runs).toEqual([]);
				expect(cleanedState.outcomes).toEqual([]);
				expect(cleanedState.capsules).toEqual([]);
				expect(cleanedState.storage.objectCount).toBe(0);
				expect(cleanedState.cloud.instances).toEqual([]);
				expect(cleanedState.cloud.activeWorkspaces).toBe(0);
				expect(cleanedState.cloud.deprovisioned.length).toBeGreaterThan(0);
				expect(cleanedState.apiKeys.activeCount).toBe(0);
			} finally {
				if (!cleaned)
					await activeRuntime.cleanupAndWait().catch(() => undefined);
			}
		}, 30_000);
	},
);
