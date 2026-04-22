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
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:4319/hub" });

		const started = await host.start({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		expect(started.sessionId).toBe("sess-1");
		expect(started.result).toBeUndefined();
		expect(commandMock).toHaveBeenCalledTimes(1);
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
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:4319/hub" });

		const sent = await host.send({
			sessionId: "sess-1",
			prompt: "Hey",
		});

		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{ sessionId: "sess-1", input: "Hey", attachments: undefined },
			"sess-1",
		);
		expect(sent).toEqual(result);
	});

	it("forwards image attachments when sending a run", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { result: undefined } });

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:4319/hub" });

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
			},
			"sess-1",
		);
	});

	it("forwards file attachments when sending a run", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { result: undefined } });

		const dir = mkdtempSync(join(tmpdir(), "hub-send-file-"));
		const filePath = join(dir, "note.md");
		writeFileSync(filePath, "# note\n", "utf8");

		const { HubRuntimeHost } = await import("./hub");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:4319/hub" });

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
			},
			"sess-1",
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
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:4319/hub" });

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
