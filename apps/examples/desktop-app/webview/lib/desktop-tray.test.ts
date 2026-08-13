// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

type MenuEventHandler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	isTauriAvailable: false,
	listen: vi.fn(),
	subscribe: vi.fn(),
	unlisten: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: mocks.subscribe },
	isTauriAvailable: () => mocks.isTauriAvailable,
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: mocks.listen,
}));

async function importFresh() {
	vi.resetModules();
	return await import("./desktop-tray");
}

beforeEach(() => {
	mocks.isTauriAvailable = false;
	mocks.invoke.mockReset();
	mocks.listen.mockReset();
	mocks.subscribe.mockReset().mockReturnValue(() => {});
	mocks.unlisten.mockReset();
});

describe("desktop tray", () => {
	it("does not subscribe outside the Tauri shell", async () => {
		const { subscribeToDesktopActions } = await importFresh();

		subscribeToDesktopActions(vi.fn());

		expect(mocks.listen).not.toHaveBeenCalled();
	});

	it("drains startup actions after registering the native listener", async () => {
		mocks.isTauriAvailable = true;
		let eventHandler: MenuEventHandler | undefined;
		const pendingBatches: unknown[][] = [
			[{ type: "new-session" }, { type: "unexpected" }],
			[
				{ type: "open-session", sessionId: "session-1" },
				{ type: "open-settings" },
				{ type: "zoom-in" },
				{ type: "zoom-out" },
				{ type: "zoom-reset" },
			],
		];
		mocks.listen.mockImplementation(
			async (_eventName: string, handler: MenuEventHandler) => {
				eventHandler = handler;
				return mocks.unlisten;
			},
		);
		mocks.invoke.mockImplementation(async (command: string) => {
			if (command === "drain_desktop_actions") {
				return pendingBatches.shift() ?? [];
			}
			return undefined;
		});
		const onAction = vi.fn();
		const { DESKTOP_ACTION_PENDING_EVENT, subscribeToDesktopActions } =
			await importFresh();

		const unsubscribe = subscribeToDesktopActions(onAction);
		await vi.waitFor(() =>
			expect(mocks.listen).toHaveBeenCalledWith(
				DESKTOP_ACTION_PENDING_EVENT,
				expect.any(Function),
			),
		);
		await vi.waitFor(() =>
			expect(onAction.mock.calls).toEqual([[{ type: "new-session" }]]),
		);

		eventHandler?.({ payload: undefined });

		await vi.waitFor(() =>
			expect(onAction.mock.calls).toEqual([
				[{ type: "new-session" }],
				[{ type: "open-session", sessionId: "session-1" }],
				[{ type: "open-settings" }],
				[{ type: "zoom-in" }],
				[{ type: "zoom-out" }],
				[{ type: "zoom-reset" }],
			]),
		);
		unsubscribe();
		expect(mocks.unlisten).toHaveBeenCalledOnce();
	});

	it("refreshes the native menu with Hub health and session count", async () => {
		mocks.isTauriAvailable = true;
		mocks.invoke.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return {
					hub: { status: "connected" },
					runningSessionCount: 2,
				};
			}
			return undefined;
		});
		const { watchDesktopTrayStatus } = await importFresh();

		const stopWatching = watchDesktopTrayStatus();

		await vi.waitFor(() =>
			expect(mocks.invoke).toHaveBeenCalledWith("set_tray_status", {
				hubHealthy: true,
				runningSessions: 2,
			}),
		);
		stopWatching();
	});

	it("preserves the tray status when process context is unavailable", async () => {
		mocks.isTauriAvailable = true;
		mocks.invoke.mockRejectedValueOnce(new Error("sidecar unavailable"));
		const { watchDesktopTrayStatus } = await importFresh();

		const stopWatching = watchDesktopTrayStatus();

		await vi.waitFor(() =>
			expect(mocks.invoke).toHaveBeenCalledWith("get_process_context"),
		);
		expect(mocks.invoke).not.toHaveBeenCalledWith(
			"set_tray_status",
			expect.anything(),
		);
		stopWatching();
	});
});
