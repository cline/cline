// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SideConversationMenu } from "./side-conversation-menu";

let container: HTMLDivElement;
let root: Root;
const onDelete = vi.fn();
beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.clearAllMocks();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () =>
		root.render(<SideConversationMenu onDelete={onDelete} />),
	);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function openMenu() {
	const trigger = container.querySelector<HTMLButtonElement>(
		'[aria-label="Side chat actions"]',
	);
	if (!trigger) throw new Error("Missing side actions");
	await act(async () =>
		trigger.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		),
	);
}
async function select(label: string) {
	const item = [
		...document.querySelectorAll<HTMLElement>(
			'[role="menuitem"], [role="menuitemradio"]',
		),
	].find((item) => item.textContent === label);
	if (!item) throw new Error(`Missing menu item: ${label}`);
	await act(async () => item.click());
}
it("opens the menu with the keyboard and deletes the side chat", async () => {
	await openMenu();
	expect(
		[...document.querySelectorAll('[role="menuitem"]')].map(
			(item) => item.textContent,
		),
	).toEqual(["Delete side chat"]);
	await select("Delete side chat");
	expect(onDelete).toHaveBeenCalledOnce();
});
