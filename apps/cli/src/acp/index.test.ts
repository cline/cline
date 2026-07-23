import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("runAcpMode", () => {
	afterEach(() => {
		vi.doUnmock("@agentclientprotocol/sdk");
		vi.doUnmock("./acpAgent");
		vi.restoreAllMocks();
	});

	it("writes the startup diagnostic without labeling it as an error", async () => {
		const stderrWrite = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);

		vi.doMock("@agentclientprotocol/sdk", () => ({
			ndJsonStream: vi.fn(() => ({})),
			AgentSideConnection: class {
				closed = Promise.resolve();
			},
		}));
		vi.doMock("./acpAgent", () => ({
			AcpAgent: class {},
		}));

		const { runAcpMode } = await import("./index");

		await runAcpMode();

		expect(stderrWrite).toHaveBeenCalledWith(
			"[acp] starting ACP mode over stdio…\n",
		);
		expect(stderrWrite).not.toHaveBeenCalledWith(
			expect.stringContaining("error:"),
		);
	});
});

describe("AcpAgent.loadSession", () => {
	let savedApiKey: string | undefined;

	beforeEach(() => {
		savedApiKey = process.env.CLINE_API_KEY;
		process.env.CLINE_API_KEY = "test-key";
	});

	afterEach(() => {
		if (savedApiKey === undefined) {
			delete process.env.CLINE_API_KEY;
		} else {
			process.env.CLINE_API_KEY = savedApiKey;
		}
		vi.doUnmock("@agentclientprotocol/sdk");
		vi.doUnmock("@cline/core");
		vi.doUnmock("./acpAgent");
		vi.restoreAllMocks();
	});

	it("returns a LoadSessionResponse with modes, models, and configOptions", async () => {
		vi.doMock("@agentclientprotocol/sdk", () => ({
			PROTOCOL_VERSION: "0.1.0",
			RequestError: { methodNotFound: () => new Error("Method not found") },
			AgentSideConnection: class {
				closed = Promise.resolve();
			},
		}));

		vi.doMock("@cline/core", () => ({
			Llms: {
				getModelsForProvider: vi.fn().mockResolvedValue({
					"anthropic/claude-sonnet-4.6": { name: "Claude Sonnet 4.6" },
				}),
				getProvider: vi.fn().mockResolvedValue({ name: "Cline" }),
			},
			ProviderSettingsManager: class {
				getProviderSettings() {
					return {};
				}
			},
			SessionSource: { CLI: "cli" },
		}));

		const { AcpAgent } = await import("./acpAgent");

		const mockConn = {
			on: vi.fn(),
			send: vi.fn(),
			closed: Promise.resolve(),
		} as any;
		const agent = new AcpAgent(mockConn);

		const response = await agent.loadSession({
			sessionId: "test-id",
			cwd: "/workspace",
			mcpServers: [],
		});

		expect(response).toHaveProperty("modes");
		expect(response).toHaveProperty("models");
		expect(response).toHaveProperty("configOptions");
		expect(response.modes?.currentModeId).toBe("act");
		expect(response.models?.currentModelId).toBe("anthropic/claude-sonnet-4.6");
	});

	it("registers the session under the provided sessionId for subsequent prompts", async () => {
		vi.doMock("@agentclientprotocol/sdk", () => ({
			PROTOCOL_VERSION: "0.1.0",
			RequestError: { methodNotFound: () => new Error("Method not found") },
			AgentSideConnection: class {
				closed = Promise.resolve();
			},
		}));

		vi.doMock("@cline/core", () => ({
			Llms: {
				getModelsForProvider: vi.fn().mockResolvedValue({
					"anthropic/claude-sonnet-4.6": { name: "Claude Sonnet 4.6" },
				}),
				getProvider: vi.fn().mockResolvedValue({ name: "Cline" }),
			},
			ProviderSettingsManager: class {
				getProviderSettings() {
					return {};
				}
			},
			SessionSource: { CLI: "cli" },
		}));

		const { AcpAgent } = await import("./acpAgent");

		const mockConn = {
			on: vi.fn(),
			send: vi.fn(),
			closed: Promise.resolve(),
		} as any;
		const agent = new AcpAgent(mockConn);

		await agent.loadSession({
			sessionId: "test-id",
			cwd: "/workspace",
			mcpServers: [],
		});

		// Access the private sessions map via reflection to verify the session was registered
		const sessions = (agent as any).sessions;
		expect(sessions.has("test-id")).toBe(true);

		const session = sessions.get("test-id");
		expect(session.id).toBe("test-id");
		expect(session.cwd).toBe("/workspace");
	});

	it("initialize advertises loadSession: true", async () => {
		vi.doMock("@agentclientprotocol/sdk", () => ({
			PROTOCOL_VERSION: "0.1.0",
			RequestError: { methodNotFound: () => new Error("Method not found") },
			AgentSideConnection: class {
				closed = Promise.resolve();
			},
		}));

		vi.doMock("@cline/core", () => ({
			Llms: {
				getModelsForProvider: vi.fn().mockResolvedValue({}),
				getProvider: vi.fn().mockResolvedValue({}),
			},
			ProviderSettingsManager: class {
				getProviderSettings() {
					return {};
				}
			},
			SessionSource: { CLI: "cli" },
		}));

		const { AcpAgent } = await import("./acpAgent");

		const mockConn = {
			on: vi.fn(),
			send: vi.fn(),
			closed: Promise.resolve(),
		} as any;
		const agent = new AcpAgent(mockConn);

		const response = await agent.initialize({} as any);

		expect(response.agentCapabilities?.loadSession).toBe(true);
	});
});
