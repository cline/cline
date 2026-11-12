// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useReturnPosition } from "./use-return-position";

let container: HTMLDivElement;
let root: Root;
let position: ReturnType<typeof useReturnPosition>;

function Harness() {
	position = useReturnPosition();
	return (
		<div data-viewport="">
			<button type="button">Open detail</button>
			<button type="button">Fallback</button>
		</div>
	);
}

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root.render(<Harness />));
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function elements() {
	const viewport = container.querySelector<HTMLElement>("[data-viewport]");
	const [trigger, fallback] = container.querySelectorAll("button");
	if (!viewport || !trigger || !fallback) throw new Error("Missing fixture");
	return { viewport, trigger, fallback };
}

it("restores the same list position across repeated Back/Forward visits", () => {
	const { viewport, trigger, fallback } = elements();
	viewport.scrollTop = 240;
	position.remember(trigger, viewport);

	for (let visit = 0; visit < 2; visit += 1) {
		viewport.scrollTop = 0;
		fallback.focus();
		expect(position.restore()).toBe(true);
		expect(viewport.scrollTop).toBe(240);
		expect(document.activeElement).toBe(trigger);
	}
});

it("uses the focus fallback when the remembered trigger cannot be focused", () => {
	const { viewport, trigger, fallback } = elements();
	const focusFallback = vi.fn(() => fallback.focus());
	position.remember(trigger, viewport);
	trigger.disabled = true;

	expect(position.restore(focusFallback)).toBe(true);
	expect(focusFallback).toHaveBeenCalledOnce();
	expect(document.activeElement).toBe(fallback);
});

it("can forget only the trigger or the entire position", () => {
	const { viewport, trigger, fallback } = elements();
	position.remember(trigger, viewport);
	position.forgetTrigger();
	expect(position.restore(() => fallback.focus())).toBe(true);
	expect(document.activeElement).toBe(fallback);

	position.forget();
	expect(position.restore()).toBe(false);
});
