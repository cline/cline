// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBrowserContent } from "../components/file-browser.js";

let container: HTMLDivElement;
let root: Root;
const writeText = vi.fn();
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
	writeText.mockReset().mockResolvedValue(undefined);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
	await act(async () => root.render(node));
}
async function openMenu() {
	const trigger = container.querySelector<HTMLButtonElement>(
		'[aria-label="File actions"]',
	);
	if (!trigger) throw new Error("Missing file actions");
	await act(async () => {
		trigger.focus();
		trigger.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
	return trigger;
}
function item(label: string) {
	const match = [
		...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((node) => node.textContent === label);
	if (!match) throw new Error(`Missing action: ${label}`);
	return match;
}
async function select(label: string) {
	await act(async () => item(label).click());
}

describe("File browser actions", () => {
	it("shows by default, copies the displayed path, and allows consumers to opt out", async () => {
		await render(<FileBrowserContent path="references/guide.md" />);
		await openMenu();
		expect(item("Open file location").getAttribute("aria-disabled")).toBe(
			"true",
		);
		await select("Copy path");
		expect(writeText).toHaveBeenCalledExactlyOnceWith("references/guide.md");
		expect(container.textContent).toContain("Path copied.");
		await render(
			<FileBrowserContent path="references/guide.md" showActions={false} />,
		);
		expect(container.querySelector('[aria-label="File actions"]')).toBeNull();
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it("passes an opaque action path unchanged to host actions", async () => {
		const path = "\\\\server\\shared folder\\SKILL.md";
		const open = vi.fn().mockResolvedValue(undefined);
		const copy = vi.fn().mockResolvedValue(undefined);
		await render(
			<FileBrowserContent
				path="SKILL.md"
				actionPath={path}
				onOpenFileLocation={open}
				onCopyPath={copy}
			/>,
		);
		const trigger = await openMenu();
		await act(async () =>
			item("Open file location").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		);
		expect(document.querySelector('[role="menu"]')).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
		await openMenu();
		await select("Open file location");
		expect(open).toHaveBeenCalledExactlyOnceWith(path);
		await openMenu();
		await select("Copy path");
		expect(copy).toHaveBeenCalledExactlyOnceWith(path);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("reports failures and lets the user retry", async () => {
		writeText.mockRejectedValueOnce(new Error("Permission denied"));
		await render(<FileBrowserContent path="SKILL.md" />);
		await openMenu();
		await select("Copy path");
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not copy path.",
		);
		await openMenu();
		await select("Copy path");
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(container.textContent).toContain("Path copied.");
	});

	it("prevents duplicate pending actions and ignores results for an old file", async () => {
		let reject: (error: Error) => void = () => {};
		const open = vi.fn(
			() =>
				new Promise<void>((_, fail) => {
					reject = fail;
				}),
		);
		await render(
			<FileBrowserContent path="old.md" onOpenFileLocation={open} />,
		);
		await openMenu();
		await select("Open file location");
		await openMenu();
		expect(item("Open file location").getAttribute("aria-disabled")).toBe(
			"true",
		);
		expect(item("Copy path").getAttribute("aria-disabled")).toBe("true");
		await select("Open file location");
		expect(open).toHaveBeenCalledOnce();
		await render(
			<FileBrowserContent path="new.md" onOpenFileLocation={open} />,
		);
		await act(async () => reject(new Error("Old request failed")));
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(container.textContent).not.toContain("Path copied.");
	});
});
