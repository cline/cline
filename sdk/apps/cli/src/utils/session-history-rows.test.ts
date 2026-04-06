import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
	createDefaultCliSessionManager: vi.fn(),
	listSessions: vi.fn(),
}));

const summaryMocks = vi.hoisted(() => ({
	inferProviderAndModelFromMessages: vi.fn(),
	inferTitleFromMessages: vi.fn(),
	summarizeCostFromMessages: vi.fn(),
}));

vi.mock("./session", () => sessionMocks);
vi.mock("./session-message-summary", () => summaryMocks);

describe("session history rows", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("skips session-manager hydration when rows already have display metadata", async () => {
		const { hydrateHistoryRows } = await import("./session-history-rows");
		const rows = [
			{
				sessionId: "sess_1",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				startedAt: "2026-04-06T22:45:01.101Z",
				prompt: "Hey",
				metadata: {
					title: "Hey",
					totalCost: 0.02,
				},
			},
		];

		const hydrated = await hydrateHistoryRows(rows);

		expect(hydrated).toEqual(rows);
		expect(sessionMocks.createDefaultCliSessionManager).not.toHaveBeenCalled();
	});

	it("hydrates missing metadata from stored messages when needed", async () => {
		const dispose = vi.fn().mockResolvedValue(undefined);
		const readMessages = vi
			.fn()
			.mockResolvedValue([
				{ role: "user", content: [{ type: "text", text: "hello" }] },
			]);
		sessionMocks.createDefaultCliSessionManager.mockResolvedValue({
			readMessages,
			dispose,
		});
		summaryMocks.inferTitleFromMessages.mockReturnValue("hello");
		summaryMocks.inferProviderAndModelFromMessages.mockReturnValue({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		});
		summaryMocks.summarizeCostFromMessages.mockReturnValue(0.02);

		const { hydrateHistoryRows } = await import("./session-history-rows");
		const [hydrated] = await hydrateHistoryRows([
			{
				sessionId: "sess_2",
				startedAt: "2026-04-06T22:45:01.101Z",
				prompt: "hello",
				metadata: {},
			},
		]);

		expect(sessionMocks.createDefaultCliSessionManager).toHaveBeenCalledTimes(
			1,
		);
		expect(readMessages).toHaveBeenCalledWith("sess_2");
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(hydrated).toMatchObject({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			metadata: {
				title: undefined,
				totalCost: 0.02,
			},
		});
	});
});
