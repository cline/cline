// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionFileDiff } from "@/lib/session-diff";
import { ProjectFilesPanel } from "./project-files-panel";

const { invokeMock, sourceControlState } = vi.hoisted(() => {
	const sourceControlState = {
		environmentId: "local",
		root: "/repo",
		branch: "main",
		hasUpstream: true,
		ahead: 1,
		behind: 0,
		staged: [{ path: "src/app.ts", status: "M", additions: 3, deletions: 1 }],
		unstaged: [{ path: "README.md", status: "M", additions: 1, deletions: 0 }],
		untracked: [{ path: "notes.txt", status: "?", additions: 2, deletions: 0 }],
		commits: [
			{
				sha: "a",
				shortSha: "aaaaaaa",
				subject: "Latest work",
				relativeDate: "2 minutes ago",
				pushed: false,
			},
			{
				sha: "b",
				shortSha: "bbbbbbb",
				subject: "Earlier work",
				relativeDate: "1 day ago",
				pushed: true,
			},
		],
	};
	const invokeMock = vi.fn(
		async (command: string, args?: Record<string, unknown>) => {
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
				case "get_source_control_state":
					// A fresh object per call, as the transport would deliver.
					return { ...sourceControlState };
				case "get_git_file_diff":
					return {
						oldText: `old ${args?.path}`,
						newText: `new ${args?.path}`,
						binary: false,
					};
				case "run_source_control_action":
					return { environmentId: "local" };
				default:
					return null;
			}
		},
	);
	return { invokeMock, sourceControlState };
});

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
	ToolFileDiff: ({
		path,
		oldText,
		newText,
	}: {
		path: string;
		oldText?: string;
		newText: string;
	}) => (
		<div data-testid="file-diff">
			{path}|{oldText ?? ""}|{newText}
		</div>
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

function button(
	name: RegExp,
	scope: ParentNode = container,
): HTMLButtonElement {
	const match = Array.from(scope.querySelectorAll("button")).find((el) =>
		name.test(el.textContent ?? ""),
	);
	if (!match) throw new Error(`No button matching ${name}`);
	return match;
}

function byLabel(label: string, scope: ParentNode = document): HTMLElement {
	const match = scope.querySelector<HTMLElement>(`[aria-label="${label}"]`);
	if (!match) throw new Error(`No element labelled ${label}`);
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

function actionCalls() {
	return invokeMock.mock.calls
		.filter(([command]) => command === "run_source_control_action")
		.map(([, args]) => (args as { action: unknown }).action);
}

describe("ProjectFilesPanel source control view", () => {
	it("opens on Source Control with staged, unstaged, untracked, and commits", async () => {
		await render();
		const column = container.querySelector("#source-control-column");
		expect(column).not.toBeNull();
		const text = column?.textContent ?? "";
		expect(text).toContain("Staged changes");
		expect(text).toContain("app.ts");
		expect(text).toContain("README.md");
		expect(text).toContain("notes.txt");
		expect(text).toContain("Latest work");
		// One commit ahead: Push is enabled with a count, Pull is available.
		const push = byLabel("Push", container) as HTMLButtonElement;
		expect(push.disabled).toBe(false);
		expect(push.textContent).toContain("1");
		expect((byLabel("Pull", container) as HTMLButtonElement).disabled).toBe(
			false,
		);
		await click(byLabel("Pull", container));
		expect(actionCalls()).toContainEqual({ type: "pull" });
		expect(container.textContent).toContain("main");
		// Session-touched rows carry the marker.
		expect(
			column?.querySelector('[title="Changed in this session"]'),
		).not.toBeNull();
	});

	it("opens a staged change as a staged diff and a worktree change as a worktree diff", async () => {
		await render();
		await click(button(/^app\.ts/));
		expect(invokeMock).toHaveBeenCalledWith(
			"get_git_file_diff",
			expect.objectContaining({ path: "src/app.ts", staged: true }),
		);
		expect(
			container.querySelector('[data-testid="file-diff"]')?.textContent,
		).toBe("/repo/src/app.ts|old src/app.ts|new src/app.ts");
		expect(container.textContent).toContain("staged");

		await click(button(/^README\.md/));
		expect(invokeMock).toHaveBeenCalledWith(
			"get_git_file_diff",
			expect.objectContaining({ path: "README.md", staged: false }),
		);
		// The File toggle still shows the working copy.
		await click(button(/^file$/i));
		expect(
			container.querySelector('[data-testid="file-contents"]')?.textContent,
		).toContain("/repo/README.md");
	});

	it("stages, unstages, and commits through the sidecar", async () => {
		await render();
		await click(byLabel("Stage README.md"));
		expect(actionCalls()).toContainEqual({
			type: "stage",
			paths: ["README.md"],
		});
		await click(byLabel("Unstage all"));
		expect(actionCalls()).toContainEqual({
			type: "unstage",
			paths: ["src/app.ts"],
		});

		const message = byLabel("Commit message") as HTMLTextAreaElement;
		const commit = button(/^Commit$/);
		expect(commit.disabled).toBe(true);
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			setter?.call(message, "feat: panel");
			message.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(button(/^Commit$/).disabled).toBe(false);
		await click(button(/^Commit$/));
		expect(actionCalls()).toContainEqual({
			type: "commit",
			message: "feat: panel",
			push: false,
		});
		expect((byLabel("Commit message") as HTMLTextAreaElement).value).toBe("");
	});

	it("keeps the commit message when the commit fails", async () => {
		await render();
		const message = byLabel("Commit message") as HTMLTextAreaElement;
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set?.call(message, "wip");
			message.dispatchEvent(new Event("input", { bubbles: true }));
		});
		invokeMock.mockImplementationOnce(async (command: string) => {
			if (command === "run_source_control_action") {
				throw new Error("pre-commit hook failed");
			}
			return null;
		});
		await click(button(/^Commit$/));
		expect((byLabel("Commit message") as HTMLTextAreaElement).value).toBe(
			"wip",
		);
	});

	it("publishes a branch that has no upstream and disables Pull", async () => {
		const previous = { ...sourceControlState };
		Object.assign(sourceControlState, { hasUpstream: false, ahead: 0 });
		try {
			await render();
			expect((byLabel("Pull", container) as HTMLButtonElement).disabled).toBe(
				true,
			);
			await click(byLabel("Publish branch", container));
			expect(actionCalls()).toContainEqual({ type: "push" });
		} finally {
			Object.assign(sourceControlState, previous);
		}
	});

	it("reloads expanded folders after a pull", async () => {
		await render();
		await click(button(/^Files$/));
		await click(button(/^src/));
		const listings = () =>
			invokeMock.mock.calls.filter(
				([command]) => command === "list_project_entries",
			).length;
		const before = listings();
		await click(button(/^Source Control$/));
		await click(byLabel("Pull", container));
		// Root and src were expanded, so both list again.
		expect(listings()).toBe(before + 2);
	});

	it("disables Push when nothing is ahead", async () => {
		const previous = { ...sourceControlState };
		Object.assign(sourceControlState, { ahead: 0 });
		try {
			await render();
			expect((byLabel("Push", container) as HTMLButtonElement).disabled).toBe(
				true,
			);
		} finally {
			Object.assign(sourceControlState, previous);
		}
	});

	it("restarts a diff read after closing the tab mid-flight", async () => {
		await render();
		invokeMock.mockImplementationOnce(() => new Promise(() => {}));
		await click(button(/^README\.md/));
		await click(byLabel("Close README.md", container));
		await click(button(/^README\.md/));
		const diffReads = invokeMock.mock.calls.filter(
			([command]) => command === "get_git_file_diff",
		);
		expect(diffReads).toHaveLength(2);
		expect(
			container.querySelector('[data-testid="file-diff"]')?.textContent,
		).toContain("README.md");
	});

	it("confirms before discarding and splits untracked paths", async () => {
		await render();
		await click(byLabel("Discard all changes"));
		expect(actionCalls()).toEqual([]);
		expect(document.body.textContent).toContain("Discard changes to 2 files?");
		await click(button(/^Discard$/, document.body));
		expect(actionCalls()).toContainEqual({
			type: "discard",
			paths: ["README.md"],
			untrackedPaths: ["notes.txt"],
		});
	});
});

describe("unstagePaths", () => {
	it("includes the original path of a staged rename", async () => {
		const { unstagePaths } = await import("@/hooks/use-source-control");
		expect(
			unstagePaths([
				{
					path: "new.ts",
					originalPath: "old.ts",
					status: "R",
					additions: 0,
					deletions: 0,
				},
				{ path: "a.ts", status: "M", additions: 1, deletions: 0 },
			]),
		).toEqual(["new.ts", "old.ts", "a.ts"]);
	});
});

describe("ProjectFilesPanel files view", () => {
	async function showFiles() {
		await click(button(/^Files$/));
	}

	it("lists the workspace root and expands folders on demand", async () => {
		await render();
		await showFiles();
		expect(container.textContent).toContain("README.md");
		expect(container.textContent).not.toContain("app.ts");
		await click(button(/^src/));
		expect(invokeMock).toHaveBeenCalledWith(
			"list_project_entries",
			expect.objectContaining({ path: "/repo/src" }),
		);
		expect(container.textContent).toContain("app.ts");
	});

	it("opens files in tabs and offers Diff for files git knows are dirty", async () => {
		await render();
		await showFiles();
		await click(button(/^README\.md/));
		expect(invokeMock).toHaveBeenCalledWith(
			"read_project_file",
			expect.objectContaining({ path: "/repo/README.md" }),
		);
		expect(
			container.querySelector('[data-testid="file-contents"]')?.textContent,
		).toContain("/repo/README.md");
		// README.md is modified in the worktree, so Diff is available.
		await click(button(/^diff$/i));
		expect(
			container.querySelector('[data-testid="file-diff"]')?.textContent,
		).toContain("/repo/README.md");

		await click(button(/^src/));
		await click(button(/^app\.ts/));
		expect(button(/^app\.ts/).textContent).toContain("M");
		expect(container.textContent).toContain("+3");

		// Two tabs are open; closing the active one falls back to its neighbour.
		await click(byLabel("Close app.ts", container));
		expect(container.textContent).toContain("README.md");
	});

	it("re-reads open files on refresh", async () => {
		await render();
		await showFiles();
		await click(button(/^README\.md/));
		const reads = () =>
			invokeMock.mock.calls.filter(
				([command]) => command === "read_project_file",
			).length;
		expect(reads()).toBe(1);
		await click(byLabel("Refresh", container));
		expect(reads()).toBe(2);
	});

	it("ignores a read that was in flight when its tab was closed", async () => {
		await render();
		await showFiles();
		let resolveStale: (value: unknown) => void = () => {};
		// The next invoke is the README read; hold it open past the close.
		invokeMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveStale = resolve;
				}),
		);
		await click(button(/^README\.md/));
		await click(byLabel("Close README.md", container));
		await act(async () => {
			resolveStale({ content: "stale contents", truncated: false });
			await Promise.resolve();
		});
		await click(button(/^README\.md/));
		expect(container.textContent).not.toContain("stale contents");
		expect(
			container.querySelector('[data-testid="file-contents"]')?.textContent,
		).toContain("/repo/README.md");
	});

	it("lets a slow read finish and re-reads once afterwards", async () => {
		vi.useFakeTimers();
		try {
			await render();
			await showFiles();
			let resolveSlow: (value: unknown) => void = () => {};
			invokeMock.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveSlow = resolve;
					}),
			);
			await click(button(/^README\.md/));
			const reads = () =>
				invokeMock.mock.calls.filter(
					([command]) => command === "read_project_file",
				).length;
			expect(reads()).toBe(1);
			// A poll lands while the read is still pending.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(10_000);
			});
			expect(reads()).toBe(1);
			await act(async () => {
				resolveSlow({ content: "slow contents", truncated: false });
				await Promise.resolve();
			});
			// The late response is kept, then one follow-up read refreshes it.
			expect(reads()).toBe(2);
			expect(
				container.querySelector('[data-testid="file-contents"]')?.textContent,
			).toContain("/repo/README.md");
		} finally {
			vi.useRealTimers();
		}
	});

	it("closes from its own header button", async () => {
		const onClose = vi.fn();
		await render(onClose);
		await click(byLabel("Hide project files", container));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
