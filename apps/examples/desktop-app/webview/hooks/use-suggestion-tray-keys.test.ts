// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exposedSuggestionMemory } from "./use-composer-suggestions";
import { fakeDesktop } from "./use-composer-suggestions.fake-client";
import {
	emitState,
	envelope,
	expectEveryActionParses,
	highlightedPrompt,
	ITEMS,
	invokedActions,
	type MountedTray,
	mountTray,
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

const USE = { code: "Digit1", key: "1", ctrlKey: true };
const SEND = { code: "Digit1", key: "!", ctrlKey: true, shiftKey: true };
const SKIP = { code: "Digit2", key: "2", ctrlKey: true };
const NEW_SET = { code: "Digit2", key: "2", ctrlKey: true, altKey: true };
const UNDO = { code: "Digit3", key: "3", ctrlKey: true };
const DOWN = { code: "ArrowDown", key: "ArrowDown" };
const UP = { code: "ArrowUp", key: "ArrowUp" };

const SENT_PROMPT = ITEMS[0]?.prompt ?? "";
const FORK_REFUSAL = "Wait for the current turn to finish before forking.";

function actions(verb: string) {
	return invokedActions(verb).map(({ action }) => action);
}

async function mountReady(
	changes: Parameters<typeof mountTray>[0] = {},
): Promise<MountedTray> {
	scriptHub({ states: { [SESSION_ID]: [envelope(readyState("r1"))] } });
	return mountTray(changes);
}

/** A one-key Send of the first suggestion, then the plugin computing its next set. */
async function sendFirstSuggestion(tray: MountedTray): Promise<void> {
	await settle(400);
	await press(tray.composer(), SEND);
	expect(tray.options().onSend).toHaveBeenCalledWith(SENT_PROMPT);
	await emitState(
		envelope(readyState("r2", { status: "loading", items: [] }), { seq: 2 }),
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

describe("useSuggestionTrayKeys", () => {
	it("Ctrl+1 puts the highlighted suggestion in the composer and focuses it", async () => {
		const tray = await mountReady();

		const event = await press(document.body, USE);

		expect(event.defaultPrevented).toBe(true);
		expect(tray.composer().value).toBe(SENT_PROMPT);
		expect(document.activeElement).toBe(tray.composer());
		expect(actions("use")).toMatchObject([
			{ verb: "use", revision: "r1", itemId: "verify", input: "key" },
		]);
	});

	it("Shift+Ctrl+1 is refused before 400 ms and on a use-only row, and sends otherwise", async () => {
		const onSend = vi.fn();
		const tray = await mountReady({ onSend });

		await press(tray.composer(), SEND);
		await settle(400);
		await press(tray.composer(), DOWN);
		await press(tray.composer(), DOWN);
		expect(highlightedPrompt(tray.container)).toBe(ITEMS[2]?.prompt);
		await press(tray.composer(), SEND);

		expect(onSend).not.toHaveBeenCalled();
		expect(actions("signal")).toEqual([
			{
				verb: "signal",
				name: "key_inert",
				reason: "not_exposed",
				revision: "r1",
			},
			{
				verb: "signal",
				name: "key_inert",
				reason: "unsendable",
				revision: "r1",
			},
		]);
		expect(actions("send")).toEqual([]);

		await press(tray.composer(), UP);
		await press(tray.composer(), SEND);

		expect(onSend).toHaveBeenCalledWith(ITEMS[1]?.prompt);
		expect(actions("send")).toMatchObject([
			{ verb: "send", revision: "r1", itemId: "review", input: "key" },
		]);
	});

	it("Ctrl+2 skips the highlighted suggestion, and asks for more on the last one", async () => {
		const tray = await mountReady();

		await press(tray.composer(), SKIP);
		expect(highlightedPrompt(tray.container)).toBe(ITEMS[1]?.prompt);
		await press(tray.composer(), DOWN);
		await press(tray.composer(), SKIP);

		expect(actions("skip")).toMatchObject([
			{ verb: "skip", revision: "r1", itemId: "verify", input: "key" },
		]);
		expect(actions("refresh")).toEqual([
			{ verb: "refresh", revision: "r1", input: "key", cause: "more" },
		]);
	});

	it("Alt+Ctrl+2 asks for a new set", async () => {
		const tray = await mountReady();

		await press(tray.composer(), NEW_SET);

		expect(actions("refresh")).toEqual([
			{ verb: "refresh", revision: "r1", input: "key", cause: "new_set" },
		]);
		expect(actions("skip")).toEqual([]);
	});

	it("Esc on an unchanged used suggestion empties the box and sends clear", async () => {
		const tray = await mountReady();
		await press(tray.composer(), USE);

		const event = await press(tray.composer(), {
			code: "Escape",
			key: "Escape",
		});

		expect(event.defaultPrevented).toBe(true);
		expect(tray.composer().value).toBe("");
		expect(actions("clear")).toEqual([
			{ verb: "clear", revision: "r1", itemId: "verify" },
		]);
	});

	it("Ctrl+3 takes a queued sent prompt back into the box and invokes no verb", async () => {
		const onRemoveQueuedPrompt = vi.fn(async () => undefined);
		const tray = await mountReady({ onRemoveQueuedPrompt });
		await sendFirstSuggestion(tray);
		await tray.update({
			promptsInQueue: [{ id: "q1", prompt: SENT_PROMPT, steer: false }],
		});

		const event = await press(tray.composer(), UNDO);

		expect(event.defaultPrevented).toBe(true);
		expect(onRemoveQueuedPrompt).toHaveBeenCalledWith("q1");
		expect(tray.composer().value).toBe(SENT_PROMPT);
		expect(actions("undo")).toEqual([]);
		expect(tray.options().onUndoTurn).not.toHaveBeenCalled();
	});

	it("Ctrl+3 puts a queued sent prompt in front of what was typed since, never over it", async () => {
		const tray = await mountReady();
		await sendFirstSuggestion(tray);
		await tray.update({
			status: "running",
			promptsInQueue: [{ id: "q1", prompt: SENT_PROMPT, steer: false }],
		});
		await typeInto(tray.composer(), "my own half-written message");

		await press(tray.composer(), UNDO);

		expect(tray.options().onRemoveQueuedPrompt).toHaveBeenCalledWith("q1");
		expect(tray.composer().value).toBe(
			`${SENT_PROMPT}\n\nmy own half-written message`,
		);
	});

	it("Ctrl+3 invokes undo on the source session before forking from the sent message's run count", async () => {
		const onUndoTurn = vi.fn(async () => undefined);
		const tray = await mountReady({ onUndoTurn });
		await sendFirstSuggestion(tray);
		await tray.update({
			messages: [
				userMessage("m-first", "Fix the build", 2),
				userMessage("m-sent", SENT_PROMPT, 3),
			],
		});

		await press(tray.composer(), UNDO);

		expect(invokedActions("undo")).toMatchObject([
			{
				sessionId: SESSION_ID,
				action: { verb: "undo", revision: "r1", itemId: "verify" },
			},
		]);
		expect(onUndoTurn).toHaveBeenCalledWith("m-sent", SENT_PROMPT, 3);
		const undoOrder =
			invokedActions("undo")[0]?.order ?? Number.POSITIVE_INFINITY;
		expect(undoOrder).toBeLessThan(onUndoTurn.mock.invocationCallOrder[0] ?? 0);
		expect(tray.options().abort).not.toHaveBeenCalled();
	});

	it("Ctrl+3 is inert while there is no queued prompt or sent message to take back", async () => {
		const tray = await mountReady();
		await sendFirstSuggestion(tray);

		const event = await press(tray.composer(), UNDO);

		expect(event.defaultPrevented).toBe(false);
		expect(actions("undo")).toEqual([]);
		expect(tray.options().onUndoTurn).not.toHaveBeenCalled();
	});

	it("Ctrl+3 during a run stops it, waits for idle, then forks through the latest callback", async () => {
		const forkWhileBusy = vi.fn(async () => {
			throw new Error(FORK_REFUSAL);
		});
		const forkWhenIdle = vi.fn(async () => undefined);
		const abort = vi.fn(async () => undefined);
		const tray = await mountReady({ abort, onUndoTurn: forkWhileBusy });
		await sendFirstSuggestion(tray);
		await tray.update({
			status: "running",
			messages: [userMessage("m-sent", SENT_PROMPT, 1)],
		});

		await press(tray.composer(), UNDO);
		expect(abort).toHaveBeenCalledTimes(1);
		await settle(200);
		expect(actions("undo")).toEqual([]);

		await tray.update({ status: "cancelled", onUndoTurn: forkWhenIdle });
		await settle(100);

		expect(actions("undo")).toHaveLength(1);
		expect(forkWhileBusy).not.toHaveBeenCalled();
		expect(forkWhenIdle).toHaveBeenCalledWith("m-sent", SENT_PROMPT, 1);
		expect(toastMock).not.toHaveBeenCalled();
	});

	it("Ctrl+3 gives up after 5 s of stopping and never forks", async () => {
		const onUndoTurn = vi.fn(async () => undefined);
		const tray = await mountReady({ onUndoTurn });
		await sendFirstSuggestion(tray);
		await tray.update({
			status: "stopping",
			messages: [userMessage("m-sent", SENT_PROMPT, 1)],
		});

		await press(tray.composer(), UNDO);
		await settle(5_000);

		expect(toastMock).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Still stopping — try again" }),
		);
		expect(onUndoTurn).not.toHaveBeenCalled();
		expect(actions("undo")).toEqual([]);
	});

	it("a rejected fork shows the destructive toast", async () => {
		const onUndoTurn = vi.fn(async () => {
			throw new Error(FORK_REFUSAL);
		});
		const tray = await mountReady({ onUndoTurn });
		await sendFirstSuggestion(tray);
		await tray.update({ messages: [userMessage("m-sent", SENT_PROMPT, 1)] });

		await press(tray.composer(), UNDO);

		expect(onUndoTurn).toHaveBeenCalledTimes(1);
		expect(toastMock).toHaveBeenCalledWith(
			expect.objectContaining({
				variant: "destructive",
				description: FORK_REFUSAL,
			}),
		);
	});

	it("stands down in an inert pane, over an expanded composer, and while an IME composes", async () => {
		const tray = await mountReady();
		const pane = tray.container.querySelector('[data-testid="pane"]');

		pane?.setAttribute("inert", "");
		expect((await press(tray.composer(), USE)).defaultPrevented).toBe(false);
		pane?.removeAttribute("inert");

		tray.composer().setAttribute("aria-expanded", "true");
		expect((await press(tray.composer(), USE)).defaultPrevented).toBe(false);
		tray.composer().removeAttribute("aria-expanded");

		expect(
			(await press(tray.composer(), { ...USE, isComposing: true }))
				.defaultPrevented,
		).toBe(false);

		expect(tray.composer().value).toBe("");
		expect(actions("use")).toEqual([]);

		expect((await press(tray.composer(), USE)).defaultPrevented).toBe(true);
		expect(actions("use")).toHaveLength(1);
	});
});
