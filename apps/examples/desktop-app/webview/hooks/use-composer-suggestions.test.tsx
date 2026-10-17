// @vitest-environment jsdom

import { act } from "react";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	onTestFinished,
	vi,
} from "vitest";
import { exposedSuggestionMemory } from "./composer-suggestions/exposed-memory";
import { fakeDesktop } from "./composer-suggestions/test-support/fake-client";
import {
	envelope,
	expectEveryActionParses,
	ITEMS,
	invokedActions,
	READY_R1,
	readyState,
	SEND_KEYS,
	scriptHub,
} from "./composer-suggestions/test-support/fixtures";
import {
	emitState,
	mountTray,
	options,
	press,
	settle,
	stubBrowserApis,
	unmountAll,
} from "./composer-suggestions/test-support/harness";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/lib/desktop-client", async () => {
	const { fakeDesktop } = await import(
		"./composer-suggestions/test-support/fake-client"
	);
	return {
		desktopClient: fakeDesktop.client,
		openExternalUrl: fakeDesktop.openExternalUrl,
	};
});

vi.mock("@/hooks/use-toast", () => ({
	toast: toastMock,
	useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

function exposedRevisions(): string[] {
	return invokedActions("exposed").flatMap(({ action }) =>
		"revision" in action && action.revision ? [action.revision] : [],
	);
}

beforeEach(() => {
	stubBrowserApis();
	vi.useFakeTimers();
	fakeDesktop.reset();
	exposedSuggestionMemory.clear();
	toastMock.mockReset();
});

afterEach(async () => {
	await unmountAll();
	expectEveryActionParses();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useComposerSuggestions", () => {
	it("keeps the exposure clock stopped while the pane is inert or the window hidden", async () => {
		scriptHub();
		const tray = await mountTray();
		const pane = tray.container.querySelector('[data-testid="pane"]');

		await act(async () => pane?.setAttribute("inert", ""));
		await emitState(envelope(readyState("r1")));
		await settle(1_000);
		expect(exposedRevisions()).toEqual([]);
		await press(tray.composer(), SEND_KEYS);
		expect(tray.options().onSend).not.toHaveBeenCalled();

		await act(async () => pane?.removeAttribute("inert"));
		await settle(399);
		expect(exposedRevisions()).toEqual([]);
		await settle(1);
		expect(exposedRevisions()).toEqual(["r1"]);

		const visibility = vi
			.spyOn(document, "visibilityState", "get")
			.mockReturnValue("hidden");
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await emitState(envelope(readyState("r2"), { seq: 2 }));
		await settle(1_000);
		expect(exposedRevisions()).toEqual(["r1"]);

		visibility.mockReturnValue("visible");
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await settle(400);
		expect(exposedRevisions()).toEqual(["r1", "r2"]);
	});

	it("steps aside while a dialog is open over the page", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray();
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		onTestFinished(() => dialog.remove());

		await act(async () => {
			document.body.append(dialog);
		});
		await settle(1_000);
		expect(options(tray.container)).toHaveLength(0);
		expect(exposedRevisions()).toEqual([]);

		await act(async () => {
			dialog.remove();
		});
		await settle(400);
		expect(options(tray.container)).toHaveLength(3);
		expect(exposedRevisions()).toEqual(["r1"]);
	});

	it("reports a set once even when the pane remounts on the same session", async () => {
		scriptHub({ states: READY_R1 });
		const first = await mountTray();
		await settle(400);
		await first.unmount();

		await mountTray();
		await settle(1_000);

		expect(exposedRevisions()).toEqual(["r1"]);
	});

	it("keeps a set fetched while the chat loads, since loading is not a run", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray({ status: "starting", loadingChat: true });
		expect(options(tray.container)).toHaveLength(3);

		await tray.update({ status: "idle", loadingChat: false });
		expect(options(tray.container)).toHaveLength(3);
	});

	it("still counts a run under way at bind when the chat is not loading", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray({ status: "starting", loadingChat: false });
		await tray.update({ status: "idle" });

		expect(options(tray.container)).toHaveLength(0);
	});

	it("counts no run when an idle chat reloads, and a run once loading ends", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray({ status: "idle", loadingChat: true });
		await tray.update({ loadingChat: false });
		await tray.update({ status: "starting", loadingChat: true });
		await tray.update({ status: "idle", loadingChat: false });
		expect(options(tray.container)).toHaveLength(3);

		await tray.update({ status: "running" });
		await tray.update({ status: "idle" });
		expect(options(tray.container)).toHaveLength(0);
	});

	it("counts a run when a chat finishes loading with its run under way", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray({ status: "starting", loadingChat: true });
		await tray.update({ status: "running", loadingChat: false });
		await tray.update({ status: "idle" });

		expect(options(tray.container)).toHaveLength(0);
	});

	it("allows Send at readyAt + 400 and reports exposure then, on the tick alone", async () => {
		scriptHub({ states: READY_R1 });
		const onSend = vi.fn();
		const tray = await mountTray({ onSend });

		await press(tray.composer(), SEND_KEYS);
		expect(onSend).not.toHaveBeenCalled();
		expect(invokedActions("signal").map(({ action }) => action)).toEqual([
			{
				verb: "signal",
				name: "key_inert",
				reason: "not_exposed",
				revision: "r1",
			},
		]);

		await settle(399);
		expect(invokedActions("exposed")).toEqual([]);
		await settle(1);
		expect(invokedActions("exposed").map(({ action }) => action)).toEqual([
			{
				verb: "exposed",
				revision: "r1",
				itemIds: ["verify", "review", "commit"],
			},
		]);

		await press(tray.composer(), SEND_KEYS);
		expect(onSend).toHaveBeenCalledWith(ITEMS[0]?.prompt);
	});

	it("clears the stale line at staleUntil, after a refused Use emptied the box", async () => {
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "use"
					? { outcome: "refused", reason: "stale" }
					: undefined,
		});
		const tray = await mountTray();
		const stale = () =>
			tray.container.querySelector('[data-testid="suggestion-stale"]');

		await press(tray.composer(), { code: "Digit1", key: "1", ctrlKey: true });
		expect(tray.composer().value).toBe("");
		expect(stale()?.textContent).toBe(
			"Suggestions changed — check them before sending",
		);

		await settle(3_999);
		expect(stale()).not.toBeNull();
		await settle(1);
		expect(stale()).toBeNull();
		expect(options(tray.container)).toHaveLength(3);
		expect(invokedActions("clear")).toEqual([]);
	});

	it("reports msSinceExposed as a non-negative integer", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray();
		await settle(1_234);

		await press(tray.composer(), { code: "Digit2", key: "2", ctrlKey: true });
		await press(tray.composer(), SEND_KEYS);
		await press(tray.composer(), { code: "Digit1", key: "1", ctrlKey: true });

		const timed = invokedActions().flatMap(({ action }) =>
			"msSinceExposed" in action ? [action.msSinceExposed] : [],
		);
		expect(timed.length).toBeGreaterThanOrEqual(2);
		for (const value of timed) {
			expect(Number.isInteger(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
		}
	});
});
