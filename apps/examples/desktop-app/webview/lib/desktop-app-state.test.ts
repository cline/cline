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
		environmentId: "local",
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
		let state = createDesktopAppState("welcome", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("forked-session"),
			environmentId: "local",
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
		let state = createDesktopAppState("welcome", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-a"),
			environmentId: "local",
		});
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-b"),
			environmentId: "local",
		});

		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "session-a",
			fallbackThreadId: "fallback-a",
			fallbackEnvironmentId: "local",
		});
		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "session-b",
			fallbackThreadId: "fallback-b",
			fallbackEnvironmentId: "local",
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
		let state = createDesktopAppState("welcome", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("session-a"),
			environmentId: "local",
		});
		const deletion = {
			type: "delete-session" as const,
			deletedSessionId: "session-a",
			fallbackThreadId: "fallback-a",
			fallbackEnvironmentId: "local",
		};

		state = desktopAppReducer(state, deletion);
		expect(desktopAppReducer(state, deletion)).toBe(state);
	});

	it("opens a bot thread once and reuses it on re-open", () => {
		let state = createDesktopAppState("welcome", settingsSection, "local");
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
		let state = createDesktopAppState("welcome", settingsSection, "local");
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
		let state = createDesktopAppState("welcome", settingsSection, "local");
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
			fallbackEnvironmentId: "local",
		});
		expect(
			state.threads.some((thread) => thread.id === botThreadIdFor("bot_a")),
		).toBe(false);
		expect(state.navigation.current.activeThreadId).toBe("fallback-a");
	});

	it("binds drafts to an environment without rebinding started threads", () => {
		let state = createDesktopAppState("welcome", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "bind-unstarted-thread",
			threadId: "welcome",
			environmentId: "pi-host",
		});
		expect(state.threads[0]?.environmentId).toBe("pi-host");

		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "welcome",
		});
		state = desktopAppReducer(state, {
			type: "bind-unstarted-thread",
			threadId: "welcome",
			environmentId: "other-host",
		});
		expect(state.threads[0]?.environmentId).toBe("pi-host");
	});

	it("carries environment identity through new and restored threads", () => {
		let state = createDesktopAppState("welcome", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "new-thread",
			threadId: "remote-draft",
			environmentId: "pi-host",
		});
		expect(state.threads.at(-1)).toMatchObject({
			id: "remote-draft",
			environmentId: "pi-host",
		});

		state = desktopAppReducer(state, {
			type: "open-session",
			session: {
				...createSession("remote-session"),
				environmentId: "pi-host",
				workspaceRoot: "/home/pi/project",
				cwd: "/home/pi/project",
			},
			environmentId: "pi-host",
		});
		expect(state.threads.at(-1)).toMatchObject({
			id: "session_remote-session",
			environmentId: "pi-host",
			historySession: { environmentId: "pi-host" },
		});
	});

	it("creates one draft per selected environment and reuses it", () => {
		let state = createDesktopAppState("local-draft", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "select-environment-draft",
			environmentId: "pi-host",
			threadId: "remote-draft",
		});

		expect(state.navigation.current).toMatchObject({
			activeThreadId: "remote-draft",
			view: "chat",
		});
		expect(state.threads).toContainEqual({
			id: "remote-draft",
			environmentId: "pi-host",
		});

		const selectedAgain = desktopAppReducer(state, {
			type: "select-environment-draft",
			environmentId: "pi-host",
			threadId: "duplicate-remote-draft",
		});
		expect(selectedAgain).toBe(state);
		expect(
			selectedAgain.threads.filter(
				(thread) => thread.environmentId === "pi-host" && !thread.hasStarted,
			),
		).toHaveLength(1);

		state = desktopAppReducer(selectedAgain, {
			type: "select-environment-draft",
			environmentId: "local",
			threadId: "duplicate-local-draft",
		});
		expect(state.navigation.current.activeThreadId).toBe("local-draft");
		expect(
			state.threads.some((thread) => thread.id === "duplicate-local-draft"),
		).toBe(false);
	});

	it("does not reuse a started thread as an environment draft", () => {
		let state = createDesktopAppState("local-draft", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "local-draft",
		});
		state = desktopAppReducer(state, {
			type: "select-environment-draft",
			environmentId: "local",
			threadId: "fresh-local-draft",
		});

		expect(state.navigation.current.activeThreadId).toBe("fresh-local-draft");
		expect(state.threads.at(-1)).toEqual({
			id: "fresh-local-draft",
			environmentId: "local",
		});
	});
});
