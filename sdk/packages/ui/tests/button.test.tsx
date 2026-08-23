// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "../components/index.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

describe("Button", () => {
	it("defaults to a non-submitting accent button", async () => {
		await render(<Button>Continue</Button>);
		const button = container.querySelector("button");
		expect(button?.type).toBe("button");
		expect(button?.dataset.slot).toBe("button");
		expect(button?.className).toContain("bg-cline-ui-primary");
	});

	it("forwards native props, refs, and decisions", async () => {
		const onClick = vi.fn();
		let forwardedRef: HTMLButtonElement | null = null;
		await render(
			<Button
				className="consumer-class"
				onClick={onClick}
				ref={(node) => {
					forwardedRef = node;
				}}
				size="lg"
				tone="destructive"
				variant="surface"
			>
				Delete
			</Button>,
		);
		const element = container.querySelector<HTMLButtonElement>("button");
		expect(forwardedRef).toBe(element);
		expect(element?.className).toContain("consumer-class");
		expect(element?.className).toContain("text-cline-ui-destructive");
		await act(async () => element?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("supports composition through asChild", async () => {
		await render(
			<Button asChild variant="ghost">
				<a href="/settings">Settings</a>
			</Button>,
		);
		const link = container.querySelector("a");
		expect(link?.getAttribute("href")).toBe("/settings");
		expect(link?.dataset.slot).toBe("button");
		expect(container.querySelector("button")).toBeNull();
	});

	it("prevents activation when a composed link is disabled", async () => {
		const onClick = vi.fn();
		const onClickCapture = vi.fn();
		await render(
			<Button
				aria-disabled={false}
				asChild
				data-disabled="consumer-value"
				disabled
				onClick={onClick}
				tabIndex={0}
			>
				<a href="/settings" onClick={onClick} onClickCapture={onClickCapture}>
					Settings
				</a>
			</Button>,
		);
		const link = container.querySelector<HTMLAnchorElement>("a");
		expect(link?.getAttribute("aria-disabled")).toBe("true");
		expect(link?.getAttribute("data-disabled")).toBe("");
		expect(link?.getAttribute("disabled")).toBeNull();
		expect(link?.tabIndex).toBe(-1);
		await act(async () => link?.click());
		expect(onClick).not.toHaveBeenCalled();
		expect(onClickCapture).not.toHaveBeenCalled();
	});
});

describe("IconButton", () => {
	it("requires and renders an accessible name", async () => {
		await render(<IconButton aria-label="Add item">+</IconButton>);
		const button = container.querySelector("button");
		expect(button?.getAttribute("aria-label")).toBe("Add item");
		expect(button?.dataset.slot).toBe("icon-button");
	});

	it("does not invoke actions while disabled", async () => {
		const onClick = vi.fn();
		await render(
			<IconButton aria-label="Remove item" disabled onClick={onClick}>
				−
			</IconButton>,
		);
		await act(async () => container.querySelector("button")?.click());
		expect(onClick).not.toHaveBeenCalled();
	});

	it("prevents activation when a composed link is disabled", async () => {
		const onClick = vi.fn();
		const onClickCapture = vi.fn();
		await render(
			<IconButton
				aria-disabled={false}
				aria-label="Remove item"
				asChild
				data-disabled="consumer-value"
				disabled
				onClick={onClick}
				tabIndex={0}
			>
				<a href="/remove" onClick={onClick} onClickCapture={onClickCapture}>
					−
				</a>
			</IconButton>,
		);
		const link = container.querySelector<HTMLAnchorElement>("a");
		expect(link?.getAttribute("aria-disabled")).toBe("true");
		expect(link?.getAttribute("data-disabled")).toBe("");
		expect(link?.getAttribute("disabled")).toBeNull();
		expect(link?.tabIndex).toBe(-1);
		await act(async () => link?.click());
		expect(onClick).not.toHaveBeenCalled();
		expect(onClickCapture).not.toHaveBeenCalled();
	});
});
