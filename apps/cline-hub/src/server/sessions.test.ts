import { describe, expect, it, vi } from "vitest";
import { createSession, resolveLaunchContext, selectSession } from "./sessions";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

vi.mock("./deps", () => ({
	providerSettingsManager: {},
	workspaceRoot: "/workspace",
}));

function fixture() {
	let resolveHistory!: (history: unknown[]) => void;
	const history = new Promise<unknown[]>((resolve) => { resolveHistory = resolve; });
	const send = vi.fn();
	const ctx = {
		cline: { readMessages: vi.fn(() => history) },
		sessions: new Map(),
		send,
	} as unknown as HubContext;
	const peer = {} as BrowserPeer;
	return { ctx, peer, send, resolveHistory };
}

describe("session attachment", () => {
	it("hydrates the selected session", async () => {
		const { ctx, peer, send, resolveHistory } = fixture();
		const selection = selectSession(ctx, peer, "one");
		resolveHistory([]);
		await selection;
		expect(send).toHaveBeenCalledWith(peer, { type: "session_started", sessionId: "one" });
		expect(send).toHaveBeenCalledWith(peer, expect.objectContaining({ type: "session_hydrated", sessionId: "one", messages: [] }));
	});
	it.each(["two", undefined])("discards history after selection changes to %s", async (nextSessionId) => {
		const { ctx, peer, send, resolveHistory } = fixture();
		const selection = selectSession(ctx, peer, "one");
		peer.selectedSessionId = nextSessionId;
		resolveHistory([]);
		await selection;
		expect(send).not.toHaveBeenCalled();
	});
});


describe("workspace selection", () => {
	const context = { lastSessionContext: { workspaceRoot: "/previous", cwd: "/previous/subdir", providerId: "provider", modelId: "model" } } as HubContext;
	it("uses the chosen root as the working directory for a different workspace", () => {
		expect(resolveLaunchContext(context, { workspaceRoot: "/chosen" })).toMatchObject({ workspaceRoot: "/chosen", cwd: "/chosen" });
	});
	it("preserves the working directory when continuing in the same workspace", () => {
		expect(resolveLaunchContext(context, { workspaceRoot: "/previous" }).cwd).toBe("/previous/subdir");
	});
	it("rejects relative paths before starting a session", async () => {
		const start = vi.fn();
		const ctx = { ...context, cline: { start } } as unknown as HubContext;
		await expect(createSession(ctx, {} as BrowserPeer, "hello", { workspaceRoot: "relative" })).rejects.toThrow("absolute directory path");
		expect(start).not.toHaveBeenCalled();
	});
	it("rejects nonexistent directories before starting a session", async () => {
		const start = vi.fn();
		const ctx = { ...context, cline: { start } } as unknown as HubContext;
		await expect(createSession(ctx, {} as BrowserPeer, "hello", { workspaceRoot: `/missing-workspace-${crypto.randomUUID()}` })).rejects.toThrow("does not exist");
		expect(start).not.toHaveBeenCalled();
	});
});
