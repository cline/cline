// @vitest-environment jsdom

import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "../components/button.js";
import { Tooltip } from "../components/tooltip.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	// Radix measures its arrow with ResizeObserver, which jsdom does not provide.
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

function trigger() {
	const button = container.querySelector("button");
	if (!button) throw new Error("Missing tooltip trigger");
	return button;
}

function tooltip() {
	return document.querySelector<HTMLElement>('[role="tooltip"]');
}

describe("Tooltip", () => {
	it("keeps its content inside an explicitly scoped theme", async () => {
		container.className = "cline-ui-theme dark";
		await render(
			<Tooltip content="Save your changes" portalContainer={container}>
				<Button>Save</Button>
			</Tooltip>,
		);
		await act(async () => trigger().focus());
		expect(tooltip()?.closest(".cline-ui-theme")).toBe(container);
		expect(tooltip()?.closest(".dark")).toBe(container);
		expect(document.activeElement).toBe(trigger());
	});

	it("describes the focused trigger and dismisses on Escape without moving focus", async () => {
		await render(
			<Tooltip content="Save your changes">
				<Button>Save</Button>
			</Tooltip>,
		);
		const button = trigger();
		expect(tooltip()).toBeNull();
		await act(async () => button.focus());
		const descriptionId = button.getAttribute("aria-describedby");
		expect(descriptionId && document.getElementById(descriptionId)).toBe(
			tooltip(),
		);
		expect(tooltip()?.textContent).toBe("Save your changes");
		expect(container.contains(tooltip())).toBe(false);
		await act(async () => {
			button.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(tooltip()).toBeNull();
		expect(button.hasAttribute("aria-describedby")).toBe(false);
		expect(document.activeElement).toBe(button);
	});

	it("adds its description without replacing existing trigger descriptions", async () => {
		await render(
			<>
				<p id="save-help">Saves changes to this workspace.</p>
				<Tooltip content="Save your changes">
					<Button aria-describedby="save-help">Save</Button>
				</Tooltip>
			</>,
		);
		const button = trigger();
		expect(button.getAttribute("aria-describedby")).toBe("save-help");
		await act(async () => button.focus());
		expect(button.getAttribute("aria-describedby")?.split(" ")).toEqual([
			"save-help",
			tooltip()?.id,
		]);
		await act(async () => {
			button.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(tooltip()).toBeNull();
		expect(button.getAttribute("aria-describedby")).toBe("save-help");
		expect(document.activeElement).toBe(button);
	});

	it("dismisses when keyboard focus leaves the trigger", async () => {
		await render(
			<>
				<Tooltip content="Save your changes">
					<Button>Save</Button>
				</Tooltip>
				<a href="#next">Next control</a>
			</>,
		);
		await act(async () => trigger().focus());
		expect(tooltip()?.textContent).toBe("Save your changes");
		const nextControl = container.querySelector("a");
		await act(async () => nextControl?.focus());
		expect(tooltip()).toBeNull();
		expect(trigger().hasAttribute("aria-describedby")).toBe(false);
		expect(document.activeElement).toBe(nextControl);
	});

	it("preserves the shared Button ref, focus handler, and action without adding a trigger wrapper", async () => {
		const ref = createRef<HTMLButtonElement>();
		const onFocus = vi.fn();
		const onClick = vi.fn();
		await render(
			<Tooltip content="Save your changes">
				<Button onClick={onClick} onFocus={onFocus} ref={ref}>
					Save
				</Button>
			</Tooltip>,
		);
		const button = trigger();
		expect(ref.current).toBe(button);
		expect(container.children).toHaveLength(1);
		expect(container.firstElementChild).toBe(button);
		await act(async () => button.focus());
		expect(onFocus).toHaveBeenCalledOnce();
		expect(tooltip()?.textContent).toBe("Save your changes");
		await act(async () => button.click());
		expect(onClick).toHaveBeenCalledOnce();
		expect(tooltip()).toBeNull();
	});

	it("honors the configured hover delay", async () => {
		vi.useFakeTimers();
		await render(
			<Tooltip content="Save your changes" delayDuration={150}>
				<Button>Save</Button>
			</Tooltip>,
		);
		await act(async () => {
			const event = new MouseEvent("pointermove", { bubbles: true });
			Object.defineProperty(event, "pointerType", { value: "mouse" });
			trigger().dispatchEvent(event);
			await vi.advanceTimersByTimeAsync(149);
		});
		expect(tooltip()).toBeNull();
		await act(async () => vi.advanceTimersByTimeAsync(1));
		expect(tooltip()?.textContent).toBe("Save your changes");
	});
});
