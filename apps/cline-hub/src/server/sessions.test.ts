import type { ClineCore, SessionRecord } from "@cline/core";
import { SessionNotFoundError, SessionSource } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { selectSession, sendMessage } from "./sessions";
import { HubContext } from "./state";
import type { BrowserPeer } from "./types";

vi.mock("./deps", () => ({
	providerSettingsManager: {},
	workspaceRoot: "/dashboard",
}));
vi.mock("./providers", () => ({}));
vi.mock("./state-payloads", () => ({}));
vi.mock("./session-mapping", () => ({
	mapHistoryToWebviewMessages: (messages: unknown[]) => messages,
}));

function fixture(autoApproveTools?: boolean) {
	const sessionId = "saved-session";
	const record: SessionRecord = {
		sessionId,
		source: SessionSource.CLI,
		status: "completed",
		isSubagent: false,
		startedAt: "2026-09-19T13:00:00.000Z",
		updatedAt: "2026-09-19T13:01:00.000Z",
		interactive: true,
		provider: "anthropic",
		model: "saved-model",
		workspaceRoot: "/original-workspace",
		cwd: "/original-workspace/subdir",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		metadata: {
			mode: "plan",
			systemPrompt: "Saved instructions",
			autoApproveTools,
		},
	};
	const history = [
		{ role: "user", content: "Remember this conversation" },
		{ role: "assistant", content: [{ type: "text", text: "Remembered" }] },
	];
	const missing = new SessionNotFoundError(sessionId);
	const cline = {
		get: vi.fn().mockResolvedValue(record),
		readMessages: vi.fn().mockResolvedValue(history),
		start: vi.fn().mockResolvedValue({ sessionId }),
		send: vi.fn().mockRejectedValueOnce(missing).mockResolvedValue(undefined),
	};
	const ctx = new HubContext();
	ctx.cline = cline as unknown as ClineCore;
	ctx.send = vi.fn();
	const peer = { selectedSessionId: sessionId } as BrowserPeer;
	return { ctx, peer, cline, sessionId, record, history, missing };
}

describe("dashboard history resume", () => {
	it("opens saved history and resumes the same session before sending again", async () => {
		const { ctx, peer, cline, sessionId, history } = fixture(false);
		await selectSession(ctx, peer, sessionId);
		expect(cline.start).not.toHaveBeenCalled();
		expect(ctx.send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "session_hydrated",
				messages: history,
			}),
		);

		const images = ["data:image/png;base64,fixture"];
		await sendMessage(
			ctx,
			peer,
			"Continue",
			{ mode: "plan" },
			{ userImages: images },
		);

		expect(cline.start).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				source: SessionSource.CLI,
				interactive: true,
				initialMessages: history,
				config: expect.objectContaining({
					sessionId,
					providerId: "anthropic",
					modelId: "saved-model",
					cwd: "/original-workspace/subdir",
					workspaceRoot: "/original-workspace",
					systemPrompt: "Saved instructions",
					mode: "plan",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				}),
				toolPolicies: { "*": { autoApprove: false } },
			}),
		);
		expect(cline.start.mock.calls[0][0]).not.toHaveProperty("prompt");
		expect(cline.send.mock.calls).toEqual([
			[{ sessionId, prompt: "Continue", mode: "plan", userImages: images }],
			[{ sessionId, prompt: "Continue", mode: "plan", userImages: images }],
		]);
		expect(peer.selectedSessionId).toBe(sessionId);
	});

	it("does not restart an active session", async () => {
		const { ctx, peer, cline } = fixture();
		cline.send.mockReset().mockResolvedValue(undefined);
		await sendMessage(ctx, peer, "Continue");
		expect(cline.send).toHaveBeenCalledTimes(1);
		expect(cline.get).not.toHaveBeenCalled();
		expect(cline.start).not.toHaveBeenCalled();
	});

	it("does not retry provider errors, even with similar error text", async () => {
		const { ctx, peer, cline } = fixture();
		const error = new Error("provider session not found");
		cline.send.mockReset().mockRejectedValue(error);
		await expect(sendMessage(ctx, peer, "Continue")).rejects.toBe(error);
		expect(cline.start).not.toHaveBeenCalled();
		expect(cline.send).toHaveBeenCalledTimes(1);
	});

	it("does not recreate a deleted session", async () => {
		const { ctx, peer, cline, missing } = fixture();
		cline.get.mockResolvedValue(undefined);
		await expect(sendMessage(ctx, peer, "Continue")).rejects.toBe(missing);
		expect(cline.start).not.toHaveBeenCalled();
	});

	it("does not replace history when reading it fails", async () => {
		const { ctx, peer, cline } = fixture();
		const error = new Error("Unable to read history");
		cline.readMessages.mockRejectedValue(error);
		await expect(sendMessage(ctx, peer, "Continue")).rejects.toBe(error);
		expect(cline.start).not.toHaveBeenCalled();
	});

	it("does not overwrite an existing session with empty history", async () => {
		const { ctx, peer, cline } = fixture();
		cline.readMessages.mockResolvedValue([]);
		await expect(sendMessage(ctx, peer, "Continue")).rejects.toThrow(/empty/i);
		expect(cline.start).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		false,
		true,
	])("preserves explicit approval opt-in: %s", async (autoApproveTools) => {
		const { ctx, peer, cline } = fixture(autoApproveTools);
		await sendMessage(ctx, peer, "Continue");
		expect(cline.start.mock.calls[0][0].toolPolicies).toEqual({
			"*": { autoApprove: autoApproveTools === true },
		});
	});

	it("propagates a failed retry without another restore", async () => {
		const { ctx, peer, cline, missing } = fixture();
		cline.send.mockRejectedValue(missing);
		await expect(sendMessage(ctx, peer, "Continue")).rejects.toBe(missing);
		expect(cline.send).toHaveBeenCalledTimes(2);
		expect(cline.start).toHaveBeenCalledTimes(1);
	});

	it("allows another attempt after a failed restore", async () => {
		const { ctx, peer, cline, missing } = fixture();
		const error = new Error("Provider is not configured");
		cline.start.mockRejectedValueOnce(error);
		await expect(sendMessage(ctx, peer, "Continue")).rejects.toBe(error);
		cline.send.mockRejectedValueOnce(missing);
		await sendMessage(ctx, peer, "Try again");
		expect(cline.start).toHaveBeenCalledTimes(2);
	});

	it("does not restart twice when another browser's missing error arrives late", async () => {
		const { ctx, peer, cline, missing } = fixture();
		let rejectSecond!: (error: Error) => void;
		cline.send
			.mockReset()
			.mockRejectedValueOnce(missing)
			.mockImplementationOnce(
				() =>
					new Promise((_, reject) => {
						rejectSecond = reject;
					}),
			)
			.mockResolvedValue(undefined);
		const first = sendMessage(ctx, peer, "First browser");
		const second = sendMessage(ctx, { ...peer }, "Second browser");
		await first;
		rejectSecond(missing);
		await second;
		expect(cline.start).toHaveBeenCalledTimes(1);
		expect(cline.send).toHaveBeenCalledTimes(4);
	});

	it("can restore again after a later hub restart", async () => {
		const { ctx, peer, cline, missing } = fixture();
		await sendMessage(ctx, peer, "Continue");
		cline.send.mockRejectedValueOnce(missing);
		await sendMessage(ctx, peer, "Continue after restart");
		expect(cline.start).toHaveBeenCalledTimes(2);
	});
});
