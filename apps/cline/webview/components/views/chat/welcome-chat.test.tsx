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
	gitBranch = "main",
	selectChat = vi.fn(async () => true),
	onListGitBranches = vi.fn(async () => ({
		current: "main",
		branches: ["main"],
	})),
}: {
	workspaceRoot: string;
	workspaces: string[];
	gitBranch?: string | null;
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
					gitBranch={gitBranch}
					onListGitBranches={onListGitBranches}
					onSwitchGitBranch={vi.fn(async () => true)}
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
	// Prompt suggestions (quick-action cards, including "Review changes") are
	// temporarily disabled while we improve them; see welcome-chat.tsx.
	// Re-enable these tests when the suggestions come back.
	//
	// it("starts chat with the selected quick-action prompt", async () => {
	// 	const onStartChat = vi.fn();
	// 	await renderWelcomeScreen({
	// 		onStartChat,
	// 		workspaceRoot: "/projects/project-1",
	// 		workspaces: ["/projects/project-1"],
	// 	});
	//
	// 	await clickButton("Check for build errors");
	//
	// 	expect(onStartChat).toHaveBeenCalledWith(
	// 		"Check this project for build errors and help me fix any failures.",
	// 	);
	// });
	//
	// it("shows code-centric suggestions only inside a git repository", async () => {
	// 	await renderWelcomeScreen({
	// 		gitBranch: "main",
	// 		workspaceRoot: "/projects/project-1",
	// 		workspaces: ["/projects/project-1"],
	// 	});
	//
	// 	expect(container.textContent).toContain("Review changes");
	// 	expect(container.textContent).toContain("Check for build errors");
	// 	expect(container.textContent).not.toContain("Summarize this folder");
	// });
	//
	// it("offers general-purpose suggestions for a plain (non-git) folder", async () => {
	// 	const onStartChat = vi.fn();
	// 	await renderWelcomeScreen({
	// 		gitBranch: "no-git",
	// 		onStartChat,
	// 		workspaceRoot: "/home/beatrix/recipes",
	// 		workspaces: ["/home/beatrix/recipes"],
	// 	});
	//
	// 	// No developer vocabulary for a documents folder.
	// 	expect(container.textContent).not.toContain("Review changes");
	// 	expect(container.textContent).not.toContain("build errors");
	// 	expect(container.textContent).toContain("Summarize this folder");
	// 	expect(container.textContent).toContain("Organize these files");
	// 	expect(container.textContent).toContain("Draft a document");
	//
	// 	await clickButton("Summarize this folder");
	// 	expect(onStartChat).toHaveBeenCalledWith(
	// 		"Look through the files in this folder and give me a plain-language summary of what's here.",
	// 	);
	// });
	//
	// it("shows no suggestions for a folder while branch discovery is pending", async () => {
	// 	// Initial load and workspace switches report null until the folder is
	// 	// classified; guessing a card set here would misclassify git repos.
	// 	await renderWelcomeScreen({
	// 		gitBranch: null,
	// 		workspaceRoot: "/projects/project-1",
	// 		workspaces: ["/projects/project-1"],
	// 	});
	//
	// 	expect(container.textContent).not.toContain("Review changes");
	// 	expect(container.textContent).not.toContain("Check for build errors");
	// 	expect(container.textContent).not.toContain("Summarize this folder");
	// 	expect(container.textContent).not.toContain("Draft a document");
	// });
	//
	// it("resolves pending branch discovery to the matching card set", async () => {
	// 	await renderWelcomeScreen({
	// 		gitBranch: null,
	// 		workspaceRoot: "/projects/project-1",
	// 		workspaces: ["/projects/project-1"],
	// 	});
	// 	await renderWelcomeScreen({
	// 		gitBranch: "main",
	// 		workspaceRoot: "/projects/project-1",
	// 		workspaces: ["/projects/project-1"],
	// 	});
	//
	// 	expect(container.textContent).toContain("Review changes");
	// 	expect(container.textContent).toContain("Check for build errors");
	// 	expect(container.textContent).not.toContain("Summarize this folder");
	// });
	//
	// it("offers folderless suggestions even while branch state is pending", async () => {
	// 	// Switching to "Just chat" resets branch discovery to pending; the
	// 	// chat cards never depend on git state, so they show immediately.
	// 	await renderWelcomeScreen({
	// 		gitBranch: null,
	// 		workspaceRoot: "",
	// 		workspaces: [],
	// 	});
	//
	// 	expect(container.textContent).toContain("Draft a document");
	// 	expect(container.textContent).toContain("Research a topic");
	// 	expect(container.textContent).toContain("Plan something");
	// });
	//
	// it("offers folderless suggestions when no workspace is selected", async () => {
	// 	await renderWelcomeScreen({
	// 		gitBranch: "no-git",
	// 		workspaceRoot: "",
	// 		workspaces: [],
	// 	});
	//
	// 	expect(container.textContent).not.toContain("Review changes");
	// 	expect(container.textContent).not.toContain("Summarize this folder");
	// 	expect(container.textContent).toContain("Draft a document");
	// 	expect(container.textContent).toContain("Research a topic");
	// 	expect(container.textContent).toContain("Plan something");
	// });

	it("does not render prompt suggestions while they are disabled", async () => {
		await renderWelcomeScreen({
			gitBranch: "main",
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
		});

		expect(container.textContent).not.toContain("Review changes");
		expect(container.textContent).not.toContain("Check for build errors");
		expect(container.textContent).not.toContain("Summarize this folder");
		expect(container.textContent).not.toContain("Draft a document");
	});

	it("renders every known project in the opened workspace menu", async () => {
		const workspaces = Array.from(
			{ length: 6 },
			(_, index) => `/projects/project-${index + 1}`,
		);
		await renderWelcomeScreen({
			workspaceRoot: workspaces[0] ?? "",
			workspaces,
		});

		expect(
			container.querySelectorAll(".cline-ui-agent-aurora__star"),
		).toHaveLength(32);
		expect(
			container.querySelector(".cline-ui-agent-hero-heading"),
		).not.toBeNull();
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
