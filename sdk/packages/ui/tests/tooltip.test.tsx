// @vitest-environment jsdom

import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "../components/button.js";
import { Tooltip, TooltipProvider } from "../components/tooltip.js";

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

function trigger(index = 0) {
	const button = container.querySelectorAll("button").item(index);
	if (!button) throw new Error("Missing tooltip trigger");
	return button;
}

function movePointer(element: HTMLElement) {
	const event = new MouseEvent("pointermove", { bubbles: true });
	Object.defineProperty(event, "pointerType", { value: "mouse" });
	element.dispatchEvent(event);
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

	it.each([
		[false, undefined],
		[false, "button-help"],
		[true, undefined],
		[true, "button-help"],
	] as const)("restores descriptions after Escape with asChild=%s and description=%s", async (asChild, description) => {
		await render(
			<>
				<p id="button-help">Saves changes to this workspace.</p>
				<p id="link-help">Opens the workspace settings.</p>
				<Tooltip content="Save your changes">
					<Button asChild={asChild} aria-describedby={description}>
						{asChild ? (
							<a href="#settings" aria-describedby="link-help">
								Settings
							</a>
						) : (
							"Save"
						)}
					</Button>
				</Tooltip>
			</>,
		);
		const target = container.querySelector<HTMLElement>("button, a");
		if (!target) throw new Error("Missing tooltip trigger");
		const descriptions = [
			asChild ? "link-help" : undefined,
			description,
		].filter(Boolean);
		expect(tooltip()).toBeNull();
		expect(target.getAttribute("aria-describedby")).toBe(
			descriptions.join(" ") || null,
		);
		await act(async () => target.focus());
		expect(target.getAttribute("aria-describedby")?.split(" ")).toEqual([
			...descriptions,
			tooltip()?.id,
		]);
		expect(tooltip()?.textContent).toBe("Save your changes");
		expect(container.contains(tooltip())).toBe(false);
		await act(async () => {
			target.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(tooltip()).toBeNull();
		expect(target.getAttribute("aria-describedby")).toBe(
			descriptions.join(" ") || null,
		);
		expect(document.activeElement).toBe(target);
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

	it("preserves trigger composition and focuses immediately under a delayed provider", async () => {
		vi.useFakeTimers();
		const ref = createRef<HTMLButtonElement>();
		const onFocus = vi.fn();
		const onClick = vi.fn();
		await render(
			<TooltipProvider delayDuration={150}>
				<Tooltip content="Save your changes">
					<Button onClick={onClick} onFocus={onFocus} ref={ref}>
						Save
					</Button>
				</Tooltip>
			</TooltipProvider>,
		);
		const button = trigger();
		expect(ref.current).toBe(button);
		expect(container.children).toHaveLength(1);
		expect(container.firstElementChild).toBe(button);
		await act(async () => button.focus());
		expect(onFocus).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(button);
		expect(tooltip()?.textContent).toBe("Save your changes");
		await act(async () => button.click());
		expect(onClick).toHaveBeenCalledOnce();
		expect(tooltip()).toBeNull();
	});

	it.each([
		"standalone",
		"shared provider",
	])("keeps the default hover delay at zero with %s usage", async (usage) => {
		vi.useFakeTimers();
		const content = (
			<Tooltip content="Save your changes">
				<Button>Save</Button>
			</Tooltip>
		);
		await render(
			usage === "shared provider" ? (
				<TooltipProvider>{content}</TooltipProvider>
			) : (
				content
			),
		);
		await act(async () => {
			movePointer(trigger());
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(tooltip()?.textContent).toBe("Save your changes");
	});

	it("shares hover warmup between neighboring tooltips", async () => {
		vi.useFakeTimers();
		await render(
			<TooltipProvider delayDuration={150} skipDelayDuration={100}>
				<Tooltip content="Save your changes">
					<Button>Save</Button>
				</Tooltip>
				<Tooltip content="Copy your changes">
					<Button>Copy</Button>
				</Tooltip>
			</TooltipProvider>,
		);
		await act(async () => {
			movePointer(trigger());
			await vi.advanceTimersByTimeAsync(149);
		});
		expect(tooltip()).toBeNull();
		await act(async () => vi.advanceTimersByTimeAsync(1));
		expect(tooltip()?.textContent).toBe("Save your changes");

		await act(async () => trigger().click());
		expect(tooltip()).toBeNull();
		await act(async () => vi.advanceTimersByTimeAsync(99));
		await act(async () => movePointer(trigger(1)));
		expect(tooltip()?.textContent).toBe("Copy your changes");
	});

	it.each([
		[undefined, 150],
		[150, 0],
		[150, 50],
	] as const)("honors provider delay %s overridden by tooltip delay %s", async (providerDelay, delayDuration) => {
		vi.useFakeTimers();
		const content = (
			<Tooltip content="Save your changes" delayDuration={delayDuration}>
				<Button>Save</Button>
			</Tooltip>
		);
		await render(
			providerDelay === undefined ? (
				content
			) : (
				<TooltipProvider delayDuration={providerDelay}>
					{content}
				</TooltipProvider>
			),
		);
		await act(async () => movePointer(trigger()));
		if (delayDuration > 0) {
			await act(async () => vi.advanceTimersByTimeAsync(delayDuration - 1));
			expect(tooltip()).toBeNull();
		}
		await act(async () =>
			vi.advanceTimersByTimeAsync(delayDuration > 0 ? 1 : 0),
		);
		expect(tooltip()?.textContent).toBe("Save your changes");
	});
});
