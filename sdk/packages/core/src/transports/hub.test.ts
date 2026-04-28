import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSource } from "../types/common";

const commandMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());

vi.mock("../hub/client", () => ({
	NodeHubClient: class {
		command = commandMock;
		subscribe = subscribeMock;
		close = closeMock;
	},
}));

function createConfig() {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "system",
		mode: "act" as const,
		checkpoint: { enabled: true },
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	};
}

describe("HubRuntimeHost", () => {
	afterEach(() => {
		commandMock.mockReset();
		subscribeMock.mockReset();
		closeMock.mockReset();
	});

	it("does not auto-start a run during session creation", async () => {
		subscribeMock.mockReturnValue(() => {});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		const started = await host.start({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		expect(started.sessionId).toBe("sess-1");
		expect(started.result).toBeUndefined();
		expect(commandMock).toHaveBeenCalledTimes(1);
		expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function), {
			sessionId: "sess-1",
		});
		expect(commandMock).toHaveBeenCalledWith("session.create", {
			workspaceRoot: "/tmp/project",
			cwd: "/tmp/project",
			sessionConfig: expect.objectContaining({
				providerId: "cline",
				modelId: "anthropic/claude-haiku-4.5",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				systemPrompt: "system",
				mode: "act",
				checkpoint: { enabled: true },
				enableTools: true,
				enableSpawnAgent: true,
				enableAgentTeams: true,
			}),
			metadata: expect.objectContaining({
				source: SessionSource.CLI,
				prompt: "Hey",
				interactive: false,
			}),
			runtimeOptions: {
				toolExecutors: [],
			},
			toolPolicies: undefined,
			initialMessages: undefined,
		});
	});

	it("starts runs only through send", async () => {
		subscribeMock.mockReturnValue(() => {});
		const result = {
			text: "Hey!",
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			messages: [],
			toolCalls: [],
			iterations: 1,
			finishReason: "completed",
			model: {
				id: "anthropic/claude-haiku-4.5",
				provider: "cline",
				info: {},
			},
			startedAt: new Date("2026-04-21T00:00:00.000Z"),
			endedAt: new Date("2026-04-21T00:00:01.000Z"),
			durationMs: 1000,
		};
		commandMock.mockResolvedValue({ ok: true, payload: { result } });

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		const sent = await host.send({
			sessionId: "sess-1",
			prompt: "Hey",
			delivery: "queue",
		});

		expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function), {
			sessionId: "sess-1",
		});
		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Hey",
				attachments: undefined,
				delivery: "queue",
			},
			"sess-1",
			{ timeoutMs: null },
		);
		expect(sent).toEqual(result);
	});

	it("bridges hub approval requests through the configured approval callback", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "approval.requested";
					sessionId: string;
					payload: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock
			.mockResolvedValueOnce({
				payload: {
					session: {
						sessionId: "sess-1",
						status: "running",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						workspaceRoot: "/tmp/project",
						cwd: "/tmp/project",
					},
				},
			})
			.mockResolvedValueOnce({ ok: true, payload: {} });
		const requestToolApproval = vi.fn(async () => ({
			approved: true,
			reason: "ok",
		}));

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({
			url: "ws://127.0.0.1:25463/hub",
			requestToolApproval,
		});

		await host.start({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});
		onEvent?.({
			version: 1,
			event: "approval.requested",
			sessionId: "sess-1",
			payload: {
				approvalId: "approval-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 2,
				toolCallId: "call-1",
				toolName: "run_commands",
				inputJson: '{"commands":["echo hi"]}',
				policy: { autoApprove: false },
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(requestToolApproval).toHaveBeenCalledWith({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 2,
			toolCallId: "call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});
		expect(commandMock).toHaveBeenLastCalledWith(
			"approval.respond",
			{ approvalId: "approval-1", approved: true, reason: "ok" },
			"sess-1",
		);
	});

	it("tears down session stream subscriptions when a session stops", async () => {
		const unsubscribe = vi.fn();
		subscribeMock.mockReturnValue(unsubscribe);
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.start({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		commandMock.mockResolvedValue({ ok: true, payload: {} });
		await host.stop("sess-1");

		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(commandMock).toHaveBeenLastCalledWith(
			"session.detach",
			{ sessionId: "sess-1" },
			"sess-1",
		);
	});

	it("forwards image attachments when sending a run", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { result: undefined } });

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.send({
			sessionId: "sess-1",
			prompt: "Describe this image",
			userImages: ["data:image/png;base64,aGVsbG8="],
		});

		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Describe this image",
				attachments: {
					userImages: ["data:image/png;base64,aGVsbG8="],
				},
				delivery: undefined,
			},
			"sess-1",
			{ timeoutMs: null },
		);
	});

	it("forwards file attachments when sending a run", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { result: undefined } });

		const dir = mkdtempSync(join(tmpdir(), "hub-send-file-"));
		const filePath = join(dir, "note.md");
		writeFileSync(filePath, "# note\n", "utf8");

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.send({
			sessionId: "sess-1",
			prompt: "Use this file",
			userFiles: [filePath],
		});

		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Use this file",
				attachments: {
					userFiles: [{ name: "note.md", content: "# note\n" }],
				},
				delivery: undefined,
			},
			"sess-1",
			{ timeoutMs: null },
		);
	});

	it("reads messages through the hub instead of dereferencing client-local artifact paths", async () => {
		const messages = [
			{
				role: "user",
				content: [{ type: "text", text: "hello from another client" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
			},
		];
		commandMock.mockResolvedValue({ ok: true, payload: { messages } });

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(host.readMessages(" sess-1 ")).resolves.toEqual(messages);
		expect(commandMock).toHaveBeenCalledWith(
			"session.messages",
			{ sessionId: "sess-1" },
			"sess-1",
		);
	});

	it("throws when the hub rejects message reads", async () => {
		commandMock.mockResolvedValue({
			ok: false,
			error: {
				code: "session_not_found",
				message: "Unknown session: sess-missing",
			},
		});

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(host.readMessages("sess-missing")).rejects.toThrow(
			"Unknown session: sess-missing",
		);
	});

	it("detaches active sessions when disposed", async () => {
		commandMock.mockResolvedValueOnce({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.start({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});
		await host.dispose();

		expect(commandMock).toHaveBeenLastCalledWith(
			"session.detach",
			{ sessionId: "sess-1" },
			"sess-1",
		);
	});
});
