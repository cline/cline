import { describe, expect, it } from "vitest";
import { createDesktopAppState, desktopAppReducer } from "./desktop-app-state";
import type { SessionHistoryItem } from "./session-history";

const settingsSection = "General" as const;

function createSession(sessionId: string): SessionHistoryItem {
	return {
		sessionId,
		status: "completed",
		provider: "test-provider",
		model: "test-model",
		cwd: "/workspace",
		workspaceRoot: "/workspace",
		startedAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("desktopAppReducer", () => {
	it("keeps both sessions deleted when deletion actions are queued together", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-a"),
		});
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-b"),
		});

		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "session-a",
			fallbackThreadId: "fallback-a",
		});
		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "session-b",
			fallbackThreadId: "fallback-b",
		});

		expect(state.threads.map((thread) => thread.id)).toEqual([
			"welcome",
			"fallback-b",
		]);
		expect(state.navigation.current.activeThreadId).toBe("fallback-b");
		expect([
			...state.navigation.back,
			state.navigation.current,
			...state.navigation.forward,
		]).not.toContainEqual(
			expect.objectContaining({ activeThreadId: "session_session-a" }),
		);
		expect([
			...state.navigation.back,
			state.navigation.current,
			...state.navigation.forward,
		]).not.toContainEqual(
			expect.objectContaining({ activeThreadId: "session_session-b" }),
		);
	});

	it("ignores a duplicate deletion after its thread and history are removed", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-a"),
		});
		const deletion = {
			type: "delete-session" as const,
			deletedSessionId: "session-a",
			fallbackThreadId: "fallback-a",
		};

		state = desktopAppReducer(state, deletion);
		expect(desktopAppReducer(state, deletion)).toBe(state);
	});
});
