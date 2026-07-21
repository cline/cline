// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionFileDiff } from "@/lib/session-diff";
import { DiffView } from "./diff-view";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(async () => ({ path: "/repo/docs/a.mdx", editor: "code" })),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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

function buttonWithLabel(label: string): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`,
	);
	expect(button).not.toBeNull();
	return button as HTMLButtonElement;
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

	it("opens the file in an editor through the desktop backend", async () => {
		await act(async () => {
			root.render(
				<DiffView
					cwd="/Users/renee/cline"
					fileDiffs={[FILE_DIFF]}
					onClose={vi.fn()}
				/>,
			);
		});

		await click(buttonWithLabel("Open docs/a.mdx in editor"));

		expect(invokeMock).toHaveBeenCalledWith("open_file_in_editor", {
			path: "docs/a.mdx",
			cwd: "/Users/renee/cline",
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
