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
});
