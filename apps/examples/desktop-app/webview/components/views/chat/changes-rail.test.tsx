// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionFileDiff } from "@/lib/session-diff";
import type { WorkspaceChangesResult } from "@/lib/workspace-changes";
import { ChangesRail } from "./changes-rail";

const { invokeMock, results } = vi.hoisted(() => {
	const results = new Map<string, unknown>();
	return {
		results,
		invokeMock: vi.fn(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "list_available_editors") return [];
				if (command === "get_workspace_changes") {
					return results.get(String(args?.scope));
				}
				if (command === "revert_workspace_change") {
					return { path: args?.path, action: "restored" };
				}
				if (command === "list_workspace_directory") {
					return args?.path === ""
						? {
								path: "",
								entries: [
									{ name: "src", path: "src", kind: "directory" },
									{ name: "README.md", path: "README.md", kind: "file" },
								],
							}
						: {
								path: "src",
								entries: [{ name: "a.ts", path: "src/a.ts", kind: "file" }],
							};
				}
				if (command === "read_workspace_file") {
					return { path: args?.path, text: "# Hello\n", size: 8 };
				}
				throw new Error(`unexpected command ${command}`);
			},
		),
	};
});

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

// @pierre/diffs adopts constructable stylesheets and observes resizes, which
// jsdom lacks.
CSSStyleSheet.prototype.replaceSync ??= function replaceSync() {} as never;
globalThis.ResizeObserver ??= class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
} as never;

const sessionResult: WorkspaceChangesResult = {
	scope: "session",
	base: { label: "start of session", runCount: 1 },
	files: [
		{
			path: "src/a.ts",
			status: "modified",
			oldText: "const a = 1;\n",
			newText: "const a = 2;\nconst b = 3;\n",
		},
		{ path: "docs/new.md", status: "added", oldText: "", newText: "# New\n" },
	],
};

const fallbackDiffs: SessionFileDiff[] = [
	{
		path: "notes.txt",
		additions: 1,
		deletions: 0,
		hunks: [{ oldStart: 1, newStart: 1, old: "", new: "hello" }],
	},
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.releasePointerCapture ??= () => {};
	Element.prototype.scrollIntoView ??= () => {};
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	results.clear();
	results.set("session", sessionResult);
	results.set("turn", {
		scope: "turn",
		files: [],
		unavailableReason: "No checkpoint has been recorded for this session yet.",
	});
	results.set("uncommitted", {
		scope: "uncommitted",
		files: [],
		base: { label: "HEAD" },
	});
	invokeMock.mockClear();
	vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function renderRail(
	overrides: Partial<Parameters<typeof ChangesRail>[0]> = {},
) {
	await act(async () =>
		root.render(
			<ChangesRail
				cwd="/repo"
				environmentId="local"
				fallbackFileDiffs={fallbackDiffs}
				onClose={() => {}}
				refreshKey="idle:0:0:0"
				sessionId="session-1"
				{...overrides}
			/>,
		),
	);
	// The rail debounces fetches; let the timer fire and the promise settle.
	await act(async () => {
		await vi.advanceTimersByTimeAsync(300);
	});
}

function tab(label: string): HTMLButtonElement {
	const match = [
		...container.querySelectorAll<HTMLButtonElement>("[role=tab]"),
	].find((button) => button.textContent?.startsWith(label));
	expect(match, `tab ${label}`).toBeDefined();
	return match as HTMLButtonElement;
}

describe("ChangesRail", () => {
	it("loads the session scope, lists files by directory, and selects the first", async () => {
		await renderRail();
		expect(invokeMock).toHaveBeenCalledWith("get_workspace_changes", {
			environmentId: "local",
			cwd: "/repo",
			scope: "session",
			sessionId: "session-1",
		});
		expect(container.querySelector('[title="docs/new.md"]')).not.toBeNull();
		expect(container.querySelector('[title="src/a.ts"]')).not.toBeNull();
		// Counts come from the real diff, not the sidecar.
		expect(container.textContent).toContain("+3");
		expect(container.textContent).toContain("-1");
		// The first file the sidecar reports is selected by default.
		expect(
			container.querySelector('[aria-current="true"]')?.getAttribute("title"),
		).toBe("src/a.ts");
		expect(container.querySelector("diffs-container")).not.toBeNull();
	});

	it("falls back to tool-event diffs when a checkpoint scope is unavailable", async () => {
		await renderRail();
		await act(async () => tab("Last turn").click());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(300);
		});
		expect(container.textContent).toContain("No checkpoint has been recorded");
		expect(container.textContent).toContain(
			"reconstructed from this session's tool calls",
		);
		expect(container.querySelector('[title="notes.txt"]')).not.toBeNull();
		// Reconstructed edits have no git base to revert to.
		expect(
			container.querySelector('[aria-label="Revert notes.txt"]'),
		).toBeNull();
	});

	it("reverts a file after confirmation and refetches", async () => {
		await renderRail();
		await act(async () =>
			container.querySelector<HTMLButtonElement>('[title="src/a.ts"]')?.click(),
		);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[aria-label="Revert src/a.ts"]')
				?.click(),
		);
		const confirm = [
			...document.querySelectorAll<HTMLButtonElement>("button"),
		].find((button) => button.textContent === "Revert");
		expect(confirm).toBeDefined();
		await act(async () => confirm?.click());
		expect(invokeMock).toHaveBeenCalledWith("revert_workspace_change", {
			environmentId: "local",
			cwd: "/repo",
			scope: "session",
			path: "src/a.ts",
			sessionId: "session-1",
		});
		const fetches = invokeMock.mock.calls.filter(
			([command]) => command === "get_workspace_changes",
		);
		expect(fetches.length).toBeGreaterThanOrEqual(2);
	});

	it("browses workspace files lazily and previews one", async () => {
		await renderRail();
		await act(async () => tab("Files").click());
		expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory", {
			environmentId: "local",
			cwd: "/repo",
			path: "",
		});
		expect(container.querySelector('[title="src"]')).not.toBeNull();
		await act(async () =>
			container.querySelector<HTMLButtonElement>('[title="src"]')?.click(),
		);
		expect(container.querySelector('[title="src/a.ts"]')).not.toBeNull();
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[title="README.md"]')
				?.click(),
		);
		expect(invokeMock).toHaveBeenCalledWith("read_workspace_file", {
			environmentId: "local",
			cwd: "/repo",
			path: "README.md",
		});
		expect(
			container.querySelector(".cline-ui-file-panel-header")?.textContent,
		).toContain("README.md");
	});
});
