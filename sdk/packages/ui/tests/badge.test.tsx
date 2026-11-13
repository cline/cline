// @vitest-environment jsdom

import { act, createRef, type FormEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Badge } from "../components/index.js";

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

describe("Badge", () => {
	it("renders static content as a span", async () => {
		await render(<Badge>Required</Badge>);
		const badge = container.querySelector("span");
		expect(badge?.textContent).toBe("Required");
		expect(badge?.dataset.slot).toBe("badge");
		expect(badge?.tabIndex).toBe(-1);
		expect(container.querySelector("button")).toBeNull();
	});

	it("forwards native props, refs, and custom classes", async () => {
		const forwardedRef = createRef<HTMLSpanElement>();
		const onClick = vi.fn();
		await render(
			<Badge
				aria-label="Status"
				className="consumer-class"
				interactive={false}
				onClick={(event) => onClick(event.currentTarget)}
				ref={forwardedRef}
				title="Current status"
			>
				Active
			</Badge>,
		);
		const badge = container.querySelector<HTMLSpanElement>("span");
		expect(forwardedRef.current).toBe(badge);
		expect(badge?.className).toContain("consumer-class");
		expect(badge?.getAttribute("aria-label")).toBe("Status");
		expect(badge?.title).toBe("Current status");
		expect(badge?.hasAttribute("interactive")).toBe(false);
		await act(async () => badge?.click());
		expect(onClick).toHaveBeenCalledExactlyOnceWith(badge);
	});

	it("renders an action as a native button with a button ref and click target", async () => {
		const ref = createRef<HTMLButtonElement>();
		const onAction = vi.fn();
		await render(
			<Badge
				interactive
				aria-label="Filter completed tasks"
				onClick={(event) => {
					const button: HTMLButtonElement = event.currentTarget;
					onAction(button);
				}}
				ref={ref}
				tone="success"
			>
				Completed
			</Badge>,
		);
		const badge = container.querySelector("button");
		expect(badge).not.toBeNull();
		expect(ref.current).toBe(badge);
		expect(badge?.dataset.slot).toBe("badge");
		expect(badge?.hasAttribute("interactive")).toBe(false);
		expect(badge?.getAttribute("aria-label")).toBe("Filter completed tasks");
		expect(badge?.textContent).toBe("Completed");
		expect(badge?.tabIndex).toBe(0);
		await act(async () => badge?.click());
		expect(onAction).toHaveBeenCalledOnce();
		expect(onAction).toHaveBeenCalledWith(badge);
	});

	it.each([
		undefined,
		"submit",
	] as const)("uses native form behavior for type=%s", async (type) => {
		const onClick = vi.fn();
		const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
			event.preventDefault(),
		);
		await render(
			<form onSubmit={onSubmit}>
				<Badge interactive type={type} onClick={type ? undefined : onClick}>
					Apply
				</Badge>
			</form>,
		);
		const badge = container.querySelector("button");
		expect(badge?.type).toBe(type ?? "button");
		await act(async () => badge?.click());
		expect(onClick).toHaveBeenCalledTimes(type ? 0 : 1);
		expect(onSubmit).toHaveBeenCalledTimes(type ? 1 : 0);
	});

	it("prevents activation while disabled", async () => {
		const onClick = vi.fn();
		await render(
			<Badge interactive disabled onClick={onClick}>
				Unavailable
			</Badge>,
		);
		const badge = container.querySelector("button");
		expect(badge?.disabled).toBe(true);
		await act(async () => badge?.click());
		expect(onClick).not.toHaveBeenCalled();
	});
});
