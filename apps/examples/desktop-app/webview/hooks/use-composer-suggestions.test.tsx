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
import { exposedSuggestionMemory } from "./use-composer-suggestions";
import { fakeDesktop } from "./use-composer-suggestions.fake-client";
import {
	click,
	commandCalls,
	deferred,
	ENVIRONMENT_ID,
	emitState,
	envelope,
	expectEveryActionParses,
	highlightedPrompt,
	ITEMS,
	invokedActions,
	legendButton,
	mountTray,
	OLDER_SESSION_ID,
	pointerDown,
	press,
	readyState,
	SESSION_ID,
	scriptHub,
	settle,
	stubBrowserApis,
	typeInto,
	unmountAll,
	userMessage,
} from "./use-composer-suggestions.harness";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/lib/desktop-client", async () => {
	const { fakeDesktop } = await import(
		"./use-composer-suggestions.fake-client"
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

const READY_R1 = { [SESSION_ID]: [envelope(readyState("r1"))] };
const USE_KEYS = { code: "Digit1", key: "1", ctrlKey: true };
const SEND_KEYS = { code: "Digit1", key: "!", ctrlKey: true, shiftKey: true };

function options(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
}

function menuItem(label: string): HTMLElement {
	const item = Array.from(
		document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	).find((element) => element.textContent?.includes(label));
	expect(item).toBeDefined();
	return item as HTMLElement;
}

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
	it("binds to the displayed session: gets its states, then attaches from the desktop", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray();

		expect(commandCalls("plugin_ui_get")).toEqual([
			{ environmentId: ENVIRONMENT_ID, sessionId: SESSION_ID },
		]);
		expect(invokedActions("attach")).toMatchObject([
			{ sessionId: SESSION_ID, action: { verb: "attach", surface: "desktop" } },
		]);
		const region = tray.container.querySelector(
			'[data-testid="suggestion-tray"]',
		);
		expect(region?.tagName).toBe("SECTION");
		expect(region?.getAttribute("aria-label")).toBe(
			"Next · after a command failed",
		);
		expect(
			region?.querySelector('[data-testid="suggestion-legend"]'),
		).not.toBeNull();
		expect(options(tray.container)).toHaveLength(3);
		expect(highlightedPrompt(tray.container)).toBe(ITEMS[0]?.prompt);
	});

	it("sends pointer from the key row's Skip and the More menu's New set, and key from Ctrl+2", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray();

		await press(tray.composer(), { code: "Digit2", key: "2", ctrlKey: true });
		await click(legendButton(tray.container, "skip"));
		await pointerDown(
			tray.container.querySelector(
				'[data-testid="suggestion-more"]',
			) as Element,
		);
		await click(menuItem("Suggest different ones"));

		expect(invokedActions("skip").map(({ action }) => action)).toMatchObject([
			{ verb: "skip", revision: "r1", itemId: "verify", input: "key" },
			{ verb: "skip", revision: "r1", itemId: "review", input: "pointer" },
		]);
		expect(invokedActions("refresh").map(({ action }) => action)).toEqual([
			{ verb: "refresh", revision: "r1", input: "pointer", cause: "new_set" },
		]);
	});

	it("never gets or invokes for an SSH pane, and binds once the pane turns local", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray({
			enabled: false,
			environmentId: "ssh-devbox",
		});
		await settle(1_000);

		expect(commandCalls("plugin_ui_get")).toEqual([]);
		expect(invokedActions()).toEqual([]);
		expect(
			tray.container.querySelector('[data-testid="suggestion-tray-root"]'),
		).toBeNull();

		await tray.update({ enabled: true, environmentId: ENVIRONMENT_ID });

		expect(commandCalls("plugin_ui_get")).toEqual([
			{ environmentId: ENVIRONMENT_ID, sessionId: SESSION_ID },
		]);
		expect(invokedActions().map(({ action }) => action.verb)).toEqual([
			"attach",
		]);
		expect(options(tray.container)).toHaveLength(3);
	});

	it("records a one-key Send from the suggestion captured at the press, even when a newer state lands before the verdict", async () => {
		const verdict = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "send" ? verdict.promise : undefined,
		});
		const onSend = vi.fn();
		const tray = await mountTray({ onSend });
		await settle(400);

		await press(tray.composer(), SEND_KEYS);
		await emitState(
			envelope(readyState("r2", { items: [ITEMS[2]] as never }), { seq: 2 }),
		);
		await act(async () => verdict.resolve({ outcome: "ok" }));
		await settle();

		expect(invokedActions("send")).toMatchObject([
			{ action: { verb: "send", revision: "r1", itemId: "verify" } },
		]);
		expect(onSend).toHaveBeenCalledWith(ITEMS[0]?.prompt);

		await tray.update({
			status: "running",
			messages: [userMessage("m1", ITEMS[0]?.prompt ?? "")],
		});

		expect(
			tray.container.querySelector('[data-testid="suggestion-sent"]')
				?.textContent,
		).toContain("Cline is working…");
		expect(
			tray.container.querySelector('[data-testid="suggestion-undo"]'),
		).not.toBeNull();
	});

	it("ignores a second Send, by key or by button, while the first waits for its verdict", async () => {
		const verdict = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "send" ? verdict.promise : undefined,
		});
		const onSend = vi.fn();
		const tray = await mountTray({ onSend });
		await settle(400);

		await press(tray.composer(), SEND_KEYS);
		await settle(50);
		await press(tray.composer(), SEND_KEYS);
		await click(legendButton(tray.container, "send"));
		expect(
			legendButton(tray.container, "send").getAttribute("aria-disabled"),
		).toBe("true");
		await settle(300);

		expect(invokedActions("send")).toHaveLength(1);
		expect(invokedActions("signal")).toEqual([]);
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith(ITEMS[0]?.prompt);
		await act(async () => verdict.resolve({ outcome: "ok" }));
	});

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

	it("re-attaches once for each newer epoch a state carries", async () => {
		let attachEpoch = 100;
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "attach"
					? { outcome: "ok", epoch: attachEpoch }
					: undefined,
		});
		await mountTray();
		expect(invokedActions("attach")).toHaveLength(1);

		attachEpoch = 200;
		await emitState(envelope(readyState("r2"), { epoch: 200, seq: 1 }));
		expect(invokedActions("attach")).toHaveLength(2);

		await emitState(envelope(readyState("r3"), { epoch: 200, seq: 2 }));
		expect(invokedActions("attach")).toHaveLength(2);
	});

	it("binds again when the desktop transport reconnects", async () => {
		scriptHub({ states: READY_R1 });
		await mountTray();

		await act(async () => fakeDesktop.setTransportState("reconnecting"));
		await act(async () => fakeDesktop.setTransportState("connected"));
		await settle();

		expect(commandCalls("plugin_ui_get")).toHaveLength(2);
		expect(invokedActions("attach")).toHaveLength(2);
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

	it("sends no clear for a refused Use whose box was edited before the refusal landed", async () => {
		const useReply = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "use" ? useReply.promise : undefined,
		});
		const tray = await mountTray();

		await press(tray.composer(), USE_KEYS);
		await typeInto(tray.composer(), `${ITEMS[0]?.prompt} please`);
		await act(async () =>
			useReply.resolve({ outcome: "refused", reason: "stale" }),
		);
		await settle();
		expect(tray.composer().value).toBe(`${ITEMS[0]?.prompt} please`);
		await typeInto(tray.composer(), "");

		expect(invokedActions("clear")).toEqual([]);
	});

	it("tells the plugin when the box holding a used suggestion is emptied, edited or not", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray();

		await press(tray.composer(), USE_KEYS);
		await typeInto(tray.composer(), "");
		expect(options(tray.container)).toHaveLength(3);
		await press(tray.composer(), USE_KEYS);
		await typeInto(tray.composer(), `${ITEMS[0]?.prompt} please`);
		await typeInto(tray.composer(), "");

		expect(invokedActions("clear").map(({ action }) => action)).toEqual([
			{ verb: "clear", revision: "r1", itemId: "verify" },
			{ verb: "clear", revision: "r1", itemId: "verify" },
		]);
		expect(options(tray.container)).toHaveLength(3);
	});

	it("ignores a detach reply for the previous session that lands after a switch to an older one", async () => {
		const detachReply = deferred<unknown>();
		scriptHub({
			states: {
				[SESSION_ID]: [envelope(readyState("rb"), { epoch: 200 })],
				[OLDER_SESSION_ID]: [
					envelope(readyState("ra", { items: [ITEMS[1]] as never }), {
						sessionId: OLDER_SESSION_ID,
					}),
				],
			},
			reply: (sessionId, action) => {
				if (action.verb === "detach" && sessionId === SESSION_ID)
					return detachReply.promise;
				if (action.verb === "attach")
					return { outcome: "ok", epoch: sessionId === SESSION_ID ? 200 : 100 };
				return undefined;
			},
		});
		const tray = await mountTray();
		await tray.update({ sessionId: OLDER_SESSION_ID });
		expect(highlightedPrompt(tray.container)).toBe(ITEMS[1]?.prompt);

		await act(async () =>
			detachReply.resolve({
				outcome: "unavailable",
				epoch: 200,
				state: envelope(readyState("rb2"), { epoch: 200, seq: 9 }),
			}),
		);
		await settle();

		expect(invokedActions("detach")).toMatchObject([{ sessionId: SESSION_ID }]);
		expect(highlightedPrompt(tray.container)).toBe(ITEMS[1]?.prompt);
		expect(options(tray.container)).toHaveLength(1);
		expect(invokedActions("attach")).toHaveLength(2);
	});

	it("never attaches a chat left while its get was pending", async () => {
		const get = deferred<unknown>();
		scriptHub();
		const defaultReply = fakeDesktop.invoke.getMockImplementation();
		fakeDesktop.invoke.mockImplementation(async (command, args) =>
			command === "plugin_ui_get" ? get.promise : defaultReply?.(command, args),
		);
		const tray = await mountTray();
		await tray.unmount();

		await act(async () => get.resolve([envelope(readyState("r1"))]));
		await settle();

		expect(invokedActions("attach")).toEqual([]);
		expect(invokedActions("detach")).toMatchObject([{ sessionId: SESSION_ID }]);
		expect(invokedActions()).toHaveLength(1);
	});

	it("still sends a one-key Send to the chat its pane left while it waited for the verdict", async () => {
		const verdict = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "send" ? verdict.promise : undefined,
		});
		const onSend = vi.fn();
		const tray = await mountTray({ onSend });
		await settle(400);
		await press(tray.composer(), SEND_KEYS);
		await tray.unmount();

		await act(async () => verdict.resolve({ outcome: "ok" }));
		await settle(300);

		expect(invokedActions("send")).toHaveLength(1);
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith(ITEMS[0]?.prompt);
	});

	it("sends nothing when the plugin refuses a one-key Send after its pane left", async () => {
		const verdict = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "send" ? verdict.promise : undefined,
		});
		const onSend = vi.fn();
		const tray = await mountTray({ onSend });
		await settle(400);
		await press(tray.composer(), SEND_KEYS);
		await tray.unmount();

		await act(async () =>
			verdict.resolve({ outcome: "refused", reason: "stale" }),
		);
		await settle(300);

		expect(invokedActions("send")).toHaveLength(1);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("sends nothing when the plugin refuses a one-key Send that waited across a transport reconnect", async () => {
		const verdict = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "send" ? verdict.promise : undefined,
		});
		const onSend = vi.fn();
		const tray = await mountTray({ onSend });
		await settle(400);
		await press(tray.composer(), SEND_KEYS);

		await act(async () => fakeDesktop.setTransportState("reconnecting"));
		await act(async () => fakeDesktop.setTransportState("connected"));
		await act(async () =>
			verdict.resolve({ outcome: "refused", reason: "stale" }),
		);
		await settle(300);

		expect(invokedActions("attach")).toHaveLength(2);
		expect(invokedActions("send")).toHaveLength(1);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("leaves the box alone when a Use refusal lands after the pane switched sessions", async () => {
		const useReply = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "use" ? useReply.promise : undefined,
		});
		const tray = await mountTray();

		await press(tray.composer(), USE_KEYS);
		await tray.update({ sessionId: OLDER_SESSION_ID });
		await act(async () =>
			useReply.resolve({ outcome: "refused", reason: "stale" }),
		);
		await settle();

		expect(tray.composer().value).toBe(ITEMS[0]?.prompt);
		expect(invokedActions("clear")).toEqual([]);
	});

	it("empties the box when a Use refusal lands after a transport reconnect on the same chat", async () => {
		const useReply = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "use" ? useReply.promise : undefined,
		});
		const tray = await mountTray();

		await press(tray.composer(), USE_KEYS);
		await act(async () => fakeDesktop.setTransportState("reconnecting"));
		await act(async () => fakeDesktop.setTransportState("connected"));
		await settle();
		expect(tray.composer().value).toBe(ITEMS[0]?.prompt);
		await act(async () =>
			useReply.resolve({ outcome: "refused", reason: "stale" }),
		);
		await settle();

		expect(invokedActions("attach")).toHaveLength(2);
		expect(tray.composer().value).toBe("");
		expect(options(tray.container)).toHaveLength(3);
		expect(invokedActions("clear")).toEqual([]);
	});

	it("drops a one-key Send whose pane switched to another session while it waited for the verdict", async () => {
		const verdict = deferred<unknown>();
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "send" ? verdict.promise : undefined,
		});
		const onSend = vi.fn();
		const tray = await mountTray({ onSend });
		await settle(400);
		await press(tray.composer(), SEND_KEYS);
		await tray.update({ sessionId: OLDER_SESSION_ID });

		await act(async () => verdict.resolve({ outcome: "ok" }));
		await settle(300);

		expect(invokedActions("send")).toMatchObject([{ sessionId: SESSION_ID }]);
		expect(onSend).not.toHaveBeenCalled();
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

	it("sends a used suggestion submitted unchanged without awaiting the verb, and an edited one with none", async () => {
		scriptHub({ states: READY_R1 });
		const onSend = vi.fn();
		const tray = await mountTray({ onSend });

		await press(tray.composer(), { code: "Digit1", key: "1", ctrlKey: true });
		expect(
			tray.container.querySelector('[data-testid="suggestion-used"]')
				?.textContent,
		).toContain("From a suggestion");
		await press(tray.composer(), { key: "Enter", code: "Enter" });

		expect(onSend).toHaveBeenCalledWith(ITEMS[0]?.prompt);
		expect(invokedActions("send").map(({ action }) => action)).toEqual([
			{ verb: "send", revision: "r1", itemId: "verify", input: "key" },
		]);

		await emitState(envelope(readyState("r2"), { seq: 2 }));
		await press(tray.composer(), { code: "Digit1", key: "1", ctrlKey: true });
		await typeInto(tray.composer(), `${ITEMS[0]?.prompt} please`);
		expect(
			tray.container.querySelector('[data-testid="suggestion-used"]')
				?.textContent,
		).toContain("Edited suggestion");
		await press(tray.composer(), { key: "Enter", code: "Enter" });

		expect(onSend).toHaveBeenLastCalledWith(`${ITEMS[0]?.prompt} please`);
		expect(invokedActions("send")).toHaveLength(1);
		expect(invokedActions("clear")).toEqual([]);
	});
});
