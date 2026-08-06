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

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

function renderControls(overrides: { currentBranch: string }) {
	return act(async () => {
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
	});
}

describe("WelcomeWorkspaceControls", () => {
	it("hides the branch chip entirely for a plain (non-git) folder", async () => {
		await renderControls({ currentBranch: "no-git" });

		expect(container.textContent).toContain("recipes");
		// No git terminology may leak for non-developers: previously this
		// rendered a chip reading "No branch".
		expect(container.textContent).not.toContain("No branch");
		expect(container.textContent).not.toContain("no-git");
		const buttons = [...container.querySelectorAll("button")];
		expect(buttons).toHaveLength(1);
	});

	it("keeps the branch switcher chip for git repositories", async () => {
		await renderControls({ currentBranch: "main" });

		expect(container.textContent).toContain("recipes");
		expect(container.textContent).toContain("main");
		const buttons = [...container.querySelectorAll("button")];
		expect(buttons).toHaveLength(2);
	});

	it("offers Open folder wording instead of Add project", async () => {
		await renderControls({ currentBranch: "no-git" });

		const workspaceChip = container.querySelector("button");
		await click(workspaceChip as Element);
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Open folder...");
		});
		expect(container.textContent).not.toContain("Add project");
	});
});
