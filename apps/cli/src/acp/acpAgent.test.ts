import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("extractPromptContent", () => {
	it("extracts text and image blocks into prompt text and data URLs", async () => {
		const { extractPromptContent } = await import("./acpAgent");
		const result = extractPromptContent([
			{ type: "text", text: "Describe this image" },
			{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
		]);

		expect(result).toEqual({
			text: "Describe this image",
			userImages: ["data:image/png;base64,aGVsbG8="],
		});
	});

	it("preserves existing data URLs and supports image-only prompts", async () => {
		const { extractPromptContent } = await import("./acpAgent");
		const result = extractPromptContent([
			{
				type: "image",
				data: "data:image/jpeg;base64,/9j/4AAQ",
				mimeType: "image/jpeg",
			},
		]);

		expect(result).toEqual({
			text: "",
			userImages: ["data:image/jpeg;base64,/9j/4AAQ"],
		});
	});
});

describe("toMcpServerRegistrations", () => {
	it("converts stdio, http, and sse ACP MCP server configs", async () => {
		const { toMcpServerRegistrations } = await import("./acpAgent");
		const registrations = toMcpServerRegistrations([
			{
				name: "local-stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-everything"],
				env: [{ name: "FOO", value: "bar" }],
			},
			{
				type: "http",
				name: "remote-http",
				url: "https://mcp.example.com/mcp",
				headers: [{ name: "Authorization", value: "Bearer tok" }],
			},
			{
				type: "sse",
				name: "remote-sse",
				url: "https://mcp.example.com/sse",
				headers: [],
			},
		]);

		expect(registrations).toEqual([
			{
				name: "local-stdio",
				transport: {
					type: "stdio",
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-everything"],
					env: { FOO: "bar" },
				},
			},
			{
				name: "remote-http",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.com/mcp",
					headers: { Authorization: "Bearer tok" },
				},
			},
			{
				name: "remote-sse",
				transport: {
					type: "sse",
					url: "https://mcp.example.com/sse",
					headers: undefined,
				},
			},
		]);
	});
});

describe("AcpAgent prompt + mcpServers + usage integration", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
		delete process.env.CLINE_API_KEY;
		delete process.env.CLINE_PROVIDER;
	});

	it("forwards session mcpServers, userImages, and usage updates/response", async () => {
		vi.resetModules();
		process.env.CLINE_API_KEY = "test-key";
		process.env.CLINE_PROVIDER = "anthropic";

		const startMock = vi.fn().mockResolvedValue({ sessionId: "sess-1" });
		const sendMock = vi.fn();
		const sessionUpdateMock = vi.fn().mockResolvedValue(undefined);
		let eventListener: ((event: unknown) => void) | undefined;

		vi.doMock("@cline/core", async (importOriginal) => {
			const actual = await importOriginal<typeof import("@cline/core")>();
			return {
				...actual,
				Llms: {
					...actual.Llms,
					getModelsForProvider: vi.fn().mockResolvedValue({
						"claude-sonnet-4-5": {
							name: "Claude Sonnet 4.5",
							contextWindow: 200_000,
						},
					}),
				},
			};
		});

		vi.doMock("../session/session", () => ({
			createCliCore: vi.fn().mockResolvedValue({
				start: startMock,
				send: sendMock,
				abort: vi.fn(),
				dispose: vi.fn(),
				readMessages: vi.fn().mockResolvedValue([]),
			}),
		}));

		vi.doMock("../runtime/session-events", () => ({
			subscribeToAgentEvents: vi.fn(
				(_manager: unknown, listener: (event: unknown) => void) => {
					eventListener = listener;
					return () => {};
				},
			),
		}));

		vi.doMock("../runtime/prompt", () => ({
			resolveSystemPrompt: vi.fn().mockResolvedValue("sys"),
		}));

		vi.doMock("../utils/common", () => ({
			getCliBuildInfo: vi.fn().mockReturnValue({ name: "cline", version: "0" }),
		}));

		sendMock.mockImplementation(async () => {
			eventListener?.({
				type: "usage",
				inputTokens: 100,
				outputTokens: 25,
				cacheReadTokens: 50,
				totalInputTokens: 150,
				totalOutputTokens: 25,
				totalCost: 0.002,
			});
			return { finishReason: "completed" };
		});

		const { AcpAgent } = await import("./acpAgent");
		const conn = {
			sessionUpdate: sessionUpdateMock,
		} as unknown as AgentSideConnection;
		const agent = new AcpAgent(conn);

		const created = await agent.newSession({
			cwd: "/tmp/project",
			mcpServers: [
				{
					name: "fs",
					command: "mcp-fs",
					args: ["/tmp/project"],
					env: [],
				},
			],
		});

		const response = await agent.prompt({
			sessionId: created.sessionId,
			prompt: [
				{ type: "text", text: "Check this screenshot" },
				{ type: "image", data: "Zm9v", mimeType: "image/png" },
			],
		});

		expect(startMock).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					mcpServers: [
						{
							name: "fs",
							transport: {
								type: "stdio",
								command: "mcp-fs",
								args: ["/tmp/project"],
								env: undefined,
							},
						},
					],
				}),
			}),
		);

		expect(sendMock).toHaveBeenCalledWith({
			sessionId: "sess-1",
			prompt: "Check this screenshot",
			userImages: ["data:image/png;base64,Zm9v"],
		});

		expect(sessionUpdateMock).toHaveBeenCalledWith({
			sessionId: created.sessionId,
			update: {
				sessionUpdate: "usage_update",
				used: 150,
				size: 200_000,
				cost: { amount: 0.002, currency: "USD" },
			},
		});

		expect(response).toEqual({
			stopReason: "end_turn",
			usage: {
				inputTokens: 100,
				outputTokens: 25,
				cachedReadTokens: 50,
				totalTokens: 175,
			},
		});
	});

	it("recomputes context window on model switch, accumulates session cost across turns, and skips usage_update when size is unknown", async () => {
		vi.resetModules();
		process.env.CLINE_API_KEY = "test-api-key";
		process.env.CLINE_PROVIDER = "anthropic";

		const startMock = vi.fn().mockResolvedValue({ sessionId: "sess-2" });
		const sendMock = vi.fn();
		const sessionUpdateMock = vi.fn().mockResolvedValue(undefined);
		let eventListener: ((event: unknown) => void) | undefined;

		vi.doMock("@cline/core", async (importOriginal) => {
			const actual = await importOriginal<typeof import("@cline/core")>();
			return {
				...actual,
				Llms: {
					...actual.Llms,
					getModelsForProvider: vi.fn().mockResolvedValue({
						"claude-sonnet-4-5": {
							name: "Claude Sonnet 4.5",
							contextWindow: 1_048_576,
						},
						"claude-haiku-4-5": {
							name: "Claude Haiku 4.5",
							contextWindow: 200_000,
						},
						"unknown-context-model": {
							name: "Unknown Context",
						},
					}),
				},
			};
		});

		vi.doMock("../session/session", () => ({
			createCliCore: vi.fn().mockResolvedValue({
				start: startMock,
				send: sendMock,
				abort: vi.fn(),
				dispose: vi.fn(),
				readMessages: vi.fn().mockResolvedValue([]),
				updateSessionModel: vi.fn().mockResolvedValue(undefined),
			}),
		}));

		vi.doMock("../runtime/session-events", () => ({
			subscribeToAgentEvents: vi.fn(
				(_manager: unknown, listener: (event: unknown) => void) => {
					eventListener = listener;
					return () => {};
				},
			),
		}));

		vi.doMock("../runtime/prompt", () => ({
			resolveSystemPrompt: vi.fn().mockResolvedValue("sys"),
		}));

		vi.doMock("../utils/common", () => ({
			getCliBuildInfo: vi.fn().mockReturnValue({ name: "cline", version: "0" }),
		}));

		sendMock
			.mockImplementationOnce(async () => {
				eventListener?.({
					type: "usage",
					inputTokens: 100,
					outputTokens: 20,
					totalCost: 0.0055,
				});
				return { finishReason: "completed" };
			})
			.mockImplementationOnce(async () => {
				eventListener?.({
					type: "usage",
					inputTokens: 150,
					outputTokens: 30,
					totalCost: 0.004,
				});
				return { finishReason: "completed" };
			})
			.mockImplementationOnce(async () => {
				eventListener?.({
					type: "usage",
					inputTokens: 50,
					outputTokens: 10,
					totalCost: 0.001,
				});
				return { finishReason: "completed" };
			});

		const { AcpAgent } = await import("./acpAgent");
		const conn = {
			sessionUpdate: sessionUpdateMock,
		} as unknown as AgentSideConnection;
		const agent = new AcpAgent(conn);

		const created = await agent.newSession({
			cwd: "/tmp/project",
			mcpServers: [],
		});

		// Turn 1 with default 1,048,576 context window
		await agent.prompt({
			sessionId: created.sessionId,
			prompt: [{ type: "text", text: "Turn 1" }],
		});
		expect(sessionUpdateMock).toHaveBeenCalledWith({
			sessionId: created.sessionId,
			update: {
				sessionUpdate: "usage_update",
				used: 100,
				size: 1_048_576,
				cost: { amount: 0.0055, currency: "USD" },
			},
		});

		// Switch model via unstable_setSessionModel -> updates context window to 200,000 and emits usage_update
		sessionUpdateMock.mockClear();
		await agent.unstable_setSessionModel({
			sessionId: created.sessionId,
			modelId: "claude-haiku-4-5",
		});
		expect(sessionUpdateMock).toHaveBeenCalledWith({
			sessionId: created.sessionId,
			update: {
				sessionUpdate: "usage_update",
				used: 100,
				size: 200_000,
				cost: { amount: 0.0055, currency: "USD" },
			},
		});

		// Turn 2 accumulates cost across turns (0.0055 + 0.004 = 0.0095) and uses updated 200,000 size
		sessionUpdateMock.mockClear();
		await agent.prompt({
			sessionId: created.sessionId,
			prompt: [{ type: "text", text: "Turn 2" }],
		});
		const turn2UsageCall = sessionUpdateMock.mock.calls.find(
			([arg]) => arg?.update?.sessionUpdate === "usage_update",
		);
		expect(turn2UsageCall?.[0].update.size).toBe(200_000);
		expect(turn2UsageCall?.[0].update.cost.amount).toBeCloseTo(0.0095, 10);

		// Switch via setSessionConfigOption to a model with unknown context window -> skips usage_update
		sessionUpdateMock.mockClear();
		await agent.setSessionConfigOption({
			sessionId: created.sessionId,
			configId: "model",
			value: "unknown-context-model",
		});
		expect(
			sessionUpdateMock.mock.calls.some(
				([arg]) => arg?.update?.sessionUpdate === "usage_update",
			),
		).toBe(false);

		sessionUpdateMock.mockClear();
		await agent.prompt({
			sessionId: created.sessionId,
			prompt: [{ type: "text", text: "Turn 3" }],
		});
		expect(
			sessionUpdateMock.mock.calls.some(
				([arg]) => arg?.update?.sessionUpdate === "usage_update",
			),
		).toBe(false);
	});
});
