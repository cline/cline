// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionFileDiff } from "@/lib/session-diff";
import { ProjectFilesPanel } from "./project-files-panel";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(async (command: string, args?: Record<string, unknown>) => {
		switch (command) {
			case "list_project_entries":
				return args?.path === "/repo"
					? {
							entries: [
								{ name: "src", path: "/repo/src", kind: "directory" },
								{ name: "README.md", path: "/repo/README.md", kind: "file" },
							],
							truncated: false,
						}
					: {
							entries: [
								{ name: "app.ts", path: "/repo/src/app.ts", kind: "file" },
							],
							truncated: false,
						};
			case "read_project_file":
				return { content: `// ${args?.path}\n`, truncated: false };
			case "get_git_status":
				return { root: "/repo", entries: { "src/app.ts": "M" } };
			default:
				return null;
		}
	}),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

// The real renderers need shadow DOM + constructable stylesheets; stand-ins
// let the test assert which mode is showing.
vi.mock("@pierre/diffs/react", () => ({
	File: ({ file }: { file: { name: string; contents: string } }) => (
		<pre data-testid="file-contents">{file.contents}</pre>
	),
}));
vi.mock("@cline/ui/components/agent-chat/tool-diff", () => ({
	ToolFileDiff: ({ path }: { path: string }) => (
		<div data-testid="file-diff">{path}</div>
	),
}));

const fileDiffs: SessionFileDiff[] = [
	{
		path: "src/app.ts",
		additions: 3,
		deletions: 1,
		hunks: [{ oldStart: 1, newStart: 1, old: "a", new: "b" }],
	},
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	Element.prototype.setPointerCapture ??= () => {};
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invokeMock.mockClear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function render(onClose = vi.fn()) {
	await act(async () => {
		root.render(
			<ProjectFilesPanel
				cwd="/repo"
				environmentId="local"
				fileDiffs={fileDiffs}
				onClose={onClose}
				workspaceRoot="/repo"
			/>,
		);
	});
	await act(async () => {
		await Promise.resolve();
	});
}

function button(name: RegExp): HTMLButtonElement {
	const match = Array.from(container.querySelectorAll("button")).find((el) =>
		name.test(el.textContent ?? ""),
	);
	if (!match) throw new Error(`No button matching ${name}`);
	return match;
}

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

describe("ProjectFilesPanel", () => {
	it("lists the workspace root and expands folders on demand", async () => {
		await render();
		expect(container.textContent).toContain("README.md");
		expect(container.textContent).not.toContain("app.ts");
		await click(button(/^src/));
		expect(invokeMock).toHaveBeenCalledWith(
			"list_project_entries",
			expect.objectContaining({ path: "/repo/src" }),
		);
		expect(container.textContent).toContain("app.ts");
	});

	it("opens files in tabs and shows a File/Diff toggle only for session edits", async () => {
		await render();
		await click(button(/^README\.md/));
		expect(invokeMock).toHaveBeenCalledWith(
			"read_project_file",
			expect.objectContaining({ path: "/repo/README.md" }),
		);
		expect(
			container.querySelector('[data-testid="file-contents"]')?.textContent,
		).toContain("/repo/README.md");
		expect(container.textContent).not.toContain("Diff");

		await click(button(/^src/));
		await click(button(/^app\.ts/));
		// Git status letter and the session marker both decorate the row.
		expect(button(/^app\.ts/).textContent).toContain("M");
		expect(container.textContent).toContain("+3");
		await click(button(/^diff$/i));
		expect(
			container.querySelector('[data-testid="file-diff"]')?.textContent,
		).toBe("/repo/src/app.ts");

		// Two tabs are open; closing the active one falls back to its neighbour.
		expect(container.textContent).toContain("README.md");
		await click(
			container.querySelector('[aria-label="Close app.ts"]') as Element,
		);
		expect(
			container.querySelector('[data-testid="file-contents"]')?.textContent,
		).toContain("/repo/README.md");
	});

	it("re-reads open files on refresh", async () => {
		await render();
		await click(button(/^README\.md/));
		const reads = () =>
			invokeMock.mock.calls.filter(
				([command]) => command === "read_project_file",
			).length;
		expect(reads()).toBe(1);
		await click(
			container.querySelector('[aria-label="Refresh files"]') as Element,
		);
		expect(reads()).toBe(2);
	});

	it("closes from its own header button", async () => {
		const onClose = vi.fn();
		await render(onClose);
		await click(
			container.querySelector('[aria-label="Hide project files"]') as Element,
		);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
