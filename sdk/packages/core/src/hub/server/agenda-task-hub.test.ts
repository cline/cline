import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	HubEventEnvelope,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { z } from "zod";

vi.mock("@ai-sdk/provider-utils", () => ({
	createProviderDefinedToolFactory: vi.fn(() => vi.fn()),
}));

const fsWatchSpy = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	fsWatchSpy.mockImplementation(actual.watch as never);
	return { ...actual, watch: fsWatchSpy };
});

import type {
	StartSessionInput,
	StartSessionResult,
} from "../../runtime/host/runtime-host";
import { SessionNotFoundError } from "../../runtime/host/runtime-host";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
} from "../../tasks/agenda-task-manager";
import { HubServerTransport } from "./hub-server-transport";

describe("Hub agenda task vertical slice", () => {
	it("runs ordinary tasks and propagates isolated feature session policies through the Hub", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-agenda-"));
		const chatWorkspace = join(root, "chat-workspace");
		mkdirSync(chatWorkspace);
		const canonicalChatWorkspace = realpathSync.native(chatWorkspace);
		// Agent-created schedules anchor in the ~/.cline/schedules home; point
		// the Cline dir at the test root so that home stays inside this test.
		// Restore via onTestFinished so an early throw (before the try below)
		// cannot leave the override behind for later tests in this worker.
		const clineHome = join(root, "cline-home");
		mkdirSync(clineHome);
		const previousClineDir = process.env.CLINE_DIR;
		process.env.CLINE_DIR = clineHome;
		onTestFinished(() => {
			if (previousClineDir === undefined) {
				delete process.env.CLINE_DIR;
			} else {
				process.env.CLINE_DIR = previousClineDir;
			}
		});
		const sessions = new Map<string, Record<string, unknown>>();
		let capturedStart: StartSessionInput | undefined;
		const capturedStarts: StartSessionInput[] = [];
		let requestToolApproval:
			| ((
					request: ToolApprovalRequest,
			  ) => Promise<ToolApprovalResult> | ToolApprovalResult)
			| undefined;
		const startSession = vi.fn(
			async (input: StartSessionInput): Promise<StartSessionResult> => {
				capturedStart = input;
				capturedStarts.push(input);
				requestToolApproval = input.capabilities?.requestToolApproval;
				const sessionId = input.config.sessionId ?? "task-session";
				const workspaceRoot =
					input.config.workspaceRoot ?? join(root, "chat-workspace");
				sessions.set(sessionId, {
					sessionId,
					source: "core",
					status: "running",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					interactive: input.interactive === true,
					provider: input.config.providerId,
					model: input.config.modelId,
					cwd: input.config.cwd ?? workspaceRoot,
					workspaceRoot,
					enableTools: true,
					enableSpawn: true,
					enableTeams: true,
					isSubagent: false,
					metadata: input.sessionMetadata,
				});
				return {
					sessionId,
					manifest: {
						version: 1,
						session_id: sessionId,
						source: "core",
						pid: 1,
						started_at: new Date().toISOString(),
						status: "running",
						interactive: input.interactive === true,
						provider: input.config.providerId,
						model: input.config.modelId,
						cwd: input.config.cwd ?? workspaceRoot,
						workspace_root: workspaceRoot,
						enable_tools: true,
						enable_spawn: true,
						enable_teams: true,
					},
					manifestPath: "",
					messagesPath: "",
				};
			},
		);
		const runTurn = vi.fn(async () => {
			if (capturedStart?.sessionMetadata?.factoryTaskId) {
				if (capturedStart.sessionMetadata.factoryRole === "builder") {
					writeFileSync(
						join(capturedStart.config.cwd ?? "", "feature.txt"),
						"after\n",
					);
				}
				return {
					text: ["reviewer", "verifier"].includes(
						String(capturedStart.sessionMetadata.factoryRole),
					)
						? JSON.stringify({
								verdict: "pass",
								summary: "Reviewed behavior and maintainability.",
								findings: [],
							})
						: capturedStart.sessionMetadata.factoryRole === "designer"
							? JSON.stringify({
									instructions: "Acceptance: feature.txt contains after.",
									checks: [
										{
											name: "Feature route",
											kind: "api",
											command: `node -e "if(require('fs').readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1)"`,
										},
									],
								})
							: "Implemented",
					usage: { inputTokens: 1, outputTokens: 1 },
					iterations: 1,
					finishReason: "completed" as const,
					toolCalls: [],
				};
			}
			if (!requestToolApproval) {
				throw new Error("task session did not receive an approval bridge");
			}
			const approval = await requestToolApproval({
				sessionId: capturedStart?.config.sessionId ?? "task-session",
				agentId: "task-agent",
				conversationId: "task-conversation",
				iteration: 1,
				toolCallId: "tool-call-1",
				toolName: "write_to_file",
				input: { path: "src/task.ts" },
				policy: { autoApprove: false },
			});
			if (!approval.approved) throw new Error("task tool was not approved");
			return {
				text: "Task finished",
				usage: { inputTokens: 1, outputTokens: 1 },
				iterations: 1,
				finishReason: "completed" as const,
				toolCalls: [],
			};
		});
		const updateSessionConnection = vi.fn(async () => {});
		const updateSession = vi.fn(async () => ({ updated: false }));
		const readSessionMessages = vi.fn(
			async (): Promise<Array<{ role: "user"; content: string }>> => [],
		);
		const transport = new HubServerTransport({
			workspaceRoot: canonicalChatWorkspace,
			runtimeHandlers: {
				startSession: vi.fn(),
				sendSession: vi.fn(),
				abortSession: vi.fn(),
				stopSession: vi.fn(),
			},
			scheduleOptions: { dbPath: ":memory:" },
			taskOptions: {
				dbPath: join(root, "tasks.db"),
				globalSpecsDir: join(root, "specs"),
				watchFiles: false,
			},
			sessionHost: {
				subscribe: vi.fn(() => () => {}),
				startSession,
				updateSessionConnection,
				runTurn,
				stopSession: vi.fn(async () => {}),
				abort: vi.fn(async () => {}),
				dispose: vi.fn(async () => {}),
				getSession: vi.fn(async (sessionId: string) => sessions.get(sessionId)),
				getAccumulatedUsage: vi.fn(async () => undefined),
				listSessions: vi.fn(async () => [...sessions.values()]),
				deleteSession: vi.fn(async () => false),
				updateSession,
				updateSessionCompactionState: vi.fn(async () => ({ updated: false })),
				readSessionCompactionState: vi.fn(async () => undefined),
				readSessionMessages,
				dispatchHookEvent: vi.fn(async () => {}),
				restoreSession: vi.fn(),
			} as never,
		});
		const events: HubEventEnvelope[] = [];
		transport.subscribe("observer", (event) => {
			events.push(event);
			if (
				event.event === "approval.requested" &&
				typeof event.payload?.approvalId === "string"
			) {
				void transport.handleCommand({
					version: "v1",
					command: "approval.respond",
					clientId: "desktop",
					payload: {
						approvalId: event.payload.approvalId,
						approved: true,
					},
				});
			}
		});
		await transport.start();

		try {
			sessions.set("origin-session", {
				sessionId: "origin-session",
				metadata: { autoApproveTools: true },
			});
			const created = await transport.handleCommand({
				version: "v1",
				command: "task.create",
				clientId: "desktop",
				payload: {
					type: "follow-up",
					title: "Review the implementation",
					instructions: "Review the implementation and summarize risks.",
					scope: "global",
					priority: 0,
					originSessionId: "origin-session",
					expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
				},
			});
			expect(created.ok).toBe(true);
			const approved = created.payload?.task as {
				taskId: string;
				status: string;
				revision: number;
				createdBy: { kind: string; clientId?: string };
			};
			expect(approved).toMatchObject({
				status: "approved",
				createdBy: { kind: "user", clientId: "desktop" },
			});
			const started = await transport.handleCommand({
				version: "v1",
				command: "task.run",
				clientId: "desktop",
				payload: {
					taskId: approved.taskId,
					expectedRevision: approved.revision,
				},
			});
			expect(started.ok).toBe(true);
			expect(started.payload?.task).toMatchObject({
				status: "in_progress",
				lastSessionId: expect.any(String),
			});
			expect(
				capturedStart?.localRuntime?.extraTools?.some(
					(tool) => tool.name === "tasks",
				),
			).toBe(true);
			expect(capturedStart?.localRuntime?.extraTools).toHaveLength(1);
			expect(
				capturedStart?.localRuntime?.extensions?.some(
					(extension) => extension.name === "hub-task-guidance",
				),
			).toBe(true);
			expect(capturedStart?.config.workspaceRoot).toBe(canonicalChatWorkspace);
			expect(capturedStart?.toolPolicies).toMatchObject({
				"*": { autoApprove: true, enabled: true },
			});

			const tasksTool = capturedStart?.localRuntime?.extraTools?.find(
				(tool) => tool.name === "tasks",
			);
			expect(tasksTool).toBeDefined();
			const scheduled = await tasksTool?.execute(
				{
					kind: "scheduled",
					operation: "create",
					schedule_type: "recurring",
					name: "Review task output",
					prompt: "Review the task output and summarize any risks.",
					cron_pattern: "0 9 * * 1-5",
					timezone: "America/Los_Angeles",
				},
				{
					sessionId: capturedStart?.config.sessionId,
					agentId: "task-agent",
					iteration: 2,
				},
			);
			// Agent-created schedules anchor in the user's schedules home, not
			// the chat workspace that created them.
			expect((scheduled as { error?: unknown })?.error).toBeUndefined();
			const canonicalSchedulesHome = realpathSync.native(
				join(clineHome, "schedules"),
			);
			expect(scheduled).toMatchObject({
				ok: true,
				kind: "scheduled",
				schedule: {
					name: "Review task output",
					workspaceRoot: canonicalSchedulesHome,
					timezone: "America/Los_Angeles",
					createdBy: "agent:task-agent",
				},
			});
			const beforeRegistration = await transport.handleCommand(
				{
					version: "v1",
					command: "schedule.list",
					clientId: "unregistered-client",
				},
				null,
			);
			expect(beforeRegistration).toMatchObject({
				ok: false,
				error: {
					code: "schedule_command_failed",
					message: "schedule commands require a registered workspace client",
				},
			});
			await transport.handleCommand({
				version: "v1",
				command: "client.register",
				clientId: "schedule-client",
				payload: {
					clientId: "schedule-client",
					clientType: "test-client",
					transport: "native",
					workspaceContext: {
						workspaceRoot: canonicalSchedulesHome,
						cwd: canonicalSchedulesHome,
					},
				},
			});
			const listedSchedules = await transport.handleCommand(
				{
					version: "v1",
					command: "schedule.list",
					clientId: "schedule-client",
					payload: { workspaceRoot: canonicalSchedulesHome },
				},
				{
					clientId: "schedule-client",
					workspaceContext: {
						workspaceRoot: canonicalSchedulesHome,
						cwd: canonicalSchedulesHome,
					},
				},
			);
			expect(listedSchedules.payload?.schedules).toEqual([
				expect.objectContaining({ name: "Review task output" }),
			]);
			// A client scoped to the chat workspace no longer owns the
			// agent-created schedule.
			const chatScopedSchedules = await transport.handleCommand(
				{
					version: "v1",
					command: "schedule.list",
					clientId: "schedule-client",
				},
				{
					clientId: "schedule-client",
					workspaceContext: {
						workspaceRoot: canonicalChatWorkspace,
						cwd: canonicalChatWorkspace,
					},
				},
			);
			expect(chatScopedSchedules.payload?.schedules).toEqual([]);

			await vi.waitFor(async () => {
				const listed = await transport.handleCommand({
					version: "v1",
					command: "task.list",
					clientId: "desktop",
					payload: {},
				});
				expect(listed.payload?.tasks).toEqual([
					expect.objectContaining({
						taskId: approved.taskId,
						status: "completed",
						lastSessionId: expect.any(String),
					}),
				]);
			});
			expect(runTurn).toHaveBeenCalledTimes(1);
			expect(events.map((event) => event.event)).toEqual(
				expect.arrayContaining([
					"task.created",
					"task.updated",
					"task.run.started",
					"task.run.completed",
					"schedule.created",
				]),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					event: "approval.requested",
					payload: expect.objectContaining({
						agendaTaskId: approved.taskId,
						toolName: "write_to_file",
					}),
				}),
			);

			// While the Agenda todo tool and UI are disabled, the hub keeps the
			// automation pump idle: a persisted auto_start policy must not
			// approve or start eligible work even once an approval-capable
			// client registers, because no surface remains to supervise it.
			const automated = await transport.handleCommand({
				version: "v1",
				command: "task.create",
				clientId: "desktop",
				payload: {
					type: "todo",
					title: "Wait for an approval client",
					instructions: "Start only while a review surface is connected.",
					scope: "global",
					expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
				},
			});
			const automatedTask = automated.payload?.task as {
				taskId: string;
				revision: number;
			};
			await transport.handleCommand({
				version: "v1",
				command: "task.automation.set",
				clientId: "desktop",
				payload: {
					policy: {
						scopeKey: "global",
						mode: "auto_start",
						applyToAgentCreated: true,
						maxConcurrentRuns: 1,
						maxChainDepth: 3,
						maxStartsPerHour: 20,
					},
				},
			});
			await transport.handleCommand({
				version: "v1",
				command: "client.register",
				clientId: "desktop",
				payload: {
					clientId: "desktop",
					clientType: "code-sidecar-observer",
					transport: "native",
					capabilities: [{ name: "approval.respond" }],
				},
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			const idle = await transport.handleCommand({
				version: "v1",
				command: "task.get",
				clientId: "desktop",
				payload: { taskId: automatedTask.taskId },
			});
			expect(idle.payload?.task).toMatchObject({
				// User-created todos are approved on creation; automation must
				// still never start them while it is disabled.
				status: "approved",
			});
			expect(startSession).toHaveBeenCalledTimes(1);

			execFileSync("git", ["init", "-b", "main", canonicalChatWorkspace]);
			execFileSync("git", [
				"-C",
				canonicalChatWorkspace,
				"config",
				"user.name",
				"Test",
			]);
			execFileSync("git", [
				"-C",
				canonicalChatWorkspace,
				"config",
				"user.email",
				"test@example.invalid",
			]);
			writeFileSync(join(canonicalChatWorkspace, "feature.txt"), "before\n");
			execFileSync("git", ["-C", canonicalChatWorkspace, "add", "feature.txt"]);
			execFileSync("git", [
				"-C",
				canonicalChatWorkspace,
				"commit",
				"-m",
				"Initial",
			]);
			for (const providerId of [
				"claude-code",
				"openai-codex-cli",
				"missing-factory-provider",
			]) {
				const unsupported = await transport.handleCommand({
					version: "v1",
					command: "task.create",
					clientId: "desktop",
					payload: {
						type: "follow-up",
						title: `Unsupported ${providerId}`,
						instructions: "Inspect the feature.",
						expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
						factory: {
							agents: {
								reviewers: [
									{ modelSelection: { providerId, modelId: "native-model" } },
								],
							},
						},
					},
				});
				expect(unsupported.ok).toBe(true);
				const taskId = z
					.object({ taskId: z.string() })
					.parse(unsupported.payload?.task).taskId;
				const before = capturedStarts.length;
				const rejected = await transport.handleCommand({
					version: "v1",
					command: "task.factory.design",
					clientId: "desktop",
					payload: { taskId },
				});
				expect(rejected.ok).toBe(false);
				expect(rejected.error?.message).toContain(providerId);
				expect(capturedStarts).toHaveLength(before);
			}
			const feature = await transport.handleCommand({
				version: "v1",
				command: "task.create",
				clientId: "desktop",
				payload: {
					type: "follow-up",
					title: "Update feature behavior",
					maxIterations: 12,
					systemPrompt: "Stay within the approved scope.",
					instructions: "Acceptance: feature.txt contains after.",
					expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
					factory: {
						agents: {
							designer: {
								modelSelection: { providerId: "openai", modelId: "gpt-4.1" },
								maxIterations: 4,
								instructions: "Clarify acceptance criteria.",
							},
							implementer: {
								modelSelection: {
									providerId: "anthropic",
									modelId: "claude-sonnet-4-5",
								},
								maxIterations: 40,
							},
							verifier: {
								modelSelection: {
									providerId: "openai",
									modelId: "gpt-4.1-mini",
								},
								maxIterations: 3,
								instructions: "Exercise user behavior.",
							},
							reviewers: [
								{
									modelSelection: { providerId: "openai", modelId: "gpt-4.1" },
									maxIterations: 5,
									instructions: "Inspect correctness.",
								},
							],
						},
						checks: [
							{
								name: "Feature route",
								kind: "api",
								command: `node -e "if(require('fs').readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1)"`,
							},
						],
					},
				},
			});
			expect(feature.ok).toBe(true);
			const featureTask = z
				.object({ taskId: z.string(), revision: z.number() })
				.parse(feature.payload?.task);
			expect(feature.payload?.task).toMatchObject({
				status: "pending_approval",
			});
			const design = await transport.handleCommand({
				version: "v1",
				command: "task.factory.design",
				clientId: "desktop",
				payload: { taskId: featureTask.taskId },
			});
			expect(design.ok).toBe(true);
			const reopenDesign = () =>
				transport.handleCommand({
					version: "v1",
					command: "task.factory.design",
					clientId: "desktop",
					payload: { taskId: featureTask.taskId },
				});
			expect((await reopenDesign()).payload?.sessionId).toBe(
				design.payload?.sessionId,
			);
			expect(
				capturedStarts.filter(
					(input) => input.sessionMetadata?.factoryRole === "designer",
				),
			).toHaveLength(1);
			await vi.waitFor(async () => {
				const current = await transport.handleCommand({
					version: "v1",
					command: "task.get",
					clientId: "desktop",
					payload: { taskId: featureTask.taskId },
				});
				const task = z
					.object({ revision: z.number(), status: z.string() })
					.parse(current.payload?.task);
				expect(task.revision).toBe(2);
				expect(task.status).toBe("pending_approval");
				featureTask.revision = task.revision;
			});
			let priorDesignerId = z.string().parse(design.payload?.sessionId);
			const assigned = sessions.get(priorDesignerId);
			if (!assigned) throw new Error("Designer session missing");
			for (const updates of [
				{ providerId: "openai-codex-cli" },
				{ modelId: "different-model" },
			]) {
				const calls = updateSessionConnection.mock.calls.length;
				const reply = await transport.handleCommand({
					version: "v1",
					command: "session.update_connection",
					sessionId: priorDesignerId,
					payload: { updates },
				});
				expect(reply.error?.code).toBe("factory_session_assignment_locked");
				expect(updateSessionConnection).toHaveBeenCalledTimes(calls);
			}
			for (const [sessionId, updates] of [
				[priorDesignerId, { modelId: assigned.model }],
				["origin-session", { providerId: "openai-codex-cli" }],
			] as const) {
				const reply = await transport.handleCommand({
					version: "v1",
					command: "session.update_connection",
					sessionId,
					payload: { updates },
				});
				expect(reply.ok).toBe(true);
			}
			await transport.handleCommand({
				version: "v1",
				command: "session.update",
				sessionId: priorDesignerId,
				payload: {
					metadata: {
						factoryTaskId: null,
						factoryRole: "builder",
						factoryDesignConfig: "changed",
						title: "Renamed",
					},
				},
			});
			expect(updateSession).toHaveBeenLastCalledWith(priorDesignerId, {
				metadata: { title: "Renamed" },
			});
			// Simulate a persisted session changed by an older host.
			assigned.model = "different-model";
			const corrected = await reopenDesign();
			expect(corrected.ok).toBe(true);
			expect(corrected.payload?.sessionId).not.toBe(priorDesignerId);
			priorDesignerId = z.string().parse(corrected.payload?.sessionId);
			expect(sessions.get(priorDesignerId)?.model).toBe("gpt-4.1");
			await vi.waitFor(async () => {
				const current = await transport.handleCommand({
					version: "v1",
					command: "task.get",
					clientId: "desktop",
					payload: { taskId: featureTask.taskId },
				});
				expect(current.payload?.task).toMatchObject({ revision: 3 });
			});
			const transcript = [
				{ role: "user" as const, content: "Keep the accepted feature scope." },
			];
			readSessionMessages.mockResolvedValueOnce(transcript);
			updateSessionConnection.mockRejectedValueOnce(
				new SessionNotFoundError(priorDesignerId),
			);
			const resumed = await transport.handleCommand({
				version: "v1",
				command: "task.factory.design",
				clientId: "desktop",
				payload: { taskId: featureTask.taskId },
			});
			expect(resumed.ok).toBe(true);
			expect(resumed.payload?.sessionId).not.toBe(priorDesignerId);
			expect(capturedStarts.at(-1)).toMatchObject({
				initialMessages: transcript,
				sessionMetadata: {
					factoryTaskId: featureTask.taskId,
					factoryRole: "designer",
				},
				config: {
					mode: "plan",
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				toolPolicies: {
					"*": { enabled: false },
					read_files: { enabled: true },
				},
			});
			const resumedTask = await transport.handleCommand({
				version: "v1",
				command: "task.get",
				clientId: "desktop",
				payload: { taskId: featureTask.taskId },
			});
			expect(resumedTask.payload?.task).toMatchObject({
				originSessionId: resumed.payload?.sessionId,
			});
			await vi.waitFor(async () => {
				const current = await transport.handleCommand({
					version: "v1",
					command: "task.get",
					clientId: "desktop",
					payload: { taskId: featureTask.taskId },
				});
				const task = z
					.object({ revision: z.number(), status: z.string() })
					.parse(current.payload?.task);
				expect(task.revision).toBe(4);
				expect(task.status).toBe("pending_approval");
				featureTask.revision = task.revision;
			});
			const factoryApproved = await transport.handleCommand({
				version: "v1",
				command: "task.approve",
				clientId: "desktop",
				payload: {
					taskId: featureTask.taskId,
					expectedRevision: featureTask.revision,
				},
			});
			expect(factoryApproved.ok).toBe(true);
			const factoryRun = await transport.handleCommand({
				version: "v1",
				command: "task.run",
				clientId: "desktop",
				payload: {
					taskId: featureTask.taskId,
					expectedRevision: featureTask.revision,
				},
			});
			expect(factoryRun.ok).toBe(true);
			await vi.waitFor(
				async () => {
					const current = await transport.handleCommand({
						version: "v1",
						command: "task.get",
						clientId: "desktop",
						payload: { taskId: featureTask.taskId },
					});
					expect(current.payload?.task).toMatchObject({
						status: "completed",
						originSessionId: resumed.payload?.sessionId,
					});
					expect(current.payload?.runs).toEqual([
						expect.objectContaining({
							factory: expect.objectContaining({
								phase: "ready",
								candidate: expect.objectContaining({
									checks: [expect.objectContaining({ status: "passed" })],
									verification: expect.objectContaining({
										review: expect.objectContaining({ verdict: "pass" }),
									}),
									reviews: [
										expect.objectContaining({
											review: expect.objectContaining({ verdict: "pass" }),
										}),
									],
								}),
							}),
						}),
					]);
				},
				{ timeout: 15000 },
			);
			const featureStarts = capturedStarts.filter(
				(input) => input.sessionMetadata?.factoryTaskId === featureTask.taskId,
			);
			expect(
				featureStarts.map((input) => input.sessionMetadata?.factoryRole),
			).toEqual([
				"designer",
				"designer",
				"designer",
				"builder",
				"verifier",
				"reviewer",
			]);
			for (const input of featureStarts) {
				expect(input.sessionMetadata).toMatchObject({
					agendaTaskId: featureTask.taskId,
					factoryTaskId: featureTask.taskId,
				});
				expect(input.config).toMatchObject({
					enableSpawnAgent: false,
					enableAgentTeams: false,
				});
			}
			const [designer, , , builder, verifier, reviewer] = featureStarts;
			expect(designer?.config).toMatchObject({
				providerId: "openai",
				modelId: "gpt-4.1",
				maxIterations: 4,
				systemPrompt: expect.stringContaining("Clarify acceptance criteria."),
				mode: "plan",
				workspaceRoot: canonicalChatWorkspace,
			});
			expect(designer?.toolPolicies).toMatchObject({
				"*": { enabled: false, autoApprove: false },
				read_files: { enabled: true, autoApprove: true },
			});
			expect(builder?.config.cwd).not.toBe(canonicalChatWorkspace);
			expect(builder?.toolPolicies).toMatchObject({
				"*": { enabled: true, autoApprove: true },
			});
			expect(builder?.config).toMatchObject({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				maxIterations: 12,
			});
			expect(verifier?.config).toMatchObject({
				providerId: "openai",
				modelId: "gpt-4.1-mini",
				maxIterations: 3,
				cwd: builder?.config.cwd,
				systemPrompt: expect.stringContaining("Exercise user behavior."),
			});
			expect(reviewer?.config).toMatchObject({
				providerId: "openai",
				modelId: "gpt-4.1",
				maxIterations: 5,
				systemPrompt: expect.stringContaining("Inspect correctness."),
			});
			expect(verifier?.toolPolicies).toMatchObject({
				"*": { enabled: false },
				read_files: { enabled: true },
				search_codebase: { enabled: true },
				run_commands: { enabled: true },
				ask_question: { enabled: true },
				submit_and_exit: { enabled: true },
			});

			expect(reviewer?.config.cwd).toBe(builder?.config.cwd);
			expect(reviewer?.toolPolicies).toMatchObject({
				"*": { enabled: false },
				read_files: { enabled: true },
				search_codebase: { enabled: true },
			});
			for (const tool of [
				"run_commands",
				"apply_patch",
				"editor",
				"custom_write_tool",
			]) {
				expect(
					reviewer?.toolPolicies?.[tool]?.enabled ??
						reviewer?.toolPolicies?.["*"]?.enabled,
				).toBe(false);
			}
			expect(capturedStarts[0]?.sessionMetadata?.factoryTaskId).toBeUndefined();
		} finally {
			await transport.stop();
		}
	});

	it("keeps agenda spec watchers off while the todo tool is disabled", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-agenda-watch-"));
		const canonicalRoot = realpathSync.native(root);
		const specWatchTargets = () =>
			fsWatchSpy.mock.calls
				.map(([target]) => String(target))
				.filter((target) => target.startsWith(canonicalRoot));

		// Positive control: a manager with file watching left at its default
		// registers an fs.watch on its specs dir, proving the spy observes
		// agenda watchers at all.
		const controlDir = join(root, "control");
		mkdirSync(controlDir, { recursive: true });
		const controlRuntime: AgendaTaskRuntime = {
			isInteractiveClientAvailable: vi.fn(() => true),
			startSession: vi.fn(async () => ({ sessionId: "control-session" })),
			runSession: vi.fn(async () => ({ status: "completed" as const })),
			abortSession: vi.fn(async () => {}),
		};
		const control = new AgendaTaskManager({
			runtime: controlRuntime,
			dbPath: join(controlDir, "tasks.db"),
			globalSpecsDir: join(controlDir, "specs"),
		});
		try {
			await control.start();
			expect(specWatchTargets()).not.toEqual([]);
		} finally {
			await control.dispose();
		}
		fsWatchSpy.mockClear();

		// The transport must force watchers off on its own while the todo tool
		// is disabled, even when the host leaves watchFiles unset.
		const workspace = join(root, "workspace");
		mkdirSync(workspace);
		const transport = new HubServerTransport({
			workspaceRoot: realpathSync.native(workspace),
			runtimeHandlers: {
				startSession: vi.fn(),
				sendSession: vi.fn(),
				abortSession: vi.fn(),
				stopSession: vi.fn(),
			},
			scheduleOptions: { dbPath: ":memory:" },
			taskOptions: {
				dbPath: join(root, "tasks.db"),
				globalSpecsDir: join(root, "specs"),
			},
			sessionHost: {
				subscribe: vi.fn(() => () => {}),
				startSession: vi.fn(),
				runTurn: vi.fn(),
				stopSession: vi.fn(async () => {}),
				abort: vi.fn(async () => {}),
				dispose: vi.fn(async () => {}),
				getSession: vi.fn(async () => undefined),
				getAccumulatedUsage: vi.fn(async () => undefined),
				listSessions: vi.fn(async () => []),
				deleteSession: vi.fn(async () => false),
				updateSession: vi.fn(async () => ({ updated: false })),
				updateSessionCompactionState: vi.fn(async () => ({
					updated: false,
				})),
				readSessionCompactionState: vi.fn(async () => undefined),
				readSessionMessages: vi.fn(async () => []),
				dispatchHookEvent: vi.fn(async () => {}),
				restoreSession: vi.fn(),
			} as never,
		});
		try {
			await transport.start();
			const created = await transport.handleCommand({
				version: "v1",
				command: "task.create",
				clientId: "desktop",
				payload: {
					type: "follow-up",
					title: "Watcherless todo",
					instructions: "Verify agenda spec watchers stay off.",
					expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
				},
			});
			expect(created.ok).toBe(true);
			expect(specWatchTargets()).toEqual([]);
		} finally {
			await transport.stop();
		}
	});
});
