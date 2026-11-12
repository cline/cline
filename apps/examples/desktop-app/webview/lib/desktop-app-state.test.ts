import { describe, expect, it } from "vitest";
import { createDesktopAppState, desktopAppReducer } from "./desktop-app-state";
import type { SessionHistoryItem } from "./session-history";
import { sessionKey } from "./session-identity";

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
	it("reuses a bound thread when opening its session and keeps other environments separate", () => {
		let state = createDesktopAppState("new-local", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "new-local",
			sessionId: "same-id",
		});
		state = desktopAppReducer(state, {
			type: "new-thread",
			threadId: "new-remote",
			environmentId: "remote",
		});
		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "new-remote",
			sessionId: "same-id",
		});
		for (const environmentId of ["local", "remote", "local"]) {
			state = desktopAppReducer(state, {
				type: "open-session",
				session: createSession("same-id"),
				environmentId,
			});
			expect(state.navigation.current.activeThreadId).toBe(
				`new-${environmentId}`,
			);
			expect(state.threads).toHaveLength(2);
		}
		state = desktopAppReducer(state, {
			type: "update-session-metadata",
			sessionId: "same-id",
			environmentId: "local",
			metadata: { title: "Local title" },
		});
		expect(state.threads[0].historySession?.metadata?.title).toBe(
			"Local title",
		);
		expect(state.threads[1].historySession?.metadata?.title).toBeUndefined();
		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "same-id",
			environmentId: "local",
			fallbackThreadId: "fallback",
			fallbackEnvironmentId: "local",
		});
		expect(state.threads.map((thread) => thread.id)).toEqual([
			"new-remote",
			"fallback",
		]);
		expect(
			state.navigation.back.some(
				(location) => location.activeThreadId === "new-local",
			),
		).toBe(false);
	});

	it("keeps identical session IDs separate across environments", () => {
		let state = createDesktopAppState("welcome", settingsSection, "local");
		for (const environmentId of ["local", "remote"]) {
			state = desktopAppReducer(state, {
				type: "open-session",
				session: { ...createSession("same-id"), environmentId },
				environmentId,
			});
		}
		expect(
			state.threads.filter(
				(thread) => thread.historySession?.sessionId === "same-id",
			),
		).toHaveLength(2);
		state = desktopAppReducer(state, {
			type: "update-session-metadata",
			sessionId: "same-id",
			environmentId: "remote",
			metadata: { title: "Remote title" },
		});
		expect(
			state.threads.find(
				(thread) => thread.environmentId === "local" && thread.historySession,
			)?.historySession?.metadata?.title,
		).toBeUndefined();
		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "same-id",
			environmentId: "remote",
			fallbackThreadId: "fallback",
			fallbackEnvironmentId: "local",
		});
		expect(
			state.threads
				.filter((thread) => thread.historySession?.sessionId === "same-id")
				.map((thread) => thread.environmentId),
		).toEqual(["local"]);
	});

	it("hands an edited prompt to a fork exactly once", () => {
		let state = createDesktopAppState("welcome", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "open-session",
			session: createSession("forked-session"),
			environmentId: "local",
			initialPromptDraft: "Revise this prompt",
		});

		expect(
			state.threads.find(
				(thread) =>
					thread.id ===
					`session_${sessionKey({ sessionId: "forked-session", environmentId: "local" })}`,
			)?.initialPromptDraft,
		).toBe("Revise this prompt");

		state = desktopAppReducer(state, {
			type: "consume-initial-prompt-draft",
			threadId: `session_${sessionKey({ sessionId: "forked-session", environmentId: "local" })}`,
		});

		expect(
			state.threads.find(
				(thread) =>
					thread.id ===
					`session_${sessionKey({ sessionId: "forked-session", environmentId: "local" })}`,
			)?.initialPromptDraft,
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
			expect.objectContaining({
				activeThreadId: `session_${sessionKey({ sessionId: "session-a", environmentId: "local" })}`,
			}),
		);
		expect([
			...state.navigation.back,
			state.navigation.current,
			...state.navigation.forward,
		]).not.toContainEqual(
			expect.objectContaining({
				activeThreadId: `session_${sessionKey({ sessionId: "session-b", environmentId: "local" })}`,
			}),
		);
	});

	it("closes a thread started in-app when its session is deleted elsewhere", () => {
		let state = createDesktopAppState("draft", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "draft",
		});
		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "draft",
			sessionId: "live-session",
		});
		expect(state.threads[0]).toMatchObject({
			id: "draft",
			hasStarted: true,
			sessionId: "live-session",
		});

		state = desktopAppReducer(state, {
			type: "delete-session",
			deletedSessionId: "live-session",
			environmentId: "local",
			fallbackThreadId: "fallback",
			fallbackEnvironmentId: "local",
		});
		expect(state.threads.map((thread) => thread.id)).toEqual(["fallback"]);
		expect(state.navigation.current).toMatchObject({
			activeThreadId: "fallback",
			view: "chat",
		});
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
			id: `session_${sessionKey({ sessionId: "remote-session", environmentId: "pi-host" })}`,
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

	it("keeps a Factory intake draft out of ordinary new-session reuse", () => {
		let state = createDesktopAppState("local-draft", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "local-draft",
		});
		state = desktopAppReducer(state, {
			type: "new-thread",
			threadId: "intake-draft",
			environmentId: "local",
			factoryIntake: true,
		});
		expect(state.threads.at(-1)).toEqual({
			id: "intake-draft",
			environmentId: "local",
			factoryIntake: true,
		});
		state = desktopAppReducer(state, {
			type: "select-environment-draft",
			environmentId: "local",
			threadId: "chat-draft",
		});
		expect(state.navigation.current.activeThreadId).toBe("chat-draft");
		expect(state.threads.at(-1)).toEqual({
			id: "chat-draft",
			environmentId: "local",
		});
	});

	it("gives the Ask Factory panel a manager thread without leaving the view", () => {
		let state = createDesktopAppState("local-draft", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "navigate",
			destination: { ...state.navigation.current, view: "factory" },
		});
		const navigation = state.navigation;
		state = desktopAppReducer(state, {
			type: "ensure-factory-manager",
			threadId: "manager",
			environmentId: "local",
		});
		expect(state.navigation).toBe(navigation);
		expect(state.threads.at(-1)).toEqual({
			id: "manager",
			environmentId: "local",
			factoryManager: true,
		});

		// The panel keeps one conversation, started or not.
		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "manager",
			sessionId: "session-1",
		});
		expect(
			desktopAppReducer(state, {
				type: "ensure-factory-manager",
				threadId: "manager-2",
				environmentId: "local",
			}),
		).toBe(state);

		// New conversation adds another and it becomes the latest.
		const fresh = desktopAppReducer(state, {
			type: "ensure-factory-manager",
			threadId: "manager-2",
			environmentId: "local",
			fresh: true,
		});
		expect(fresh.navigation).toBe(navigation);
		expect(fresh.threads.filter((thread) => thread.factoryManager)).toEqual([
			expect.objectContaining({ id: "manager" }),
			{ id: "manager-2", environmentId: "local", factoryManager: true },
		]);

		// Coming back attaches the session record to the same thread.
		state = desktopAppReducer(state, {
			type: "ensure-factory-manager",
			threadId: "unused",
			environmentId: "local",
			session: createSession("session-1"),
		});
		expect(state.navigation).toBe(navigation);
		expect(state.threads.at(-1)).toMatchObject({
			id: "manager",
			factoryManager: true,
			hasStarted: true,
			historySession: { sessionId: "session-1", environmentId: "local" },
		});
	});

	it("hands the Ask Factory panel a draft without leaving the view", () => {
		let state = createDesktopAppState("local-draft", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "navigate",
			destination: { ...state.navigation.current, view: "factory" },
		});
		const navigation = state.navigation;
		state = desktopAppReducer(state, {
			type: "ensure-factory-manager",
			threadId: "manager",
			environmentId: "local",
			initialPromptDraft: "My feedback on F12",
		});
		expect(state.navigation).toBe(navigation);
		expect(state.threads.at(-1)).toEqual({
			id: "manager",
			environmentId: "local",
			factoryManager: true,
			initialPromptDraft: "My feedback on F12",
		});
		state = desktopAppReducer(state, {
			type: "consume-initial-prompt-draft",
			threadId: "manager",
		});
		// The existing conversation takes a later draft too.
		state = desktopAppReducer(state, {
			type: "ensure-factory-manager",
			threadId: "unused",
			environmentId: "local",
			initialPromptDraft: "My feedback on F13",
		});
		expect(state.navigation).toBe(navigation);
		expect(state.threads.filter((thread) => thread.factoryManager)).toEqual([
			{
				id: "manager",
				environmentId: "local",
				factoryManager: true,
				initialPromptDraft: "My feedback on F13",
			},
		]);
	});

	it("reopens a stored manager session after a restart as a flagged thread", () => {
		let state = createDesktopAppState("local-draft", settingsSection, "local");
		const navigation = state.navigation;
		state = desktopAppReducer(state, {
			type: "ensure-factory-manager",
			threadId: "unused",
			environmentId: "local",
			session: createSession("stored"),
		});
		expect(state.navigation).toBe(navigation);
		expect(state.threads.at(-1)).toMatchObject({
			id: `session_${sessionKey({ sessionId: "stored", environmentId: "local" })}`,
			factoryManager: true,
			historySession: { sessionId: "stored" },
		});
	});

	it("returns to an unstarted Factory manager thread and keeps it out of new-session reuse", () => {
		let state = createDesktopAppState("local-draft", settingsSection, "local");
		state = desktopAppReducer(state, {
			type: "open-factory-manager",
			threadId: "manager",
			environmentId: "local",
		});
		expect(state.threads.at(-1)).toEqual({
			id: "manager",
			environmentId: "local",
			factoryManager: true,
		});
		expect(state.navigation.current).toMatchObject({
			activeThreadId: "manager",
			view: "chat",
		});

		// Opening it again from Factory returns to the same unstarted thread.
		state = desktopAppReducer(state, {
			type: "navigate",
			destination: { ...state.navigation.current, view: "factory" },
		});
		state = desktopAppReducer(state, {
			type: "open-factory-manager",
			threadId: "manager-2",
			environmentId: "local",
		});
		expect(state.navigation.current.activeThreadId).toBe("manager");
		expect(
			state.threads.filter((thread) => thread.factoryManager),
		).toHaveLength(1);
		expect(
			desktopAppReducer(state, {
				type: "open-factory-manager",
				threadId: "manager-3",
				environmentId: "local",
			}),
		).toBe(state);

		// New session never lands on the manager draft.
		const chat = desktopAppReducer(state, {
			type: "select-environment-draft",
			environmentId: "local",
			threadId: "chat-draft",
		});
		expect(chat.navigation.current.activeThreadId).toBe("local-draft");

		// Once started, Ask Factory opens a fresh manager conversation.
		state = desktopAppReducer(state, {
			type: "thread-started",
			threadId: "manager",
			sessionId: "session-1",
		});
		state = desktopAppReducer(state, {
			type: "open-factory-manager",
			threadId: "manager-4",
			environmentId: "local",
		});
		expect(state.navigation.current.activeThreadId).toBe("manager-4");
		expect(state.threads.at(-1)).toEqual({
			id: "manager-4",
			environmentId: "local",
			factoryManager: true,
		});
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
