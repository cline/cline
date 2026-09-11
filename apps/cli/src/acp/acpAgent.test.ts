import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { Message } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createCliCore: vi.fn(),
	resolveSystemPrompt: vi.fn(
		async ({ mode }: { mode: "plan" | "act" }) => `system-${mode}`,
	),
	randomSessionId: vi.fn(() => "acp-session"),
	sendCurrentModeUpdate: vi.fn(),
	sendSessionInfoUpdate: vi.fn(),
	subscribeToAgentEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@agentclientprotocol/sdk", () => ({
	PROTOCOL_VERSION: 1,
	RequestError: {
		authRequired: vi.fn(),
		internalError: vi.fn(),
		invalidParams: vi.fn(),
		resourceNotFound: vi.fn(),
	},
}));

vi.mock("@cline/core", () => ({
	Llms: {
		getModelsForProvider: vi.fn(async () => ({
			"model-1": { name: "Model 1" },
		})),
		getProvider: vi.fn(async () => ({ defaultModelId: "model-1" })),
	},
	ProviderSettingsManager: class {},
	SessionSource: { CLI: "cli" },
}));

vi.mock("@cline/shared", () => ({
	isLikelyAuthError: vi.fn(() => false),
}));

vi.mock("../commands/auth", () => ({
	getPersistedProviderApiKey: vi.fn(),
}));

vi.mock("../runtime/prompt", () => ({
	resolveSystemPrompt: mocks.resolveSystemPrompt,
}));

vi.mock("../runtime/session-events", () => ({
	subscribeToAgentEvents: mocks.subscribeToAgentEvents,
}));

vi.mock("../session/session", () => ({
	createCliCore: mocks.createCliCore,
}));

vi.mock("../utils/cline-pass-errors", () => ({
	isClineOrgIndividualInferenceSubscriptionErrorMessage: vi.fn(() => false),
}));

vi.mock("../utils/common", () => ({
	getCliBuildInfo: vi.fn(() => ({ name: "cline", version: "test" })),
}));

vi.mock("../utils/helpers", () => ({
	randomSessionId: mocks.randomSessionId,
	resolveWorkspaceRoot: vi.fn((cwd: string) => cwd),
}));

vi.mock("./auth", () => ({
	ACP_AUTH_METHODS: [],
	authenticateAcpProvider: vi.fn(),
	isAcpAuthMethodId: vi.fn(() => false),
}));

vi.mock("./auto-approve", () => ({
	AUTO_APPROVE_CONFIG_ID: "auto-approve",
	buildAutoApproveConfigOption: vi.fn((value: boolean) => ({
		type: "boolean",
		id: "auto-approve",
		name: "Auto approve",
		currentValue: value,
	})),
	parseAutoApproveValue: vi.fn(),
}));

vi.mock("./organizations", () => ({
	ORGANIZATION_CONFIG_ID: "organization",
	PERSONAL_ACCOUNT_VALUE: "personal",
	buildOrganizationConfigOption: vi.fn(),
	fetchClineOrganizations: vi.fn(),
	getAcpOrgSubscriptionMessage: vi.fn(),
	switchClineOrganization: vi.fn(),
	usesClineAccount: vi.fn(() => false),
}));

vi.mock("./permissions", () => ({
	requestAcpToolApproval: vi.fn(),
}));

vi.mock("./session-load", () => ({
	replaySessionHistory: vi.fn(),
}));

vi.mock("./session-updates", () => ({
	describeAgentError: vi.fn((error: unknown) => String(error)),
	forwardAgentEvent: vi.fn(),
	sendConfigOptionUpdate: vi.fn(),
	sendCurrentModeUpdate: mocks.sendCurrentModeUpdate,
	sendSessionInfoUpdate: mocks.sendSessionInfoUpdate,
}));

import { AcpAgent } from "./acpAgent";

const envSnapshot = {
	CLINE_API_KEY: process.env.CLINE_API_KEY,
	CLINE_MODEL: process.env.CLINE_MODEL,
	CLINE_PROVIDER: process.env.CLINE_PROVIDER,
};

function makeSessionManager(sessionId: string) {
	return {
		abort: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
		readMessages: vi.fn<() => Promise<Message[]>>(async () => []),
		send: vi.fn(async () => ({ finishReason: "completed" })),
		start: vi.fn(async () => ({ sessionId })),
	};
}

describe("AcpAgent session modes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createCliCore.mockReset();
		process.env.CLINE_API_KEY = "test-key";
		delete process.env.CLINE_MODEL;
		delete process.env.CLINE_PROVIDER;
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(envSnapshot)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	it("restarts an initialized session with act-mode config after session/set_mode", async () => {
		const planManager = makeSessionManager("core-plan");
		const actManager = makeSessionManager("core-act");
		const history = [
			{ role: "user" as const, content: "Plan the change" },
			{ role: "assistant" as const, content: "Here is the plan" },
		];
		planManager.readMessages.mockResolvedValue(history);
		mocks.createCliCore
			.mockResolvedValueOnce(planManager)
			.mockResolvedValueOnce(actManager);

		const agent = new AcpAgent({} as AgentSideConnection);
		const { sessionId } = await agent.newSession({
			cwd: "/workspace",
			mcpServers: [],
		});

		await agent.setSessionMode({ sessionId, modeId: "plan" });
		await agent.prompt({
			sessionId,
			prompt: [{ type: "text", text: "Plan the change" }],
		});

		expect(planManager.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({ mode: "plan", sessionId }),
				initialMessages: undefined,
			}),
		);

		await agent.setSessionMode({ sessionId, modeId: "act" });
		await agent.prompt({
			sessionId,
			prompt: [{ type: "text", text: "Apply the change" }],
		});

		expect(mocks.createCliCore).toHaveBeenCalledTimes(2);
		expect(planManager.readMessages).toHaveBeenCalledWith("core-plan");
		expect(planManager.dispose).toHaveBeenCalledTimes(1);
		expect(actManager.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({ mode: "act", sessionId }),
				initialMessages: history,
				interactive: true,
			}),
		);
		expect(actManager.send).toHaveBeenCalledWith({
			sessionId: "core-act",
			prompt: "Apply the change",
		});
	});

	it("does not restart when the requested mode is already active", async () => {
		const manager = makeSessionManager("core-act");
		mocks.createCliCore.mockResolvedValueOnce(manager);

		const agent = new AcpAgent({} as AgentSideConnection);
		const { sessionId } = await agent.newSession({
			cwd: "/workspace",
			mcpServers: [],
		});
		await agent.prompt({
			sessionId,
			prompt: [{ type: "text", text: "Start" }],
		});

		await agent.setSessionMode({ sessionId, modeId: "act" });

		expect(manager.readMessages).not.toHaveBeenCalled();
		expect(manager.dispose).not.toHaveBeenCalled();
		expect(mocks.sendCurrentModeUpdate).toHaveBeenCalledWith(
			expect.anything(),
			sessionId,
			"act",
		);
	});

	it("uses the same restart path for the mode config option", async () => {
		const manager = makeSessionManager("core-act");
		const history: Message[] = [{ role: "user", content: "Start in act mode" }];
		manager.readMessages.mockResolvedValue(history);
		mocks.createCliCore.mockResolvedValueOnce(manager);

		const agent = new AcpAgent({} as AgentSideConnection);
		const { sessionId } = await agent.newSession({
			cwd: "/workspace",
			mcpServers: [],
		});
		await agent.prompt({
			sessionId,
			prompt: [{ type: "text", text: "Start in act mode" }],
		});

		const response = await agent.setSessionConfigOption({
			sessionId,
			configId: "mode",
			value: "plan",
		});

		expect(manager.readMessages).toHaveBeenCalledWith("core-act");
		expect(manager.dispose).toHaveBeenCalledTimes(1);
		expect(response.configOptions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "mode", currentValue: "plan" }),
			]),
		);
		expect(mocks.sendCurrentModeUpdate).toHaveBeenCalledWith(
			expect.anything(),
			sessionId,
			"plan",
		);
	});
});
