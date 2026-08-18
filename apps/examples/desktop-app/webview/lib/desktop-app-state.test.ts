import { describe, expect, it } from "vitest";
import {
	botThreadIdFor,
	createDesktopAppState,
	desktopAppReducer,
} from "./desktop-app-state";
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
	it("hands an edited prompt to a fork exactly once", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("forked-session"),
			initialPromptDraft: "Revise this prompt",
		});

		expect(
			state.threads.find((thread) => thread.id === "session_forked-session")
				?.initialPromptDraft,
		).toBe("Revise this prompt");

		state = desktopAppReducer(state, {
			type: "consume-initial-prompt-draft",
			threadId: "session_forked-session",
		});

		expect(
			state.threads.find((thread) => thread.id === "session_forked-session")
				?.initialPromptDraft,
		).toBeUndefined();
	});

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

	it("opens a bot thread once and reuses it on re-open", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, { type: "open-bot", botId: "bot_a" });

		const threadId = botThreadIdFor("bot_a");
		expect(state.navigation.current.activeThreadId).toBe(threadId);
		const botThread = state.threads.find((thread) => thread.id === threadId);
		expect(botThread?.botId).toBe("bot_a");
		expect(botThread?.historySession).toBeUndefined();

		// Re-opening with a resolved session attaches it to the same thread.
		state = desktopAppReducer(state, {
			type: "navigate",
			destination: {
				...state.navigation.current,
				activeThreadId: "welcome",
			},
		});
		state = desktopAppReducer(state, {
			type: "open-bot",
			botId: "bot_a",
			session: createSession("bot-session"),
		});
		const reopened = state.threads.filter((thread) => thread.id === threadId);
		expect(reopened).toHaveLength(1);
		expect(reopened[0]?.historySession?.sessionId).toBe("bot-session");
		expect(reopened[0]?.hasStarted).toBe(true);
		expect(state.navigation.current.activeThreadId).toBe(threadId);
	});

	it("keeps a hydrated bot session when re-opened without a fresh lookup", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-bot",
			botId: "bot_a",
			session: createSession("bot-session"),
		});
		state = desktopAppReducer(state, { type: "open-bot", botId: "bot_a" });
		const thread = state.threads.find(
			(candidate) => candidate.id === botThreadIdFor("bot_a"),
		);
		expect(thread?.historySession?.sessionId).toBe("bot-session");
		expect(thread?.hasStarted).toBe(true);
	});

	it("removes a bot thread through delete-session", () => {
		let state = createDesktopAppState("welcome", settingsSection);
		state = desktopAppReducer(state, {
			type: "open-bot",
			botId: "bot_a",
			session: createSession("bot-session"),
		});
		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "bot-session",
			deletedThreadId: botThreadIdFor("bot_a"),
			fallbackThreadId: "fallback-a",
		});
		expect(
			state.threads.some((thread) => thread.id === botThreadIdFor("bot_a")),
		).toBe(false);
		expect(state.navigation.current.activeThreadId).toBe("fallback-a");
	});
});
