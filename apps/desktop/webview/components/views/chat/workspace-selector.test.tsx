// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSelector } from "./workspace-selector";

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

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

function buttonWithText(text: string): HTMLButtonElement {
	const button = [
		...container.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(button).toBeDefined();
	return button as HTMLButtonElement;
}

describe("WorkspaceSelector", () => {
	it("shows the current workspace and follows branch changes while disabled", async () => {
		const onListGitBranches = vi.fn(async () => ({
			current: "main",
			branches: ["main", "feature/review"],
		}));
		const render = async (currentBranch: string) => {
			await act(async () => {
				root.render(
					<WorkspaceSelector
						currentBranch={currentBranch}
						disabled
						onListGitBranches={onListGitBranches}
						onPickWorkspaceDirectory={vi.fn(async () => null)}
						onRefreshWorkspaces={vi.fn(async () => undefined)}
						onSwitchGitBranch={vi.fn(async () => true)}
						onSwitchWorkspace={vi.fn(async () => true)}
						workspaceRoot="/workspace/one"
						workspaces={["/workspace/one"]}
					/>,
				);
			});
		};

		await render("main");
		const trigger =
			container.querySelector<HTMLButtonElement>("#git-branch-btn");
		expect(trigger?.disabled).toBe(true);
		expect(trigger?.textContent).toContain("one");
		expect(trigger?.textContent).toContain("main");
		const branchLabel = trigger?.querySelector("span:last-child");
		expect(branchLabel?.className).toContain("min-w-0");
		expect(branchLabel?.className).toContain("truncate");
		expect(branchLabel?.className).toContain("max-[560px]:sr-only");
		expect(branchLabel?.className).not.toContain("max-w-");
		expect(trigger?.className).toContain("max-[560px]:size-7");
		expect(trigger?.parentElement?.dataset.slot).toBe("tooltip-trigger");
		expect(trigger?.parentElement?.className).toContain(
			"[&>button]:pointer-events-none",
		);

		await click(trigger as Element);
		expect(onListGitBranches).not.toHaveBeenCalled();
		expect(container.querySelector('input[placeholder*="Search"]')).toBeNull();

		await render("feature/review");
		expect(trigger?.textContent).toContain("feature/review");
	});

	it("switches both workspace and branch choices from the opened menu", async () => {
		const onSwitchWorkspace = vi.fn(async () => true);
		const onSwitchGitBranch = vi.fn(async () => true);
		await act(async () => {
			root.render(
				<WorkspaceSelector
					currentBranch="main"
					onListGitBranches={vi.fn(async () => ({
						current: "main",
						branches: ["main", "feature/review"],
					}))}
					onPickWorkspaceDirectory={vi.fn(async () => null)}
					onRefreshWorkspaces={vi.fn(async () => undefined)}
					onSwitchGitBranch={onSwitchGitBranch}
					onSwitchWorkspace={onSwitchWorkspace}
					workspaceRoot="/workspace/one"
					workspaces={["/workspace/one", "/workspace/two"]}
				/>,
			);
		});

		await click(container.querySelector("#git-branch-btn") as Element);
		await vi.waitFor(() => {
			expect(container.textContent).toContain("/workspace/two");
			expect(container.textContent).toContain("feature/review");
		});
		await click(buttonWithText("/workspace/two"));
		await vi.waitFor(() => {
			expect(onSwitchWorkspace).toHaveBeenCalledWith("/workspace/two");
		});

		await click(container.querySelector("#git-branch-btn") as Element);
		await vi.waitFor(() => {
			expect(container.textContent).toContain("feature/review");
		});
		await click(buttonWithText("feature/review"));
		await vi.waitFor(() => {
			expect(onSwitchGitBranch).toHaveBeenCalledWith("feature/review");
		});
	});

	it("lists the active workspace even when the catalog excludes it", async () => {
		await act(async () => {
			root.render(
				<WorkspaceSelector
					currentBranch="main"
					onListGitBranches={vi.fn(async () => ({
						current: "main",
						branches: ["main"],
					}))}
					onPickWorkspaceDirectory={vi.fn(async () => null)}
					onRefreshWorkspaces={vi.fn(async () => undefined)}
					onSwitchGitBranch={vi.fn(async () => true)}
					onSwitchWorkspace={vi.fn(async () => true)}
					workspaceRoot="/Users/beatrix/Desktop"
					workspaces={["/workspace/one"]}
				/>,
			);
		});

		await click(container.querySelector("#git-branch-btn") as Element);
		await vi.waitFor(() => {
			expect(container.textContent).toContain("~/Desktop");
			expect(container.textContent).toContain("/workspace/one");
		});
	});

	it("hides git chrome for a plain folder and keeps folder language", async () => {
		await act(async () => {
			root.render(
				<WorkspaceSelector
					currentBranch="no-git"
					onListGitBranches={vi.fn(async () => ({
						current: "no-git",
						branches: [],
					}))}
					onPickWorkspaceDirectory={vi.fn(async () => null)}
					onRefreshWorkspaces={vi.fn(async () => undefined)}
					onSwitchGitBranch={vi.fn(async () => false)}
					onSwitchWorkspace={vi.fn(async () => true)}
					workspaceRoot="/home/beatrix/recipes"
					workspaces={["/home/beatrix/recipes"]}
				/>,
			);
		});

		const trigger =
			container.querySelector<HTMLButtonElement>("#git-branch-btn");
		expect(trigger?.textContent).toContain("recipes");
		// The "no-git" sentinel and the branch separator are developer jargon
		// that must never leak into the chip for a plain folder.
		expect(trigger?.textContent).not.toContain("no-git");
		expect(trigger?.textContent).not.toContain("/home");
		expect(trigger?.getAttribute("aria-label")).toBe("Folder recipes");

		await click(trigger as Element);
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Workspaces");
		});
		expect(container.textContent).not.toContain("Branches");
		expect(container.textContent).not.toContain(
			"Create and checkout new branch",
		);
		expect(container.textContent).not.toContain("No branches found");
		expect(container.textContent).toContain("Open folder...");
		expect(
			container.querySelector('input[placeholder="Search workspaces"]'),
		).not.toBeNull();
	});

	it("keeps the branch switcher for git repositories", async () => {
		await act(async () => {
			root.render(
				<WorkspaceSelector
					currentBranch="main"
					onListGitBranches={vi.fn(async () => ({
						current: "main",
						branches: ["main", "feature/review"],
					}))}
					onPickWorkspaceDirectory={vi.fn(async () => null)}
					onRefreshWorkspaces={vi.fn(async () => undefined)}
					onSwitchGitBranch={vi.fn(async () => true)}
					onSwitchWorkspace={vi.fn(async () => true)}
					workspaceRoot="/workspace/one"
					workspaces={["/workspace/one"]}
				/>,
			);
		});

		const trigger =
			container.querySelector<HTMLButtonElement>("#git-branch-btn");
		expect(trigger?.textContent).toContain("one");
		expect(trigger?.textContent).toContain("main");

		await click(trigger as Element);
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Branches");
		});
		expect(container.textContent).toContain("feature/review");
		expect(container.textContent).toContain("Create and checkout new branch");
	});

	it("labels the SDK chat workspace as Chat without listing the raw path", async () => {
		const temporaryWorkspace = "/home/host/.cline/data/workspaces/chat";
		await act(async () => {
			root.render(
				<WorkspaceSelector
					currentBranch="no-git"
					onListGitBranches={vi.fn(async () => ({
						current: "no-git",
						branches: [],
					}))}
					onPickWorkspaceDirectory={vi.fn(async () => null)}
					onRefreshWorkspaces={vi.fn(async () => undefined)}
					onSwitchGitBranch={vi.fn(async () => false)}
					onSwitchWorkspace={vi.fn(async () => true)}
					workspaceRoot={temporaryWorkspace}
					workspaces={["/workspace/one"]}
				/>,
			);
		});

		expect(container.textContent).toContain("Chat");
		await click(container.querySelector("#git-branch-btn") as Element);
		await vi.waitFor(() => {
			expect(container.textContent).toContain("/workspace/one");
		});
		expect(container.textContent).not.toContain(temporaryWorkspace);
	});
});
