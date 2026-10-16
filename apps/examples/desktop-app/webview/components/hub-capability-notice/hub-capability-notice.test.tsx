// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToPromptInputFocus } from "@/lib/prompt-input-focus";
import { HubUpdateRequiredDialog } from "../hub-update-required-dialog";
import { HubCapabilityNotice } from "./hub-capability-notice";

const { invoke, subscribe, emitHubMismatch } = vi.hoisted(() => {
	const handlers = new Set<(payload: unknown) => void>();
	return {
		invoke: vi.fn(),
		subscribe: vi.fn(
			(eventName: string, handler: (payload: unknown) => void) => {
				if (eventName !== "hub_build_mismatch") {
					return () => undefined;
				}
				handlers.add(handler);
				return () => {
					handlers.delete(handler);
				};
			},
		),
		emitHubMismatch: (payload: unknown) => {
			for (const handler of handlers) {
				handler(payload);
			}
		},
	};
});

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe },
}));

vi.mock("@/hooks/use-app-update", () => ({
	checkForUpdateNow: vi.fn(),
	restartToApplyUpdate: vi.fn(),
	useAppUpdateStatus: () => ({ state: "ready" }),
}));

const missingPluginUi = {
	url: "ws://127.0.0.1:25463/hub",
	reason: "missing_capability",
	hubBuildId: "source-0.0.93",
	hubCoreVersion: "0.0.93",
	expectedBuildId: "source-0.0.93",
	missingCapabilities: ["plugins.ui"],
};

let container: HTMLDivElement;
let root: Root;

function mount() {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
}

async function unmount() {
	await act(async () => root.unmount());
	container.remove();
}

async function render(children: ReactNode) {
	await act(async () => root.render(children));
}

async function emit(payload: unknown) {
	await act(async () => emitHubMismatch(payload));
}

function notice(): HTMLOutputElement | null {
	return container.querySelector("output");
}

function button(label: string): HTMLButtonElement {
	const match = Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.trim() === label,
	);
	if (!match) {
		throw new Error(`No "${label}" button`);
	}
	return match;
}

async function click(label: string) {
	await act(async () => button(label).click());
}

/** Answers the notice's sidecar commands; each answer is a value or a pending promise. */
function answerCommands(answers: {
	activity?: () => Promise<unknown>;
	upgrade?: () => Promise<unknown>;
}) {
	invoke.mockImplementation(async (command: string) => {
		if (command === "hub_session_activity") {
			return await (answers.activity?.() ?? { activeSessionCount: 0 });
		}
		if (command === "hub_upgrade") {
			return await (answers.upgrade?.() ?? { outcome: "replaced" });
		}
		throw new Error(`unexpected command ${command}`);
	});
}

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

function invokedCommands(): string[] {
	return invoke.mock.calls.map(([command]) => command as string);
}

/** A stand-in for the chat composer, which takes focus requests by window event. */
function mountComposer(): HTMLTextAreaElement {
	const composer = document.createElement("textarea");
	document.body.appendChild(composer);
	const unsubscribe = subscribeToPromptInputFocus(() => composer.focus());
	cleanups.push(() => {
		unsubscribe();
		composer.remove();
	});
	return composer;
}

async function flushFocusRequests() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	localStorage.clear();
	sessionStorage.clear();
	invoke.mockReset();
	answerCommands({});
	mount();
});

afterEach(async () => {
	await unmount();
	for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("HubCapabilityNotice", () => {
	it("shows a non-blocking notice, never the blocking dialog, for a Hub without plugin UI", async () => {
		await render(
			<>
				<HubUpdateRequiredDialog />
				<HubCapabilityNotice />
			</>,
		);
		await emit(missingPluginUi);

		expect(notice()?.textContent).toContain(
			"Plugin suggestions are off for this Cline Hub",
		);
		expect(notice()?.textContent).toContain(
			"Another Cline app started the running Cline Hub without suggestion support. Restart it to turn suggestions on; open chats get them after their next message.",
		);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(document.activeElement).toBe(document.body);
	});

	it("states what a restart interrupts before any session count is known", async () => {
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		expect(notice()?.textContent).toContain(
			"Restarting interrupts any work in progress in Cline apps that use the Hub, including this one.",
		);
	});

	it("stays hidden for the other mismatch reasons", async () => {
		await render(<HubCapabilityNotice />);
		for (const reason of [
			"build_mismatch",
			"outdated_hub",
			"unsupported_protocol",
		]) {
			await emit({ ...missingPluginUi, reason });
			expect(notice()).toBeNull();
		}
	});

	it("restarts right away when a fresh reading finds nothing to interrupt, then confirms", async () => {
		const upgrade = deferred<unknown>();
		answerCommands({ upgrade: () => upgrade.promise });
		await render(<HubCapabilityNotice />);
		await emit({ ...missingPluginUi, activeSessionCount: 4 });

		await click("Restart Hub");

		expect(invokedCommands()).toEqual(["hub_session_activity", "hub_upgrade"]);
		expect(invoke).toHaveBeenLastCalledWith(
			"hub_upgrade",
			{},
			expect.objectContaining({ timeoutMs: expect.any(Number) }),
		);
		expect(button("Restarting…").disabled).toBe(true);
		expect(button("Not now").disabled).toBe(true);

		// The sidecar's own "resolved" broadcast lands before its reply.
		await emit(null);
		expect(notice()).not.toBeNull();
		await act(async () => upgrade.resolve({ outcome: "replaced" }));

		expect(notice()?.textContent).toContain("Cline Hub restarted");
		expect(notice()?.textContent).toContain(
			"Suggestions appear in each open chat after its next message.",
		);
		await click("Done");
		expect(notice()).toBeNull();
	});

	it("asks again with a fresh count before interrupting sessions", async () => {
		answerCommands({
			activity: async () => ({
				activeSessionCount: 3,
				participantClientCount: 2,
			}),
		});
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		await click("Restart Hub");

		expect(invokedCommands()).toEqual(["hub_session_activity"]);
		expect(notice()?.textContent).toContain(
			"The Hub is serving 3 active sessions from 2 connected Cline clients, including any in this app. Restarting interrupts their work in progress.",
		);

		await click("Restart anyway");
		expect(invokedCommands()).toEqual(["hub_session_activity", "hub_upgrade"]);
		expect(notice()?.textContent).toContain("Cline Hub restarted");
	});

	it("leaves the Hub running when the person cancels the confirmation", async () => {
		answerCommands({ activity: async () => ({ activeSessionCount: 1 }) });
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		await click("Restart Hub");
		await click("Cancel");

		expect(invokedCommands()).toEqual(["hub_session_activity"]);
		expect(button("Restart Hub").disabled).toBe(false);
		expect(notice()?.textContent).not.toContain("The Hub is serving");
	});

	it("asks before restarting a Hub whose sessions could not be read", async () => {
		answerCommands({
			activity: async () => {
				throw new Error("Hub connection closed");
			},
		});
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		await click("Restart Hub");

		expect(invokedCommands()).toEqual(["hub_session_activity"]);
		expect(notice()?.textContent).toContain(
			"Cline couldn't check what the Hub is serving.",
		);
		expect(button("Restart anyway").disabled).toBe(false);
	});

	it("shows a failed restart inline and lets the person try again", async () => {
		const upgrade = deferred<unknown>();
		answerCommands({ upgrade: () => upgrade.promise });
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		await click("Restart Hub");
		// The sidecar re-sends the mismatch it still sees before it fails.
		await emit(missingPluginUi);
		await act(async () =>
			upgrade.reject(
				new Error(
					"Another Cline app restarted the Cline Hub with its own version first, so suggestions are still off. Quit the other Cline apps, then restart the Hub again.",
				),
			),
		);

		expect(notice()?.textContent).toContain(
			"Another Cline app restarted the Cline Hub with its own version first",
		);
		expect(button("Restart Hub").disabled).toBe(false);
	});

	it("closes when the sidecar reports the mismatch resolved", async () => {
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);
		expect(notice()).not.toBeNull();

		await emit(null);

		expect(notice()).toBeNull();
	});

	it("keeps Not now through replays and remounts in this app run, apart from the dialog's Later", async () => {
		localStorage.setItem(
			"cline.hub-mismatch-dismissed",
			"build_mismatch:source-0.0.94",
		);
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		await click("Not now");
		expect(notice()).toBeNull();

		await emit(missingPluginUi);
		expect(notice()).toBeNull();

		await unmount();
		mount();
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);
		expect(notice()).toBeNull();
		expect(localStorage.getItem("cline.hub-mismatch-dismissed")).toBe(
			"build_mismatch:source-0.0.94",
		);

		await emit({ ...missingPluginUi, hubBuildId: "source-0.0.92" });
		expect(notice()).not.toBeNull();
	});

	it("asks again once the app has quit and started again", async () => {
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);
		await click("Not now");

		await unmount();
		sessionStorage.clear();
		mount();
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		expect(notice()).not.toBeNull();
	});

	it("hands focus back to the composer when the person dismisses it", async () => {
		const composer = mountComposer();
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		button("Not now").focus();
		await click("Not now");
		await flushFocusRequests();

		expect(document.activeElement).toBe(composer);
	});

	it("keeps focus in the notice through the restart, and hands it back once done", async () => {
		const composer = mountComposer();
		answerCommands({ activity: async () => ({ activeSessionCount: 2 }) });
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		button("Restart Hub").focus();
		await click("Restart Hub");
		expect(document.activeElement).toBe(button("Restart anyway"));

		await click("Restart anyway");
		expect(document.activeElement).toBe(button("Done"));

		await click("Done");
		await flushFocusRequests();
		expect(document.activeElement).toBe(composer);
	});

	it("leaves focus where the person moved it while the Hub restarted", async () => {
		const composer = mountComposer();
		const upgrade = deferred<unknown>();
		answerCommands({ upgrade: () => upgrade.promise });
		await render(<HubCapabilityNotice />);
		await emit(missingPluginUi);

		await click("Restart Hub");
		composer.focus();
		await act(async () => upgrade.resolve({ outcome: "replaced" }));

		expect(document.activeElement).toBe(composer);
	});
});
