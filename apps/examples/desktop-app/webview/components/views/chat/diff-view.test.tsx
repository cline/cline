// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionFileDiff } from "@/lib/session-diff";
import { DiffView } from "./diff-view";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(async (command: string) =>
		command === "list_available_editors"
			? [{ id: "vscode", label: "VS Code" }]
			: { path: "/repo/docs/a.mdx", editor: "VS Code" },
	),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	// jsdom lacks the layout/pointer APIs the Radix dropdown menu touches.
	if (!("ResizeObserver" in globalThis)) {
		Object.assign(globalThis, {
			ResizeObserver: class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		});
	}
	Element.prototype.scrollIntoView ??= () => {};
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.releasePointerCapture ??= () => {};
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	invokeMock.mockClear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

// Radix dropdown triggers open on pointerdown, not click.
async function pointerDown(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
		await Promise.resolve();
	});
}

function buttonWithLabel(label: string): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`,
	);
	expect(button).not.toBeNull();
	return button as HTMLButtonElement;
}

// Menu items render in a portal attached to document.body.
function menuItems(): HTMLElement[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	);
}

const FILE_DIFF: SessionFileDiff = {
	path: "docs/a.mdx",
	additions: 2,
	deletions: 1,
	hunks: [],
};

describe("DiffView file actions", () => {
	it("copies the cwd-resolved absolute file path", async () => {
		await act(async () => {
			root.render(
				<DiffView
					cwd="/Users/renee/cline"
					fileDiffs={[FILE_DIFF]}
					onClose={vi.fn()}
				/>,
			);
		});

		await click(buttonWithLabel("Copy file path for docs/a.mdx"));

		expect(writeText).toHaveBeenCalledWith("/Users/renee/cline/docs/a.mdx");
	});

	it("opens the file in a chosen editor through the desktop backend", async () => {
		await act(async () => {
			root.render(
				<DiffView
					cwd="/Users/renee/cline"
					fileDiffs={[FILE_DIFF]}
					onClose={vi.fn()}
				/>,
			);
		});

		await pointerDown(buttonWithLabel("Open docs/a.mdx in editor"));

		const labels = menuItems().map((item) => item.textContent);
		expect(labels).toEqual(["Open in VS Code", "Open with system default"]);

		const vscodeItem = menuItems().find(
			(item) => item.textContent === "Open in VS Code",
		);
		await click(vscodeItem as Element);

		expect(invokeMock).toHaveBeenCalledWith("open_file_in_editor", {
			path: "docs/a.mdx",
			cwd: "/Users/renee/cline",
			editor: "vscode",
		});
	});

	it("still offers the system default opener when editor detection fails", async () => {
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_available_editors") {
				throw new Error("unsupported desktop command");
			}
			return { path: "/repo/docs/a.mdx", editor: "system default" };
		});

		await act(async () => {
			root.render(<DiffView fileDiffs={[FILE_DIFF]} onClose={vi.fn()} />);
		});

		await pointerDown(buttonWithLabel("Open docs/a.mdx in editor"));

		const labels = menuItems().map((item) => item.textContent);
		expect(labels).toEqual(["Open with system default"]);

		await click(menuItems()[0] as Element);

		expect(invokeMock).toHaveBeenCalledWith("open_file_in_editor", {
			path: "docs/a.mdx",
			editor: "default",
		});
	});

	it("copies the path as-is when no cwd is available", async () => {
		await act(async () => {
			root.render(<DiffView fileDiffs={[FILE_DIFF]} onClose={vi.fn()} />);
		});

		await click(buttonWithLabel("Copy file path for docs/a.mdx"));

		expect(writeText).toHaveBeenCalledWith("docs/a.mdx");
	});
});
