// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeWorkspaceControls } from "./welcome-workspace-controls";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function renderControls({
	onSwitchWorkspace = vi.fn(async () => true),
	onPickWorkspaceDirectory = vi.fn(async (): Promise<string | null> => null),
}: {
	onSwitchWorkspace?: (workspacePath: string) => Promise<boolean>;
	onPickWorkspaceDirectory?: (initialPath?: string) => Promise<string | null>;
} = {}): Promise<void> {
	await act(async () => {
		root.render(
			<WelcomeWorkspaceControls
				currentBranch="main"
				onListGitBranches={vi.fn(async () => ({
					current: "main",
					branches: ["main"],
				}))}
				onPickWorkspaceDirectory={onPickWorkspaceDirectory}
				onRefreshWorkspaces={vi.fn(async () => undefined)}
				onSelectChat={vi.fn(async () => true)}
				onSwitchGitBranch={vi.fn(async () => true)}
				onSwitchWorkspace={onSwitchWorkspace}
				workspaceRoot="/projects/project-1"
				workspaces={["/projects/project-1"]}
			/>,
		);
		await Promise.resolve();
	});
}

async function clickButton(text: string): Promise<void> {
	const button = [
		...container.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(button).toBeDefined();
	await act(async () => {
		button?.click();
		await Promise.resolve();
	});
}

async function openWorkspaceMenu(): Promise<void> {
	await clickButton("project-1");
}

async function typeInSearch(value: string): Promise<void> {
	const input = container.querySelector<HTMLInputElement>("input");
	expect(input).toBeDefined();
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter?.call(input, value);
		input?.dispatchEvent(new Event("input", { bubbles: true }));
		await Promise.resolve();
	});
}

describe("WelcomeWorkspaceControls manual path entry", () => {
	it("offers to open a typed absolute path and switches to it", async () => {
		const onSwitchWorkspace = vi.fn(async () => true);
		await renderControls({ onSwitchWorkspace });
		await openWorkspaceMenu();
		await typeInSearch("/home/user/personal-stuff");

		await clickButton("Open folder \u201c/home/user/personal-stuff\u201d");

		expect(onSwitchWorkspace).toHaveBeenCalledWith("/home/user/personal-stuff");
	});

	it("shows a visible error when the typed path cannot be opened", async () => {
		const onSwitchWorkspace = vi.fn(async () => false);
		await renderControls({ onSwitchWorkspace });
		await openWorkspaceMenu();
		await typeInSearch("/does/not/exist");

		await clickButton("Open folder \u201c/does/not/exist\u201d");

		expect(container.textContent).toContain('Couldn\'t open "/does/not/exist"');
	});

	it("does not offer path entry for plain search text", async () => {
		await renderControls();
		await openWorkspaceMenu();
		await typeInSearch("project");

		const pathOption = [
			...container.querySelectorAll<HTMLButtonElement>("button"),
		].find((candidate) =>
			candidate.textContent?.includes("Open folder \u201c"),
		);
		expect(pathOption).toBeUndefined();
	});

	it("keeps typed path and errors when the workspace catalog refreshes mid-open", async () => {
		// The workspace catalog re-derives on a timer (session-history refresh),
		// handing the picker a new onRefreshWorkspaces identity. That must not
		// wipe the menu's typed path or a visible error while it is open.
		const onSwitchWorkspace = vi.fn(async () => false);
		const render = async () => {
			await act(async () => {
				root.render(
					<WelcomeWorkspaceControls
						currentBranch="main"
						onListGitBranches={vi.fn(async () => ({
							current: "main",
							branches: ["main"],
						}))}
						onPickWorkspaceDirectory={vi.fn(async () => null)}
						onRefreshWorkspaces={vi.fn(async () => undefined)}
						onSelectChat={vi.fn(async () => true)}
						onSwitchGitBranch={vi.fn(async () => true)}
						onSwitchWorkspace={onSwitchWorkspace}
						workspaceRoot="/projects/project-1"
						workspaces={["/projects/project-1"]}
					/>,
				);
				await Promise.resolve();
			});
		};
		await render();
		await openWorkspaceMenu();
		await typeInSearch("/does/not/exist");
		await clickButton("Open folder \u201c/does/not/exist\u201d");
		expect(container.textContent).toContain('Couldn\'t open "/does/not/exist"');

		// Re-render with fresh callback identities, as the page does when the
		// session history poll lands.
		await render();

		const input = container.querySelector<HTMLInputElement>("input");
		expect(input?.value).toBe("/does/not/exist");
		expect(container.textContent).toContain('Couldn\'t open "/does/not/exist"');
	});

	it("surfaces picker failures from Open folder instead of a silent no-op", async () => {
		const onPickWorkspaceDirectory = vi.fn(async () => {
			throw new Error(
				"No system folder picker found (zenity or kdialog). Type or paste a folder path in the workspace selector instead.",
			);
		});
		await renderControls({ onPickWorkspaceDirectory });
		await openWorkspaceMenu();

		await clickButton("Open folder...");

		expect(container.textContent).toContain("No system folder picker found");
	});
});

async function renderBranchChipControls(overrides: {
	currentBranch: string;
}): Promise<void> {
	await act(async () => {
		root.render(
			<WelcomeWorkspaceControls
				currentBranch={overrides.currentBranch}
				onListGitBranches={vi.fn(async () => ({
					current: overrides.currentBranch,
					branches:
						overrides.currentBranch === "no-git"
							? []
							: [overrides.currentBranch],
				}))}
				onPickWorkspaceDirectory={vi.fn(async () => null)}
				onRefreshWorkspaces={vi.fn(async () => undefined)}
				onSelectChat={vi.fn(async () => true)}
				onSwitchGitBranch={vi.fn(async () => true)}
				onSwitchWorkspace={vi.fn(async () => true)}
				workspaceRoot="/home/beatrix/recipes"
				workspaces={["/home/beatrix/recipes"]}
			/>,
		);
		await Promise.resolve();
	});
}

describe("WelcomeWorkspaceControls branch chip", () => {
	it("hides the branch chip entirely for a plain (non-git) folder", async () => {
		await renderBranchChipControls({ currentBranch: "no-git" });

		expect(container.textContent).toContain("recipes");
		// No git terminology may leak for non-developers: previously this
		// rendered a chip reading "No branch".
		expect(container.textContent).not.toContain("No branch");
		expect(container.textContent).not.toContain("no-git");
		const buttons = [...container.querySelectorAll("button")];
		expect(buttons).toHaveLength(1);
	});

	it("keeps the branch switcher chip for git repositories", async () => {
		await renderBranchChipControls({ currentBranch: "main" });

		expect(container.textContent).toContain("recipes");
		expect(container.textContent).toContain("main");
		const buttons = [...container.querySelectorAll("button")];
		expect(buttons).toHaveLength(2);
	});

	it("offers Open folder wording instead of Add project", async () => {
		await renderBranchChipControls({ currentBranch: "no-git" });

		await clickButton("recipes");
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Open folder...");
		});
		expect(container.textContent).not.toContain("Add project");
	});
});
