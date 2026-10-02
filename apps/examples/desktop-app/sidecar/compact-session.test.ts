import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import type { SidecarContext } from "./types";

const mocks = vi.hoisted(() => ({
	compact: vi.fn(),
}));
vi.mock("./compaction", () => ({
	compactDesktopSessionMessages: mocks.compact,
}));
vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ProviderSettingsManager: class {
			getProviderSettings(id: string) {
				return id === "cline"
					? { provider: "cline", model: "model-a", apiKey: "stored-key" }
					: undefined;
			}
		},
		RuntimeOAuthTokenManager: class {
			async resolveProviderApiKey() {
				return null;
			}
		},
	};
});

const sessionId = "compact-session";
const transcript = [
	{ role: "user" as const, content: "first prompt" },
	{ role: "assistant" as const, content: "first response" },
	{ role: "user" as const, content: "second prompt" },
	{ role: "assistant" as const, content: "second response" },
];
const compactionState = {
	version: 1,
	conversation_id: sessionId,
	source_message_count: 4,
	messages: [{ role: "user", content: "Compacted context" }],
};

function createContext(options: { status?: string; busy?: boolean } = {}) {
	const manager = {
		get: vi.fn(async () => ({ sessionId, status: options.status ?? "idle" })),
		readMessages: vi.fn(async () => transcript),
		updateSessionCompactionState: vi.fn(async () => ({ updated: true })),
		send: vi.fn(),
	};
	const ctx = {
		liveSessions: new Map([
			[
				sessionId,
				{
					config: { provider: "cline", model: "model-a", cwd: "/tmp/project" },
					messages: transcript,
					promptsInQueue: [],
					busy: options.busy ?? false,
					startedAt: Date.now(),
					status: options.busy ? "running" : "idle",
				},
			],
		]),
		restoringWorkspacePaths: new Set(),
		streamIndices: new Map(),
		wsClients: new Set(),
		activeEnvironmentId: "local",
		sessionEnvironmentIds: new Map([[sessionId, "local"]]),
		runtimeBindings: new Map([
			[
				"local",
				{
					environmentId: "local",
					kind: "local",
					workspaceRoot: "/tmp/project",
					sessionManager: manager,
					hubClient: { command: vi.fn(async () => undefined) },
				},
			],
		]),
	} as unknown as SidecarContext;
	return { ctx, manager };
}

beforeEach(() => {
	mocks.compact.mockReset().mockResolvedValue({
		compacted: true,
		compactionState,
	});
});

describe("compact", () => {
	it("summarizes the transcript with the session's credentials and persists the state", async () => {
		const { ctx, manager } = createContext();

		await expect(
			handleChatSessionCommand(ctx, {
				action: "compact",
				sessionId,
				config: { provider: "cline", model: "model-a" },
			}),
		).resolves.toEqual({
			sessionId,
			compacted: true,
			messagesBefore: 4,
			messagesAfter: 1,
		});

		expect(mocks.compact).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId,
				messages: transcript,
				config: expect.objectContaining({
					providerId: "cline",
					modelId: "model-a",
					apiKey: "stored-key",
				}),
			}),
		);
		expect(manager.updateSessionCompactionState).toHaveBeenCalledWith(
			sessionId,
			compactionState,
		);
		expect(manager.send).not.toHaveBeenCalled();
	});

	it("reports a skipped compaction without persisting anything", async () => {
		const { ctx, manager } = createContext();
		mocks.compact.mockResolvedValueOnce({ compacted: false });

		await expect(
			handleChatSessionCommand(ctx, { action: "compact", sessionId }),
		).resolves.toEqual({
			sessionId,
			compacted: false,
			messagesBefore: 4,
			messagesAfter: 4,
		});
		expect(manager.updateSessionCompactionState).not.toHaveBeenCalled();
	});

	it("refuses to compact while a turn is running", async () => {
		const { ctx } = createContext({ busy: true });

		await expect(
			handleChatSessionCommand(ctx, { action: "compact", sessionId }),
		).rejects.toThrow("Cannot compact while the current turn is running");
		expect(mocks.compact).not.toHaveBeenCalled();
	});

	it("fails when the persisted state is rejected", async () => {
		const { ctx, manager } = createContext();
		manager.updateSessionCompactionState.mockResolvedValueOnce({
			updated: false,
		});

		await expect(
			handleChatSessionCommand(ctx, { action: "compact", sessionId }),
		).rejects.toThrow("Compaction could not be saved");
	});
});
