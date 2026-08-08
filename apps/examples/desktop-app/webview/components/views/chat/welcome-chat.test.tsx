// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { WelcomeScreen } from "./welcome-chat";

const { invokeMock, subscribeMock, accountRef } = vi.hoisted(() => ({
	invokeMock: vi.fn(
		async (_command: string, _args?: unknown) => ({}) as unknown,
	),
	subscribeMock: vi.fn(
		(_eventName: string, _handler: (payload: unknown) => void) => () =>
			undefined,
	),
	accountRef: { user: null as { id: string } | null },
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: invokeMock,
		subscribe: subscribeMock,
	},
	openExternalUrl: vi.fn(async () => undefined),
}));

vi.mock("@/contexts/account-context", () => ({
	useAccount: () => ({
		user: accountRef.user,
		refreshAccount: vi.fn(async () => undefined),
	}),
}));

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
	onStartChat = vi.fn(),
	selectChat = vi.fn(async () => true),
	onListGitBranches = vi.fn(async () => ({
		current: "main",
		branches: ["main"],
	})),
	...cloudProps
}: {
	workspaceRoot: string;
	workspaces: string[];
	onStartChat?: (prompt: string) => void;
	selectChat?: () => Promise<boolean>;
	onListGitBranches?: () => Promise<{
		current: string;
		branches: string[];
	}>;
} & Partial<ComponentProps<typeof WelcomeScreen>>): Promise<void> {
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
					onStartChat={onStartChat}
					onSwitchGitBranch={vi.fn(async () => true)}
					quickActions={[]}
					{...cloudProps}
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
	it("starts chat with the selected quick-action prompt", async () => {
		const onStartChat = vi.fn();
		await renderWelcomeScreen({
			onStartChat,
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
		});

		await clickButton("Check for build errors");

		expect(onStartChat).toHaveBeenCalledWith(
			"Check this project for build errors and help me fix any failures.",
		);
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

	it("keeps a repository picked from a freshly scoped list after an org switch", async () => {
		accountRef.user = { id: "user-1" };
		const repository = (owner: string) => ({
			id: 7,
			name: "repo",
			fullName: `${owner}/repo`,
			url: `https://github.com/${owner}/repo`,
			defaultBranch: "main",
		});
		// Mount-time check sees the old org; every later fetch (the picker's
		// included) sees the new org.
		let fetches = 0;
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_cloud_repositories") {
				fetches += 1;
				return {
					connected: true,
					connectUrl: "https://app.example/dashboard/integrations",
					repositories: [repository(fetches === 1 ? "oldorg" : "neworg")],
				};
			}
			return {};
		});
		const onRepoUrlChange = vi.fn();
		const onCloudBranchChange = vi.fn();
		const cloudProps = {
			cloudAgentsEnabled: true,
			executionTarget: "cloud" as const,
			onRepoUrlChange,
			onCloudBranchChange,
		};
		await renderWelcomeScreen({
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
			...cloudProps,
		});

		// Pick the new-org repository from the picker (whose fetch is scoped
		// to the new org).
		await clickButton("Select repository");
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		await clickButton("neworg/repo");
		expect(onRepoUrlChange).toHaveBeenLastCalledWith(
			"https://github.com/neworg/repo",
		);

		// The parent applies the selection; the stale-selection guard must
		// not wipe it against the old org's snapshot.
		onRepoUrlChange.mockClear();
		onCloudBranchChange.mockClear();
		await renderWelcomeScreen({
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
			...cloudProps,
			repoUrl: "https://github.com/neworg/repo",
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(onRepoUrlChange).not.toHaveBeenCalledWith("");
		expect(onCloudBranchChange).not.toHaveBeenCalledWith("");
		accountRef.user = null;
	});

	it("re-checks cloud setup when the sidecar broadcasts a scope change", async () => {
		accountRef.user = { id: "user-1" };
		let fetches = 0;
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_cloud_repositories") {
				fetches += 1;
				return {
					connected: true,
					connectUrl: "https://app.example/dashboard/integrations",
					repositories: [
						{
							id: 7,
							name: "repo",
							fullName: "org/repo",
							url: "https://github.com/org/repo",
							defaultBranch: "main",
						},
					],
				};
			}
			return {};
		});
		await renderWelcomeScreen({
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
			cloudAgentsEnabled: true,
			executionTarget: "cloud",
		});
		const scopeHandler = subscribeMock.mock.calls.find(
			([eventName]) => eventName === "cloud_sessions_changed",
		)?.[1] as ((payload: unknown) => void) | undefined;
		expect(scopeHandler).toBeDefined();

		const fetchesBefore = fetches;
		await act(async () => {
			scopeHandler?.({});
			await Promise.resolve();
		});

		expect(fetches).toBeGreaterThan(fetchesBefore);
		accountRef.user = null;
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
