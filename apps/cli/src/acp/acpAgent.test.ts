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
});
