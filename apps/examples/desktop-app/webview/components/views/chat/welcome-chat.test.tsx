// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { WelcomeScreen } from "./welcome-chat";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.matchMedia = vi.fn().mockReturnValue({
		matches: true,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function renderWelcomeScreen({
	workspaceRoot,
	workspaces,
	selectChat = vi.fn(async () => true),
	onListGitBranches = vi.fn(async () => ({
		current: "main",
		branches: ["main"],
	})),
}: {
	workspaceRoot: string;
	workspaces: string[];
	selectChat?: () => Promise<boolean>;
	onListGitBranches?: () => Promise<{
		current: string;
		branches: string[];
	}>;
}): Promise<void> {
	await act(async () => {
		root.render(
			<WorkspaceProvider
				value={{
					workspaceRoot,
					workspaces,
					listWorkspaces: vi.fn(async () => workspaces),
					refreshWorkspaces: vi.fn(async () => undefined),
					switchWorkspace: vi.fn(async () => true),
					pickWorkspaceDirectory: vi.fn(async () => null),
					selectChat,
				}}
			>
				<WelcomeScreen
					active
					body={null}
					composer={null}
					gitBranch="main"
					onListGitBranches={onListGitBranches}
					onStartChat={vi.fn()}
					onSwitchGitBranch={vi.fn(async () => true)}
					quickActions={[]}
				/>
			</WorkspaceProvider>,
		);
		await Promise.resolve();
	});
}

async function clickButton(text: string, last = false): Promise<void> {
	const buttons = [
		...container.querySelectorAll<HTMLButtonElement>("button"),
	].filter((candidate) => candidate.textContent?.includes(text));
	const button = last ? buttons.at(-1) : buttons[0];
	expect(button).toBeDefined();
	await act(async () => {
		button?.click();
		await Promise.resolve();
	});
}

describe("WelcomeScreen", () => {
	it("renders every known project in the opened workspace menu", async () => {
		const workspaces = Array.from(
			{ length: 6 },
			(_, index) => `/projects/project-${index + 1}`,
		);
		await renderWelcomeScreen({
			workspaceRoot: workspaces[0] ?? "",
			workspaces,
		});

		await clickButton("project-1");

		for (let index = 1; index <= workspaces.length; index += 1) {
			expect(container.textContent).toContain(`project-${index}`);
		}
	});

	it("selects Just chat from the pathless workspace menu", async () => {
		const selectChat = vi.fn(async () => true);
		const onListGitBranches = vi.fn(async () => ({
			current: "main",
			branches: ["main"],
		}));
		await renderWelcomeScreen({
			workspaceRoot: "",
			workspaces: ["/projects/existing"],
			selectChat,
			onListGitBranches,
		});

		expect(container.querySelector('button[title="main"]')).toBeNull();
		expect(onListGitBranches).not.toHaveBeenCalled();
		await clickButton("Chat");
		expect(container.textContent).toContain("/projects/existing");
		await clickButton("Just chat", true);

		expect(selectChat).toHaveBeenCalledOnce();
	});
});
