// @vitest-environment jsdom

import { DetailList } from "@cline/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealActionLabel } from "@/lib/reveal-label";
import { PathDetailListItem } from "./path-detail-list-item";

/** The reveal action is named for the desktop the tests run on. */
const REVEAL = revealActionLabel();

const { invoke, writeText } = vi.hoisted(() => ({
	invoke: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
}));

const path = "/workspace/My project/.agents/skills/example/SKILL.md";
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	invoke.mockReset().mockResolvedValue(undefined);
	writeText.mockReset().mockResolvedValue(undefined);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function render(currentPath: string | undefined = path) {
	await act(async () => {
		root.render(
			<DetailList>
				<PathDetailListItem
					title="Path"
					path={currentPath}
					trailingText={currentPath}
					label="Skill path"
				/>
			</DetailList>,
		);
	});
}

function trigger() {
	const button = container.querySelector<HTMLButtonElement>(
		'[aria-label="Skill path actions"]',
	);
	if (!button) throw new Error("Missing path actions button");
	return button;
}

async function openMenu() {
	await act(async () => {
		trigger().focus();
		trigger().dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
}

function menuItem(label: string) {
	const item = [
		...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((candidate) => candidate.textContent === label);
	if (!item) throw new Error(`Missing menu item: ${label}`);
	return item;
}

async function select(label: string) {
	await act(async () => menuItem(label).click());
}

describe("Path detail list item", () => {
	it("supports keyboard access, Escape, and focus restoration", async () => {
		await render();
		expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
		await openMenu();
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		expect(
			[...document.querySelectorAll('[role="menuitem"]')].map(
				(item) => item.textContent,
			),
		).toEqual([REVEAL, "Copy path"]);
		await act(async () => {
			menuItem(REVEAL).dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(document.querySelector('[role="menu"]')).toBeNull();
		// Radix restores the trigger after the menu unmounts.
		await vi.waitFor(() => expect(document.activeElement).toBe(trigger()));
		expect(invoke).not.toHaveBeenCalled();
		expect(writeText).not.toHaveBeenCalled();
	});

	it("reveals the path without opening the file itself", async () => {
		await render();
		await openMenu();
		await select(REVEAL);
		expect(invoke).toHaveBeenCalledExactlyOnceWith("reveal_path", { path });
		expect(writeText).not.toHaveBeenCalled();
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it("copies the full path by keyboard and announces completion", async () => {
		await render();
		await openMenu();
		await act(async () => {
			menuItem("Copy path").dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		expect(writeText).toHaveBeenCalledExactlyOnceWith(path);
		expect(container.querySelector("output")?.textContent).toBe(
			"Skill path copied.",
		);
		expect(invoke).not.toHaveBeenCalled();
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it.each([
		[REVEAL, "Could not open skill path location."],
		["Copy path", "Could not copy skill path."],
	])("reports a failed %s action and permits retry", async (action, message) => {
		const operation = action === "Copy path" ? writeText : invoke;
		operation.mockRejectedValueOnce(new Error("Permission denied"));
		await render();
		await openMenu();
		await select(action);
		const alert = container.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain(message);
		expect(
			alert?.closest(".cline-ui-detail-list-item__description"),
		).not.toBeNull();
		expect(alert?.closest(".cline-ui-detail-list-item__actions")).toBeNull();
		expect(container.querySelector("output")?.textContent).not.toContain(
			"copied",
		);
		await openMenu();
		await select(action);
		expect(operation).toHaveBeenCalledTimes(2);
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});

	it("disables both actions when no path is available", async () => {
		await render("");
		await openMenu();
		for (const action of [REVEAL, "Copy path"]) {
			expect(menuItem(action).getAttribute("aria-disabled")).toBe("true");
			await select(action);
		}
		expect(invoke).not.toHaveBeenCalled();
		expect(writeText).not.toHaveBeenCalled();
	});

	it("blocks duplicate actions while revealing a location", async () => {
		let finish!: () => void;
		invoke.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		await render();
		await openMenu();
		await select(REVEAL);
		expect(trigger().getAttribute("aria-busy")).toBe("true");
		await openMenu();
		for (const action of [REVEAL, "Copy path"]) {
			expect(menuItem(action).getAttribute("aria-disabled")).toBe("true");
			await select(action);
		}
		expect(invoke).toHaveBeenCalledOnce();
		expect(writeText).not.toHaveBeenCalled();
		await act(async () => finish());
		expect(menuItem(REVEAL).getAttribute("aria-disabled")).not.toBe("true");
	});

	it("clears stale feedback when the selected path changes", async () => {
		await render();
		await openMenu();
		await select("Copy path");
		expect(container.querySelector("output")?.textContent).toBe(
			"Skill path copied.",
		);
		invoke.mockRejectedValueOnce(new Error("Permission denied"));
		await openMenu();
		await select(REVEAL);
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not open skill path location.",
		);
		await render("/workspace/another/SKILL.md");
		expect(container.querySelector("output")?.textContent).not.toContain(
			"copied",
		);
		expect(container.querySelector('[role="alert"]')).toBeNull();
		await openMenu();
		await select(REVEAL);
		expect(invoke).toHaveBeenLastCalledWith("reveal_path", {
			path: "/workspace/another/SKILL.md",
		});
	});
});
