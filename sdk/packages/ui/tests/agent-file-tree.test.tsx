// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AgentChangedFileEntry,
	AgentChangedFileTree,
	AgentFilePanelHeader,
	AgentWorkspaceTree,
} from "../components/agent-file-tree.js";
import { AgentSegmentedControl } from "../components/agent-segmented-control.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const files: AgentChangedFileEntry[] = [
	{ path: "src/b.ts", status: "modified", additions: 3, deletions: 1 },
	{ path: "src/a.ts", status: "added", additions: 10, deletions: 0 },
	{ path: "README.md", status: "deleted", additions: 0, deletions: 4 },
];

describe("AgentChangedFileTree", () => {
	it("groups files by directory, sorts them, and reports selection", async () => {
		const onSelect = vi.fn();
		await act(async () =>
			root.render(
				<AgentChangedFileTree
					files={files}
					onSelect={onSelect}
					selectedPath="src/b.ts"
				/>,
			),
		);
		const rows = [
			...container.querySelectorAll<HTMLButtonElement>(
				".cline-ui-file-tree__group button:not([aria-expanded])",
			),
		];
		expect(rows.map((row) => row.title)).toEqual([
			"README.md",
			"src/a.ts",
			"src/b.ts",
		]);
		expect(rows[2]?.getAttribute("aria-current")).toBe("true");
		expect(rows[1]?.textContent).toContain("A");
		expect(rows[1]?.textContent).toContain("+10");
		await act(async () => rows[0]?.click());
		expect(onSelect).toHaveBeenCalledWith(files[2]);
	});

	it("collapses a directory group", async () => {
		await act(async () =>
			root.render(<AgentChangedFileTree files={files} onSelect={() => {}} />),
		);
		const groupToggle = [
			...container.querySelectorAll<HTMLButtonElement>(
				".cline-ui-file-tree__group > button",
			),
		].find((button) => button.title === "src");
		expect(groupToggle).toBeDefined();
		await act(async () => groupToggle?.click());
		expect(container.querySelector('[title="src/a.ts"]')).toBeNull();
		expect(container.querySelector('[title="README.md"]')).not.toBeNull();
	});

	it("renders the empty message", async () => {
		await act(async () =>
			root.render(
				<AgentChangedFileTree
					emptyMessage="Nothing yet"
					files={[]}
					onSelect={() => {}}
				/>,
			),
		);
		expect(container.textContent).toBe("Nothing yet");
	});
});

describe("AgentWorkspaceTree", () => {
	it("expands directories lazily and selects files", async () => {
		const onToggle = vi.fn();
		const onSelectFile = vi.fn();
		const render = (
			expanded: Set<string>,
			loading: Set<string>,
			entries: Record<
				string,
				{ name: string; path: string; kind: "file" | "directory" }[]
			>,
		) =>
			act(async () =>
				root.render(
					<AgentWorkspaceTree
						entries={entries}
						expanded={expanded}
						loading={loading}
						onSelectFile={onSelectFile}
						onToggleDirectory={onToggle}
					/>,
				),
			);
		const rootEntries = {
			"": [
				{ name: "src", path: "src", kind: "directory" as const },
				{ name: "package.json", path: "package.json", kind: "file" as const },
			],
		};
		await render(new Set(), new Set(), rootEntries);
		await act(async () =>
			container.querySelector<HTMLButtonElement>('[title="src"]')?.click(),
		);
		expect(onToggle).toHaveBeenCalledWith("src");

		await render(new Set(["src"]), new Set(["src"]), rootEntries);
		expect(container.textContent).toContain("Loading…");

		await render(new Set(["src"]), new Set(), {
			...rootEntries,
			src: [{ name: "index.ts", path: "src/index.ts", kind: "file" }],
		});
		const file = container.querySelector<HTMLButtonElement>(
			'[title="src/index.ts"]',
		);
		expect(file).not.toBeNull();
		await act(async () => file?.click());
		expect(onSelectFile).toHaveBeenCalledWith({
			name: "index.ts",
			path: "src/index.ts",
			kind: "file",
		});
	});
});

describe("AgentFilePanelHeader", () => {
	it("shows status, path, counts, and host actions", async () => {
		await act(async () =>
			root.render(
				<AgentFilePanelHeader
					actions={<button type="button">Revert</button>}
					additions={2}
					deletions={1}
					path="src/a.ts"
					status="modified"
				/>,
			),
		);
		expect(container.textContent).toContain("M");
		expect(container.textContent).toContain("src/a.ts");
		expect(container.textContent).toContain("+2");
		expect(container.textContent).toContain("-1");
		expect(container.querySelector("button")?.textContent).toBe("Revert");
	});
});

describe("AgentSegmentedControl", () => {
	it("marks the selected tab and reports changes", async () => {
		const onValueChange = vi.fn();
		await act(async () =>
			root.render(
				<AgentSegmentedControl
					aria-label="Scope"
					onValueChange={onValueChange}
					options={[
						{ value: "turn", label: "Last turn" },
						{ value: "session", label: "Session", count: 4 },
					]}
					value="session"
				/>,
			),
		);
		const tabs = [
			...container.querySelectorAll<HTMLButtonElement>("[role=tab]"),
		];
		expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
			"false",
			"true",
		]);
		expect(tabs[1]?.textContent).toContain("4");
		await act(async () => tabs[1]?.click());
		expect(onValueChange).not.toHaveBeenCalled();
		await act(async () => tabs[0]?.click());
		expect(onValueChange).toHaveBeenCalledWith("turn");
	});
});
