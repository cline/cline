// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

type MenuEventHandler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	isTauriAvailable: false,
	listen: vi.fn(),
	unlisten: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
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
	mocks.unlisten.mockReset();
});

describe("desktop tray", () => {
	it("does not subscribe outside the Tauri shell", async () => {
		const { subscribeToDesktopMenuActions } = await importFresh();

		subscribeToDesktopMenuActions(vi.fn());

		expect(mocks.listen).not.toHaveBeenCalled();
	});

	it("forwards known actions and ignores unknown payloads", async () => {
		mocks.isTauriAvailable = true;
		let eventHandler: MenuEventHandler | undefined;
		mocks.listen.mockImplementation(
			async (_eventName: string, handler: MenuEventHandler) => {
				eventHandler = handler;
				return mocks.unlisten;
			},
		);
		const onAction = vi.fn();
		const { DESKTOP_MENU_ACTION_EVENT, subscribeToDesktopMenuActions } =
			await importFresh();

		const unsubscribe = subscribeToDesktopMenuActions(onAction);
		await vi.waitFor(() =>
			expect(mocks.listen).toHaveBeenCalledWith(
				DESKTOP_MENU_ACTION_EVENT,
				expect.any(Function),
			),
		);

		eventHandler?.({ payload: "new-session" });
		eventHandler?.({ payload: "open-settings" });
		eventHandler?.({ payload: "unexpected" });

		expect(onAction.mock.calls).toEqual([["new-session"], ["open-settings"]]);
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
