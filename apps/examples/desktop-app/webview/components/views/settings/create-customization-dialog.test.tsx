// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreateCustomizationDialog } from "./create-customization-dialog";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invoke.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function fill(id: string, value: string) {
	const element = document.getElementById(id);
	if (
		!(
			element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement
		)
	)
		throw new Error("Missing field");
	const prototype =
		element instanceof HTMLInputElement
			? HTMLInputElement.prototype
			: HTMLTextAreaElement.prototype;
	await act(async () => {
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
			element,
			value,
		);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
it.each([
	"rule",
	"skill",
] as const)("creates a global %s and refreshes the inventory", async (type) => {
	const onCreated = vi.fn().mockResolvedValue(undefined);
	invoke.mockResolvedValue({ path: "/global/review.md" });
	await act(async () =>
		root.render(
			<CreateCustomizationDialog type={type} onCreated={onCreated} />,
		),
	);
	await act(async () => container.querySelector("button")?.click());
	await fill("customization-name", "review");
	if (type === "skill") await fill("customization-description", "Review code");
	await fill("customization-content", "Review carefully.");
	await act(async () =>
		document
			.querySelector("form")
			?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	);
	expect(invoke).toHaveBeenCalledWith("create_global_customization", {
		type,
		name: "review",
		content: "Review carefully.",
		description: type === "skill" ? "Review code" : "",
	});
	expect(onCreated).toHaveBeenCalledOnce();
	expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("loads supported hook events and preserves the draft when creation fails", async () => {
	invoke.mockImplementation(async (command) => {
		if (command === "list_creatable_hook_events")
			return { events: ["TaskStart", "PostToolUse"] };
		throw new Error("A hook already exists.");
	});
	const onCreated = vi.fn();
	await act(async () =>
		root.render(
			<CreateCustomizationDialog type="hook" onCreated={onCreated} />,
		),
	);
	await act(async () => container.querySelector("button")?.click());
	expect(document.querySelectorAll("option")).toHaveLength(2);
	await act(async () =>
		document
			.querySelector("form")
			?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	);
	expect(document.querySelector('[role="alert"]')?.textContent).toContain(
		"already exists",
	);
	expect(document.querySelector("textarea")?.value).toContain("process.stdin");
	expect(onCreated).not.toHaveBeenCalled();
});
