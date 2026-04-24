import { describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "./runtime-handlers";
import { HubServerTransport } from "./server";

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
				get: vi.fn(),
				list: vi.fn(),
				delete: vi.fn(),
				update: vi.fn(),
				handleHookEvent: vi.fn(),
			} as never,
			...options,
		});
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
		(
			transport as unknown as {
				ensureSessionState: (
					sessionId: string,
					clientId: string,
					role: "creator",
					options: { interactive: boolean },
				) => void;
			}
		).ensureSessionState("session-1", "client-1", "creator", {
			interactive: false,
		});

		const result = await (
			transport as unknown as {
				requestToolApproval: (request: {
					sessionId: string;
					agentId: string;
					conversationId: string;
					iteration: number;
					toolCallId: string;
					toolName: string;
					input: unknown;
					policy: { autoApprove: false };
				}) => Promise<{ approved: boolean; reason?: string }>;
			}
		).requestToolApproval({
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
			(
				transport as unknown as {
					ensureSessionState: (
						sessionId: string,
						clientId: string,
						role: "creator",
						options: { interactive: boolean },
					) => void;
				}
			).ensureSessionState("session-1", "client-1", "creator", {
				interactive: true,
			});

			let settled: unknown;
			const resultPromise = (
				transport as unknown as {
					requestToolApproval: (request: {
						sessionId: string;
						agentId: string;
						conversationId: string;
						iteration: number;
						toolCallId: string;
						toolName: string;
						input: unknown;
						policy: { autoApprove: false };
					}) => Promise<{ approved: boolean; reason?: string }>;
				}
			).requestToolApproval({
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
			const reply = (
				transport as unknown as {
					handleApprovalRespond: (envelope: {
						version: "v1";
						requestId: string;
						command: "approval.respond";
						payload: {
							approvalId: string;
							approved: boolean;
							reason: string;
						};
					}) => Promise<{ ok: boolean }>;
				}
			).handleApprovalRespond({
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
});
