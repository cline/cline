// @vitest-environment jsdom

import { act, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratingCompanion } from "./generating-companion";

type AnimationStub = {
	pause: ReturnType<typeof vi.fn>;
	play: ReturnType<typeof vi.fn>;
	cancel: ReturnType<typeof vi.fn>;
};

let container: HTMLDivElement;
let root: Root;
let animations: AnimationStub[];
let reducedMotion: boolean;
let mediaListeners: Set<() => void>;
let hidden: boolean;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	animations = [];
	reducedMotion = false;
	mediaListeners = new Set();
	hidden = false;
	vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			get matches() {
				return reducedMotion;
			},
			addEventListener: (_event: string, listener: () => void) => {
				mediaListeners.add(listener);
			},
			removeEventListener: (_event: string, listener: () => void) => {
				mediaListeners.delete(listener);
			},
		})),
	);
	vi.stubGlobal("Animation", class {});
	Object.defineProperty(HTMLElement.prototype, "animate", {
		configurable: true,
		writable: true,
		value: vi.fn(() => {
			const animation = { pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
			animations.push(animation);
			return animation;
		}),
	});
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function danceButton() {
	const button = container.querySelector<HTMLButtonElement>(
		'button[aria-label^="Change Cline dance"]',
	);
	if (!button) throw new Error("Missing dance control");
	return button;
}

function waitingButton() {
	const button = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Cline is waiting for your response"]',
	);
	if (!button) throw new Error("Missing waiting companion");
	return button;
}

async function click(button: HTMLButtonElement) {
	await act(async () => button.click());
}

describe("GeneratingCompanion", () => {
	it("cycles the three dances without sending, bubbling, or disturbing an active draft", async () => {
		const draftRef = createRef<HTMLTextAreaElement>();
		const onClick = vi.fn();
		const onSubmit = vi.fn((event: Event) => event.preventDefault());
		await act(async () =>
			root.render(
				// biome-ignore lint/a11y/useKeyWithClickEvents: test-only bubbling observer, not a form action.
				<form onClick={onClick}>
					<textarea ref={draftRef} defaultValue="Keep this draft exactly." />
					<GeneratingCompanion active draftRef={draftRef} />
				</form>,
			),
		);
		container.querySelector("form")?.addEventListener("submit", onSubmit);
		const draft = draftRef.current;
		if (!draft) throw new Error("Missing draft");
		draft.focus();
		draft.setSelectionRange(5, 10);
		const mouseDown = new MouseEvent("mousedown", {
			button: 0,
			bubbles: true,
			cancelable: true,
		});
		danceButton().dispatchEvent(mouseDown);
		expect(mouseDown.defaultPrevented).toBe(true);
		expect(danceButton().type).toBe("button");
		expect(danceButton().getAttribute("aria-label")).toContain("Mr. Robot");
		await click(danceButton());
		expect(danceButton().getAttribute("aria-label")).toContain("Cline Shuffle");
		await click(danceButton());
		expect(danceButton().getAttribute("aria-label")).toContain("Slow Groove");
		await click(danceButton());
		expect(danceButton().getAttribute("aria-label")).toContain("Mr. Robot");
		expect(draft.value).toBe("Keep this draft exactly.");
		expect(draft.selectionStart).toBe(5);
		expect(draft.selectionEnd).toBe(10);
		expect(document.activeElement).toBe(draft);
		expect(onClick).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();
		expect(
			animations
				.slice(0, -1)
				.every((animation) => animation.cancel.mock.calls.length === 1),
		).toBe(true);
	});

	it("hides and cancels immediately when inactive, preserving the dance for the next work episode", async () => {
		await act(async () => root.render(<GeneratingCompanion active />));
		await click(danceButton());
		const animation = animations.at(-1);
		await act(async () => root.render(<GeneratingCompanion active={false} />));
		expect(danceButton().closest("[hidden]")).not.toBeNull();
		expect(animation?.cancel).toHaveBeenCalledOnce();
		await act(async () => root.render(<GeneratingCompanion active />));
		expect(danceButton().closest("[hidden]")).toBeNull();
		expect(danceButton().getAttribute("aria-label")).toContain("Cline Shuffle");
	});

	it("uses a static pose for reduced motion and responds to preference changes", async () => {
		reducedMotion = true;
		await act(async () => root.render(<GeneratingCompanion active />));
		expect(animations).toHaveLength(0);
		expect(danceButton().closest("[hidden]")).toBeNull();
		await act(async () => {
			reducedMotion = false;
			for (const listener of mediaListeners) listener();
		});
		expect(animations).toHaveLength(1);
		await act(async () => {
			reducedMotion = true;
			for (const listener of mediaListeners) listener();
		});
		expect(animations[0]?.cancel).toHaveBeenCalledOnce();
	});

	it("suspends hidden-page motion and resumes when visible again", async () => {
		await act(async () => root.render(<GeneratingCompanion active />));
		const animation = animations.at(-1);
		hidden = true;
		document.dispatchEvent(new Event("visibilitychange"));
		expect(animation?.pause).toHaveBeenCalled();
		hidden = false;
		document.dispatchEvent(new Event("visibilitychange"));
		expect(animation?.play).toHaveBeenCalled();
	});

	it("holds a curious pose while awaiting a response, then resumes the selected dance", async () => {
		await act(async () => root.render(<GeneratingCompanion active />));
		await click(danceButton());
		const animation = animations.at(-1);
		const count = animations.length;
		const button = danceButton();
		button.focus();
		await act(async () =>
			root.render(<GeneratingCompanion active awaitingResponse />),
		);
		expect(animation?.cancel).toHaveBeenCalledOnce();
		expect(waitingButton()).toBe(button);
		expect(document.activeElement).toBe(button);
		expect(button.getAttribute("aria-disabled")).toBe("true");
		expect(button.tabIndex).toBe(-1);
		expect(button.querySelector("svg")).not.toBeNull();
		expect(button.querySelector("span")).toBeNull();
		expect(button.closest("[hidden]")).toBeNull();

		// Returning to the page or activating the inert bot cannot bypass a wait.
		hidden = true;
		document.dispatchEvent(new Event("visibilitychange"));
		hidden = false;
		document.dispatchEvent(new Event("visibilitychange"));
		await click(button);
		expect(animation?.play).not.toHaveBeenCalled();
		expect(animations).toHaveLength(count);
		expect(waitingButton().querySelector("svg")).not.toBeNull();

		await act(async () => root.render(<GeneratingCompanion active />));
		expect(danceButton().getAttribute("aria-label")).toContain("Cline Shuffle");
		expect(danceButton().hasAttribute("aria-disabled")).toBe(false);
		expect(danceButton().tabIndex).toBe(0);
		expect(animations).toHaveLength(count + 1);
	});

	it("keeps the waiting pose still through reduced-motion preference changes", async () => {
		reducedMotion = true;
		await act(async () =>
			root.render(<GeneratingCompanion active awaitingResponse />),
		);
		const pose = waitingButton().querySelector("svg");
		expect(pose).not.toBeNull();
		await act(async () => {
			reducedMotion = false;
			for (const listener of mediaListeners) listener();
		});
		expect(waitingButton().querySelector("svg")).toBe(pose);
		expect(animations).toHaveLength(0);
		await act(async () => {
			reducedMotion = true;
			for (const listener of mediaListeners) listener();
		});
		await act(async () => root.render(<GeneratingCompanion active />));
		expect(danceButton().querySelector("span")).not.toBeNull();
		expect(animations).toHaveLength(0);
	});

	it("hides the waiting pose on completion and returns its keyboard focus to the draft", async () => {
		const draftRef = createRef<HTMLTextAreaElement>();
		const render = (active: boolean, awaitingResponse: boolean) => (
			<div>
				<textarea ref={draftRef} defaultValue="Keep my answer." />
				<GeneratingCompanion
					active={active}
					awaitingResponse={awaitingResponse}
					draftRef={draftRef}
				/>
			</div>
		);
		await act(async () => root.render(render(true, false)));
		danceButton().focus();
		await act(async () => root.render(render(true, true)));
		expect(document.activeElement).toBe(waitingButton());
		await act(async () => root.render(render(false, true)));
		expect(waitingButton().closest("[hidden]")).not.toBeNull();
		expect(document.activeElement).toBe(draftRef.current);
		expect(draftRef.current?.value).toBe("Keep my answer.");
		expect(animations).toHaveLength(1);
	});

	it("returns keyboard focus to the draft on completion, without taking it from another control", async () => {
		const draftRef = createRef<HTMLTextAreaElement>();
		const render = (active: boolean) => (
			<div>
				<textarea ref={draftRef} />
				<button type="button" data-other>
					Another action
				</button>
				<GeneratingCompanion active={active} draftRef={draftRef} />
			</div>
		);
		await act(async () => root.render(render(true)));
		danceButton().focus();
		await act(async () => root.render(render(false)));
		expect(document.activeElement).toBe(draftRef.current);
		await act(async () => root.render(render(true)));
		danceButton().focus();
		const other = container.querySelector<HTMLButtonElement>("[data-other]");
		other?.focus();
		await act(async () => root.render(render(false)));
		expect(document.activeElement).toBe(other);
	});

	it("cleans up playback in Strict Mode and can render a still pose without Web Animations", async () => {
		await act(async () =>
			root.render(
				<StrictMode>
					<GeneratingCompanion active />
				</StrictMode>,
			),
		);
		await act(async () => root.render(null));
		expect(
			animations.every((animation) => animation.cancel.mock.calls.length === 1),
		).toBe(true);
		expect(mediaListeners.size).toBe(0);
		delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
		await act(async () => root.render(<GeneratingCompanion active />));
		expect(
			danceButton().querySelector("span")?.style.backgroundImage,
		).toContain("/cline-companion/");
	});
});
