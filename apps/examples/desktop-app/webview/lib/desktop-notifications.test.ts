// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (payload: unknown) => void;

const mocks = vi.hoisted(() => ({
	eventHandlers: new Map<string, Set<EventHandler>>(),
	focused: false,
	invoke: vi.fn(),
	isPermissionGranted: vi.fn(),
	requestPermission: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: mocks.invoke,
		subscribe: (eventName: string, handler: EventHandler) => {
			const handlers = mocks.eventHandlers.get(eventName) ?? new Set();
			handlers.add(handler);
			mocks.eventHandlers.set(eventName, handlers);
			return () => handlers.delete(handler);
		},
	},
	isTauriAvailable: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		isFocused: async () => mocks.focused,
	}),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
	isPermissionGranted: mocks.isPermissionGranted,
	requestPermission: mocks.requestPermission,
}));

function emit(eventName: string, payload: unknown): void {
	for (const handler of mocks.eventHandlers.get(eventName) ?? []) {
		handler(payload);
	}
}

async function importFresh() {
	vi.resetModules();
	return await import("./desktop-notifications");
}

beforeEach(() => {
	window.localStorage.clear();
	mocks.eventHandlers.clear();
	mocks.focused = false;
	mocks.invoke.mockReset().mockResolvedValue(undefined);
	mocks.isPermissionGranted.mockReset().mockResolvedValue(true);
	mocks.requestPermission.mockReset().mockResolvedValue("granted");
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("desktop notifications", () => {
	it("notifies once when a background approval remains in state snapshots", async () => {
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();
		const payload = {
			sessionId: "session-1",
			items: [
				{
					requestId: "approval-1",
					toolName: "run_commands",
				},
			],
		};

		emit("tool_approval_state", payload);
		emit("tool_approval_state", payload);

		await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith("show_session_notification", {
			title: "Approval needed",
			body: "run_commands is waiting for your approval.",
			sessionId: "session-1",
			sound: undefined,
		});
		stop();
	});

	it("deduplicates chat completion and session-ended terminal events", async () => {
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();

		emit("chat_event", {
			sessionId: "session-2",
			stream: "chat_done",
			chunk: JSON.stringify({ reason: "completed" }),
		});
		emit("chat_session_ended", {
			sessionId: "session-2",
			reason: "completed",
		});

		await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith(
			"show_session_notification",
			expect.objectContaining({
				title: "Task completed",
				sessionId: "session-2",
			}),
		);
		stop();
	});

	it("does not notify while the native window is focused", async () => {
		mocks.focused = true;
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();

		emit("ask_question_requested", {
			requestId: "question-1",
			sessionId: "session-3",
			question: "Which branch should I use?",
		});

		await new Promise((resolve) => window.setTimeout(resolve, 0));
		expect(mocks.invoke).not.toHaveBeenCalled();
		stop();
	});

	it("routes questions to their session and applies the event sound setting", async () => {
		vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		);
		const {
			DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
			watchDesktopNotifications,
			writeDesktopNotificationSettings,
		} = await importFresh();
		writeDesktopNotificationSettings({
			...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
			questionAsked: { enabled: true, sound: true },
		});
		const stop = watchDesktopNotifications();

		emit("ask_question_requested", {
			requestId: "question-2",
			sessionId: "session-4",
			question: "Which branch should I use?",
		});

		await vi.waitFor(() =>
			expect(mocks.invoke).toHaveBeenCalledWith("show_session_notification", {
				title: "Cline has a question",
				body: "Which branch should I use?",
				sessionId: "session-4",
				sound: "Default",
			}),
		);
		stop();
	});

	it("reports the default permission state when native permission is undecided", async () => {
		mocks.isPermissionGranted.mockResolvedValue(false);
		vi.stubGlobal("Notification", undefined);
		const { getDesktopNotificationPermission } = await importFresh();

		await expect(getDesktopNotificationPermission()).resolves.toBe("default");
	});

	it("deduplicates session errors and includes their detail", async () => {
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();

		emit("chat_event", {
			sessionId: "session-5",
			stream: "chat_done",
			chunk: JSON.stringify({
				reason: "error",
				text: "The provider is unavailable.",
			}),
		});
		emit("chat_session_ended", {
			sessionId: "session-5",
			reason: "error",
		});

		await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith(
			"show_session_notification",
			expect.objectContaining({
				title: "Task failed",
				body: "The provider is unavailable.",
				sessionId: "session-5",
			}),
		);
		stop();
	});

	it("persists independent event and sound preferences", async () => {
		const {
			DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
			readDesktopNotificationSettings,
			writeDesktopNotificationSettings,
		} = await importFresh();
		writeDesktopNotificationSettings({
			...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
			approvalNeeded: { enabled: false, sound: true },
		});

		expect(readDesktopNotificationSettings().approvalNeeded).toEqual({
			enabled: false,
			sound: true,
		});
		expect(readDesktopNotificationSettings().taskCompletion).toEqual({
			enabled: true,
			sound: false,
		});
	});
});
