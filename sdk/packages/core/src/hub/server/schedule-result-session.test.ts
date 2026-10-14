import { describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../../types/sessions";
import { buildHubEvent, type HubTransportContext } from "./handlers/context";
import type { HubRunRecord } from "./hub-run-queue";
import { prepareScheduleResultSession } from "./schedule-result-session";

function fixture() {
	const session: SessionRecord = {
		sessionId: "origin",
		source: "core",
		startedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		status: "completed",
		interactive: true,
		provider: "test",
		model: "test",
		cwd: "/project",
		workspaceRoot: "/project",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		metadata: {
			mode: "act",
			systemPrompt: "Original instructions",
			autoApproveTools: false,
		},
	};
	const messages = [{ role: "user", content: "Original request" }];
	const startSession = vi.fn(async () => ({
		sessionId: "origin",
		manifestPath: "",
		messagesPath: "",
	}));
	const getSession = vi.fn(async () => session as SessionRecord | undefined);
	const ctx: HubTransportContext = {
		sessionSearch: { removeSession: vi.fn() } as never,
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		activeRpcTurnCountBySession: new Map(),
		sessionHost: {
			startSession,
			getSession,
			readSessionMessages: vi.fn(async () => messages),
			readSessionCompactionState: vi.fn(async () => undefined),
		} as never,
		publish: vi.fn(),
		buildEvent: buildHubEvent,
		requestCapability: vi.fn(),
	};
	const run: HubRunRecord = {
		runId: "schedule-result:r1",
		sessionId: "origin",
		state: "queued",
		input: { prompt: "result" },
		acceptedAt: Date.now(),
	};
	return { ctx, run, startSession, getSession, messages };
}

describe("scheduled result session restoration", () => {
	it("resumes the original ID and history through the Hub bootstrap without changing its tool approval policy", async () => {
		const { ctx, run, startSession, messages } = fixture();
		const approve = vi.fn(async () => ({ approved: false }));
		await prepareScheduleResultSession(ctx, run, approve);
		expect(startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				resumeExistingSession: true,
				interactive: true,
				initialMessages: messages,
				config: expect.objectContaining({
					sessionId: "origin",
					providerId: "test",
					cwd: "/project",
					systemPrompt: "Original instructions",
				}),
				capabilities: expect.objectContaining({ requestToolApproval: approve }),
				toolPolicies: undefined,
			}),
		);
	});
	it("does not recreate a deleted session", async () => {
		const { ctx, run, startSession, getSession } = fixture();
		getSession.mockResolvedValue(undefined);
		await expect(
			prepareScheduleResultSession(ctx, run, vi.fn()),
		).rejects.toThrow("deleted");
		expect(startSession).not.toHaveBeenCalled();
	});
	it("does not restore ordinary queue submissions", async () => {
		const { ctx, run, startSession, getSession } = fixture();
		await prepareScheduleResultSession(
			ctx,
			{ ...run, runId: "hrun_1" },
			vi.fn(),
		);
		expect(getSession).not.toHaveBeenCalled();
		expect(startSession).not.toHaveBeenCalled();
	});
});
