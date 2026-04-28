import { describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "../server";
import {
	handleApprovalRespond,
	requestToolApproval,
} from "./handlers/approval-handlers";
import {
	ensureSessionState,
	type HubTransportContext,
} from "./handlers/context";
import { projectSessionEvent } from "./handlers/session-event-projector";

describe("HubServerTransport boundaries", () => {
	function createTransport(options: Record<string, unknown> = {}) {
		return new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			sessionHost: {
				subscribe: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				send: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				get: vi.fn().mockResolvedValue({
					sessionId: "session-1",
					status: "completed",
					startedAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				}),
				list: vi.fn(),
				delete: vi.fn(),
				update: vi.fn(),
				handleHookEvent: vi.fn(),
				readMessages: vi.fn(),
			} as never,
			...options,
		});
	}

	function getContext(transport: HubServerTransport): HubTransportContext {
		return (transport as unknown as { ctx: HubTransportContext }).ctx;
	}

	it("continues publishing when one listener throws", () => {
		const transport = createTransport();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const delivered: string[] = [];

		try {
			transport.subscribe("bad", () => {
				throw new Error("listener boom");
			});
			transport.subscribe("good", (event) => {
				delivered.push(event.event);
			});

			(
				transport as unknown as {
					publish: (event: {
						event: string;
						timestamp: number;
						version: "v1";
						eventId: string;
					}) => void;
				}
			).publish({
				version: "v1",
				event: "ui.notify",
				eventId: "evt_1",
				timestamp: Date.now(),
			});

			expect(delivered).toEqual(["ui.notify"]);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"[hub] listener threw while publishing ui.notify:",
				),
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("denies non-interactive approval requests immediately", async () => {
		const transport = createTransport();
		const ctx = getContext(transport);
		ensureSessionState(ctx, "session-1", "client-1", "creator", {
			interactive: false,
		});

		const result = await requestToolApproval(ctx, {
			sessionId: "session-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 1,
			toolCallId: "call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});

		expect(result).toEqual({
			approved: false,
			reason:
				"Tool approval requires an interactive session, but this session is non-interactive.",
		});
	});

	it("serves session messages from the hub-owned session host", async () => {
		const messages = [
			{
				role: "user",
				content: [{ type: "text", text: "created elsewhere" }],
			},
		];
		const readMessages = vi.fn().mockResolvedValue(messages);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				send: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				get: vi.fn().mockResolvedValue({
					sessionId: "session-1",
					source: "cli",
					pid: 123,
					startedAt: new Date(0).toISOString(),
					status: "completed",
					interactive: false,
					provider: "cline",
					model: "test-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					enableTools: true,
					enableSpawn: true,
					enableTeams: false,
					updatedAt: new Date(0).toISOString(),
				}),
				list: vi.fn(),
				delete: vi.fn(),
				update: vi.fn(),
				handleHookEvent: vi.fn(),
				readMessages,
			} as never,
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-1",
			command: "session.messages",
			sessionId: "session-1",
		});

		expect(readMessages).toHaveBeenCalledWith("session-1");
		expect(reply).toMatchObject({
			version: "v1",
			requestId: "req-1",
			ok: true,
			payload: { sessionId: "session-1", messages },
		});
	});

	it("returns session_not_found when session messages are requested for an unknown session", async () => {
		const readMessages = vi.fn().mockResolvedValue([]);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				send: vi.fn(),
				abort: vi.fn(),
				dispose: vi.fn(),
				get: vi.fn().mockResolvedValue(undefined),
				list: vi.fn(),
				delete: vi.fn(),
				update: vi.fn(),
				handleHookEvent: vi.fn(),
				readMessages,
			} as never,
		});

		const reply = await transport.handleCommand({
			version: "v1",
			requestId: "req-1",
			command: "session.messages",
			sessionId: "missing-session",
		});

		expect(readMessages).not.toHaveBeenCalled();
		expect(reply).toMatchObject({
			version: "v1",
			requestId: "req-1",
			ok: false,
			error: {
				code: "session_not_found",
				message: "Unknown session: missing-session",
			},
		});
	});

	it("keeps interactive approval requests pending until a response arrives", async () => {
		vi.useFakeTimers();
		try {
			const transport = createTransport();
			let approvalId = "";
			transport.subscribe("test", (event) => {
				if (
					event.event === "approval.requested" &&
					typeof event.payload?.approvalId === "string"
				) {
					approvalId = event.payload.approvalId;
				}
			});
			const ctx = getContext(transport);
			ensureSessionState(ctx, "session-1", "client-1", "creator", {
				interactive: true,
			});

			let settled: unknown;
			const resultPromise = requestToolApproval(ctx, {
				sessionId: "session-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 1,
				toolCallId: "call-1",
				toolName: "run_commands",
				input: { commands: ["echo hi"] },
				policy: { autoApprove: false },
			});
			resultPromise.then((result) => {
				settled = result;
			});

			await vi.advanceTimersByTimeAsync(10_000);
			await Promise.resolve();

			expect(settled).toBeUndefined();
			expect(approvalId).toMatch(/^approval_/);
			const reply = handleApprovalRespond(ctx, {
				version: "v1",
				requestId: "req-1",
				command: "approval.respond",
				payload: {
					approvalId,
					approved: true,
					reason: "approved by user",
				},
			});

			await expect(reply).resolves.toMatchObject({ ok: true });
			await expect(resultPromise).resolves.toEqual({
				approved: true,
				reason: "approved by user",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("forwards run file attachment paths to the session host", async () => {
		const send = vi.fn().mockResolvedValue(undefined);
		const transport = createTransport({
			sessionHost: {
				subscribe: vi.fn(),
				start: vi.fn(),
				stop: vi.fn(),
				send,
				abort: vi.fn(),
				dispose: vi.fn(),
				get: vi.fn(),
				list: vi.fn(),
				delete: vi.fn(),
				update: vi.fn(),
				handleHookEvent: vi.fn(),
			} as never,
		});

		const reply = await (
			transport as unknown as {
				handleCommand: (envelope: {
					version: "v1";
					requestId: string;
					command: "run.start";
					sessionId: string;
					payload: {
						sessionId: string;
						prompt: string;
						attachments: { userFiles: string[] };
					};
				}) => Promise<{ ok: boolean }>;
			}
		).handleCommand({
			version: "v1",
			requestId: "req-1",
			command: "run.start",
			sessionId: "session-1",
			payload: {
				sessionId: "session-1",
				prompt: "Use this file",
				attachments: { userFiles: ["/tmp/project/note.md"] },
			},
		});

		expect(reply.ok).toBe(true);
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				prompt: "Use this file",
				userFiles: ["/tmp/project/note.md"],
			}),
		);
	});

	it("publishes iteration lifecycle events from agent events", async () => {
		const transport = createTransport();
		const published: string[] = [];
		transport.subscribe("test", (event) => {
			published.push(event.event);
		});
		const ctx = getContext(transport);

		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: { type: "iteration_start", iteration: 3 },
			},
		});
		await projectSessionEvent(ctx, {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "iteration_end",
					iteration: 3,
					hadToolCalls: true,
					toolCallCount: 1,
				},
			},
		});

		expect(published).toEqual(["iteration.started", "iteration.finished"]);
	});
});
