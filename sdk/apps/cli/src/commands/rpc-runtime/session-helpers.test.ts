import { describe, expect, it, vi } from "vitest";

vi.mock("@clinebot/core", () => ({
	LlmsProviders: {
		normalizeProviderId: vi.fn((provider: string) => provider),
	},
	setHomeDir: vi.fn(),
	setHomeDirIfUnset: vi.fn(),
}));

vi.mock("@clinebot/core", () => ({
	SessionSource: {
		CLI: "cli",
	},
}));

vi.mock("../../runtime/prompt", () => ({
	resolveSystemPrompt: vi.fn(async () => "resolved system prompt"),
}));

vi.mock("../../logging/adapter", () => ({
	createCliLoggerAdapter: vi.fn(() => ({
		core: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	})),
}));

vi.mock("../../utils/telemetry", () => ({
	getCliTelemetryService: vi.fn(() => undefined),
}));

describe("buildSessionStartInput", () => {
	it("keeps maxIterations unset when not provided", async () => {
		const { buildSessionStartInput } = await import("./session-helpers");
		const hooks = { onRunStart: vi.fn() };
		const built = await buildSessionStartInput({
			sessionId: "session-123",
			hooks,
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				workspaceRoot: process.cwd(),
				cwd: process.cwd(),
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
				autoApproveTools: true,
			} as any,
		});

		expect(built.sessionInput.config.sessionId).toBe("session-123");
		expect(built.sessionInput.config.maxIterations).toBeUndefined();
		expect(built.sessionInput.config.hooks).toBe(hooks);
	});
});

describe("rpc-runtime payload parsing", () => {
	it("normalizes null maxIterations in start payload to undefined", async () => {
		const { parseStartPayload } = await import("./session-helpers");
		const parsed = parseStartPayload({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			workspaceRoot: process.cwd(),
			cwd: process.cwd(),
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			autoApproveTools: true,
			maxIterations: null,
		} as any);
		expect(parsed.maxIterations).toBeUndefined();
	});

	it("normalizes null maxIterations in send payload config to undefined", async () => {
		const { parseSendPayload } = await import("./session-helpers");
		const parsed = parseSendPayload({
			prompt: "hey",
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				workspaceRoot: process.cwd(),
				cwd: process.cwd(),
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				autoApproveTools: true,
				maxIterations: null,
			},
		} as any);
		expect(parsed.config.maxIterations).toBeUndefined();
	});
});
