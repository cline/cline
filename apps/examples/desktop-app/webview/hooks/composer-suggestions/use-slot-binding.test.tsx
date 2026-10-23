// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exposedSuggestionMemory } from "./exposed-memory";
import { fakeDesktop } from "./test-support/fake-client";
import {
	commandCalls,
	deferred,
	ENVIRONMENT_ID,
	envelope,
	expectEveryActionParses,
	ITEMS,
	invokedActions,
	OLDER_SESSION_ID,
	READY_R1,
	readyState,
	SESSION_ID,
	scriptHub,
} from "./test-support/fixtures";
import {
	emitState,
	highlightedPrompt,
	mountTray,
	options,
	settle,
	stubBrowserApis,
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

	it("re-attaches once for the first state of a chat its attach found not yet running", async () => {
		scriptHub({
			reply: (_sessionId, action) =>
				action.verb === "attach" ? { outcome: "unavailable" } : undefined,
		});
		const tray = await mountTray();
		expect(invokedActions("attach")).toHaveLength(1);

		await emitState(envelope(readyState("r1"), { epoch: 300, seq: 1 }));
		expect(invokedActions("attach")).toHaveLength(2);

		await emitState(envelope(readyState("r2"), { epoch: 300, seq: 2 }));
		await settle(1_000);
		expect(invokedActions("attach")).toHaveLength(2);
		expect(options(tray.container)).toHaveLength(3);
	});

	it("re-attaches once within the epoch of an attach that timed out", async () => {
		let attachReply: unknown = { outcome: "timeout", epoch: 100 };
		scriptHub({
			states: READY_R1,
			reply: (_sessionId, action) =>
				action.verb === "attach" ? attachReply : undefined,
		});
		await mountTray();
		expect(invokedActions("attach")).toHaveLength(1);

		attachReply = { outcome: "ok", epoch: 100 };
		await emitState(envelope(readyState("r2"), { seq: 2 }));
		expect(invokedActions("attach")).toHaveLength(2);

		await emitState(envelope(readyState("r3"), { seq: 3 }));
		expect(invokedActions("attach")).toHaveLength(2);
	});

	describe("after an attach that timed out with the plugin's state already held", () => {
		const dormant = envelope({
			status: "hidden",
			title: "Next",
			revision: "none",
			items: [],
			canRefresh: false,
		});

		it("re-attaches once when the next run ends, when the timed-out reply carried the state", async () => {
			let attachReply: unknown = {
				outcome: "timeout",
				epoch: 100,
				state: dormant,
			};
			scriptHub({
				reply: (_sessionId, action) =>
					action.verb === "attach" ? attachReply : undefined,
			});
			const tray = await mountTray();
			expect(invokedActions("attach")).toHaveLength(1);

			attachReply = { outcome: "ok", epoch: 100 };
			await tray.update({ status: "running" });
			expect(invokedActions("attach")).toHaveLength(1);
			await tray.update({ status: "idle" });
			expect(invokedActions("attach")).toHaveLength(2);

			await tray.update({ status: "running" });
			await tray.update({ status: "idle" });
			expect(invokedActions("attach")).toHaveLength(2);
		});

		it("re-attaches when the next run ends, when the state arrived before the reply", async () => {
			scriptHub({
				states: { [SESSION_ID]: [dormant] },
				reply: (_sessionId, action) =>
					action.verb === "attach"
						? { outcome: "timeout", epoch: 100 }
						: undefined,
			});
			const tray = await mountTray();
			expect(invokedActions("attach")).toHaveLength(1);

			await tray.update({ status: "running" });
			await tray.update({ status: "idle" });
			expect(invokedActions("attach")).toHaveLength(2);
		});

		it("re-attaches when the next run ends even after the state's own re-attach timed out", async () => {
			scriptHub({
				reply: (_sessionId, action) =>
					action.verb === "attach"
						? { outcome: "timeout", epoch: 100 }
						: undefined,
			});
			const tray = await mountTray();
			await emitState(dormant);
			expect(invokedActions("attach")).toHaveLength(2);

			await tray.update({ status: "running" });
			await tray.update({ status: "idle" });
			expect(invokedActions("attach")).toHaveLength(3);
		});
	});

	it("hides a set its restarted chat no longer has, through the next turn", async () => {
		scriptHub({ states: READY_R1 });
		const tray = await mountTray();
		expect(options(tray.container)).toHaveLength(3);

		await emitState({
			...envelope(null, { epoch: 200, seq: 0 }),
			plugin: "",
		});
		await tray.update({ status: "running" });

		expect(
			tray.container.querySelector('[data-testid="suggestion-working"]'),
		).toBeNull();
		expect(options(tray.container)).toHaveLength(0);
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
});
