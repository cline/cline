import type { PluginUiStateEnvelope } from "@cline/shared/browser";
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, vi } from "vitest";
import { SuggestionTray } from "@/components/views/chat/suggestion-tray/suggestion-tray";
import type { PromptInQueue } from "@/hooks/chat-session/types";
import { useComposerSuggestions } from "@/hooks/use-composer-suggestions";
import type {
	ComposerSuggestionsController,
	ComposerSuggestionsOptions,
} from "../types";
import { fakeDesktop } from "./fake-client";
import { ENVIRONMENT_ID, SESSION_ID } from "./fixtures";

/** Delivers a state the way the sidecar does: nested, stamped with the environment. */
export async function emitState(
	value: PluginUiStateEnvelope<"composer.suggestions">,
): Promise<void> {
	await act(async () => {
		fakeDesktop.emit("plugin_ui_state", {
			environmentId: ENVIRONMENT_ID,
			sessionId: value.sessionId,
			envelope: value,
		});
	});
	await settle();
}

/** `queue` reads the pane's queue as last rendered; the default removal takes from it, as the sidecar does. */
export function defaultOptions(
	queue: () => readonly PromptInQueue[],
): ComposerSuggestionsOptions {
	return {
		enabled: true,
		environmentId: ENVIRONMENT_ID,
		sessionId: SESSION_ID,
		status: "idle",
		loadingChat: false,
		waiting: false,
		messages: [],
		promptsInQueue: [],
		onSend: vi.fn(),
		onUndoTurn: vi.fn(async () => undefined),
		onRemoveQueuedPrompt: vi.fn(async (promptId: string) =>
			queue().find((queued) => queued.id === promptId),
		),
		abort: vi.fn(async () => undefined),
	};
}

type ControllerRef = { current?: ComposerSuggestionsController };

/** A chat pane in miniature: the hook, the tray, and a composer that submits on Enter as ChatInputBar does. */
function Harness({
	options,
	controllerRef,
}: {
	options: ComposerSuggestionsOptions;
	controllerRef: ControllerRef;
}) {
	const [draft, setDraft] = useState("");
	const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
	const suggestions = useComposerSuggestions(options);
	controllerRef.current = suggestions;
	return (
		<div data-testid="pane">
			{suggestions.enabled ? (
				<SuggestionTray
					composerInputRef={composerInputRef}
					composerMenuOpen={false}
					draft={draft}
					setDraft={setDraft}
					suggestions={suggestions}
				/>
			) : null}
			<textarea
				aria-label="Message"
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Enter" || event.shiftKey) return;
					event.preventDefault();
					const prompt = draft.trim();
					if (!prompt) return;
					suggestions.submitted(prompt);
					setDraft("");
					options.onSend(prompt);
				}}
				ref={composerInputRef}
				value={draft}
			/>
		</div>
	);
}

export type MountedTray = {
	container: HTMLDivElement;
	options(): ComposerSuggestionsOptions;
	composer(): HTMLTextAreaElement;
	controller(): ComposerSuggestionsController;
	update(changes: Partial<ComposerSuggestionsOptions>): Promise<void>;
	unmount(): Promise<void>;
};

const mounted = new Set<MountedTray>();

export async function mountTray(
	changes: Partial<ComposerSuggestionsOptions> = {},
): Promise<MountedTray> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const controllerRef: ControllerRef = {};
	let options: ComposerSuggestionsOptions = {
		...defaultOptions(() => options.promptsInQueue),
		...changes,
	};
	const render = () =>
		root.render(<Harness controllerRef={controllerRef} options={options} />);
	await act(async () => render());
	await settle();
	const tray: MountedTray = {
		container,
		options: () => options,
		composer: () => container.querySelector("textarea") as HTMLTextAreaElement,
		controller: () => controllerRef.current as ComposerSuggestionsController,
		async update(next) {
			options = { ...options, ...next };
			await act(async () => render());
			await settle();
		},
		async unmount() {
			mounted.delete(tray);
			await act(async () => root.unmount());
			container.remove();
		},
	};
	mounted.add(tray);
	return tray;
}

export async function unmountAll(): Promise<void> {
	for (const tray of [...mounted]) await tray.unmount();
}

/** Runs due timers and lets every pending reply land. */
export async function settle(ms = 0): Promise<void> {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
		for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
	});
}

export async function press(
	target: EventTarget,
	init: KeyboardEventInit,
): Promise<KeyboardEvent> {
	const event = new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		...init,
	});
	await act(async () => {
		target.dispatchEvent(event);
	});
	await settle();
	return event;
}

export async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await settle();
}

/** Radix menus open on pointerdown, not click. */
export async function pointerDown(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
	});
	await settle();
}

export async function typeInto(
	element: HTMLTextAreaElement,
	value: string,
): Promise<void> {
	const setValue = Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setValue?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await settle();
}

export function options(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
}

export function legendButton(
	container: HTMLElement,
	verb: string,
): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(
		`[data-testid="suggestion-legend"] button[data-verb="${verb}"]`,
	);
	expect(button).not.toBeNull();
	return button as HTMLButtonElement;
}

export function highlightedPrompt(container: HTMLElement): string | undefined {
	return (
		container
			.querySelector('[role="option"][aria-selected="true"]')
			?.getAttribute("title") ?? undefined
	);
}

/**
 * What jsdom lacks for the tray: the layout and pointer APIs the Radix menu
 * touches, and a platform, since the keys read Ctrl on every platform but the
 * Mac and the tests press Ctrl.
 */
export function stubBrowserApis(): void {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	if (!("ResizeObserver" in globalThis)) {
		Object.assign(globalThis, {
			ResizeObserver: class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		});
	}
	Element.prototype.scrollIntoView ??= () => {};
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.releasePointerCapture ??= () => {};
	vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
}
