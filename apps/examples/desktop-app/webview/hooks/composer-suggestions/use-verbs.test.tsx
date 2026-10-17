// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exposedSuggestionMemory } from "./exposed-memory";
import { fakeDesktop } from "./test-support/fake-client";
import {
	deferred,
	envelope,
	expectEveryActionParses,
	ITEMS,
	invokedActions,
	OLDER_SESSION_ID,
	READY_R1,
	readyState,
	SEND_KEYS,
	SESSION_ID,
	scriptHub,
	userMessage,
} from "./test-support/fixtures";
import {
	click,
	emitState,
	legendButton,
	mountTray,
	options,
	pointerDown,
	press,
	settle,
	stubBrowserApis,
	typeInto,
	unmountAll,
} from "./test-support/harness";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/lib/desktop-client", async () => {
	const { fakeDesktop } = await import("./test-support/fake-client");
	return {
		desktopClient: fakeDesktop.client,
		openExternalUrl: fakeDesktop.openExternalUrl,
	};
});

vi.mock("@/hooks/use-toast", () => ({
	toast: toastMock,
	useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

const USE_KEYS = { code: "Digit1", key: "1", ctrlKey: true };

function menuItem(label: string): HTMLElement {
	const item = Array.from(
		document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	).find((element) => element.textContent?.includes(label));
	expect(item).toBeDefined();
	return item as HTMLElement;
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
