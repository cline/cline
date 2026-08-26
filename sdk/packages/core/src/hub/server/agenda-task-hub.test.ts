import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	HubEventEnvelope,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("@ai-sdk/provider-utils", () => ({
	createProviderDefinedToolFactory: vi.fn(() => vi.fn()),
}));

import type {
	StartSessionInput,
	StartSessionResult,
} from "../../runtime/host/runtime-host";
import { HubServerTransport } from "./hub-server-transport";

describe("Hub agenda task vertical slice", () => {
	it("creates an approved user task, starts it, and completes it", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-agenda-"));
		const chatWorkspace = join(root, "chat-workspace");
		mkdirSync(chatWorkspace);
		const canonicalChatWorkspace = realpathSync.native(chatWorkspace);
		const sessions = new Map<string, Record<string, unknown>>();
		let capturedStart: StartSessionInput | undefined;
		let requestToolApproval:
			| ((
					request: ToolApprovalRequest,
			  ) => Promise<ToolApprovalResult> | ToolApprovalResult)
			| undefined;
		const startSession = vi.fn(
			async (input: StartSessionInput): Promise<StartSessionResult> => {
				capturedStart = input;
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
				runTurn,
				stopSession: vi.fn(async () => {}),
				abort: vi.fn(async () => {}),
				dispose: vi.fn(async () => {}),
				getSession: vi.fn(async (sessionId: string) => sessions.get(sessionId)),
				getAccumulatedUsage: vi.fn(async () => undefined),
				listSessions: vi.fn(async () => [...sessions.values()]),
				deleteSession: vi.fn(async () => false),
				updateSession: vi.fn(async () => ({ updated: false })),
				updateSessionCompactionState: vi.fn(async () => ({ updated: false })),
				readSessionCompactionState: vi.fn(async () => undefined),
				readSessionMessages: vi.fn(async () => []),
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
			expect(scheduled).toMatchObject({
				ok: true,
				kind: "scheduled",
				schedule: {
					name: "Review task output",
					workspaceRoot: canonicalChatWorkspace,
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
						workspaceRoot: canonicalChatWorkspace,
						cwd: canonicalChatWorkspace,
					},
				},
			});
			const listedSchedules = await transport.handleCommand(
				{
					version: "v1",
					command: "schedule.list",
					clientId: "schedule-client",
					payload: { workspaceRoot: canonicalChatWorkspace },
				},
				{
					clientId: "schedule-client",
					workspaceContext: {
						workspaceRoot: canonicalChatWorkspace,
						cwd: canonicalChatWorkspace,
					},
				},
			);
			expect(listedSchedules.payload?.schedules).toEqual([
				expect.objectContaining({ name: "Review task output" }),
			]);

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
		} finally {
			await transport.stop();
		}
	});
});
