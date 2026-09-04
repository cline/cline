// @vitest-environment jsdom

import type { AgendaTaskRecord } from "@cline/shared";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { WelcomeScreen } from "./welcome-chat";

const { invokeMock, subscribeMock, accountRef, openExternalUrlMock } =
	vi.hoisted(() => ({
		invokeMock: vi.fn(
			async (_command: string, _args?: unknown) => ({}) as unknown,
		),
		openExternalUrlMock: vi.fn(async () => undefined),
		subscribeMock: vi.fn(
			(_eventName: string, _handler: (payload: unknown) => void) => () =>
				undefined,
		),
		accountRef: {
			user: null as { id: string } | null,
			activeOrganization: null as { id: string } | null,
		},
	}));

const listAgendaTasksMock = vi.hoisted(() => vi.fn());
const approveAgendaTaskMock = vi.hoisted(() => vi.fn());
const runAgendaTaskMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: invokeMock,
		listAgendaTasks: listAgendaTasksMock,
		approveAgendaTask: approveAgendaTaskMock,
		cancelAgendaTask: vi.fn(),
		runAgendaTask: runAgendaTaskMock,
		subscribe: subscribeMock,
		subscribeTransportState: vi.fn(() => () => undefined),
	},
	openExternalUrl: openExternalUrlMock,
}));
// The Agenda UI ships hidden for now; these tests force the flag on so they
// keep guarding the dormant feature. agenda-ui-hidden.test.tsx covers the
// shipped (hidden) state.
vi.mock("@/lib/feature-flags", () => ({ AGENDA_UI_ENABLED: true }));

vi.mock("@/contexts/account-context", () => ({
	useAccount: () => ({
		user: accountRef.user,
		activeOrganization: accountRef.activeOrganization,
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
	listAgendaTasksMock.mockReset();
	listAgendaTasksMock.mockResolvedValue([]);
	approveAgendaTaskMock.mockReset();
	runAgendaTaskMock.mockReset();
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
	onOpenSession = vi.fn(),
	...cloudProps
}: {
	workspaceRoot: string;
	workspaces: string[];
	gitBranch?: string | null;
	selectChat?: () => Promise<boolean>;
	onListGitBranches?: () => Promise<{
		current: string;
		branches: string[];
	}>;
	onOpenSession?: (sessionId: string) => void | Promise<void>;
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
					gitBranch={gitBranch}
					onListGitBranches={onListGitBranches}
					onOpenSession={onOpenSession}
					onSwitchGitBranch={vi.fn(async () => true)}
					{...cloudProps}
				/>
			</WorkspaceProvider>,
		);
		await Promise.resolve();
	});
}

async function clickButton(
	text: string,
	last = false,
	rootNode: ParentNode = container,
): Promise<void> {
	const buttons = [
		...rootNode.querySelectorAll<HTMLButtonElement>("button"),
	].filter((candidate) => candidate.textContent?.includes(text));
	const button = last ? buttons.at(-1) : buttons[0];
	expect(button).toBeDefined();
	await act(async () => {
		button?.click();
		await Promise.resolve();
	});
}

describe("WelcomeScreen", () => {
	it("opens the GitHub App install flow from cloud onboarding", async () => {
		accountRef.user = { id: "user-1" };
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_cloud_repositories") {
				return {
					connected: false,
					connectUrl: "https://app.example/dashboard/integrations",
					repositories: [],
				};
			}
			if (command === "cline_integrations") {
				return { url: "https://github.com/apps/cline/installations/new" };
			}
			return {};
		});

		await renderWelcomeScreen({
			cloudAgentsEnabled: true,
			executionTarget: "cloud",
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
		});
		await clickButton("Connect GitHub");

		expect(invokeMock).toHaveBeenCalledWith("cline_integrations", {
			operation: "githubInstallUrl",
		});
		expect(openExternalUrlMock).toHaveBeenCalledWith(
			"https://github.com/apps/cline/installations/new",
		);
		accountRef.user = null;
	});

	it("does not render static prompt suggestions", async () => {
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

	it("shows live workspace suggestions and approves them before starting", async () => {
		const task = agendaTask({ status: "pending_approval" });
		const approved = { ...task, status: "approved" as const, revision: 2 };
		const running = {
			...approved,
			status: "in_progress" as const,
			lastSessionId: "task-session-1",
		};
		const onOpenSession = vi.fn();
		listAgendaTasksMock.mockResolvedValue([task]);
		approveAgendaTaskMock.mockResolvedValue(approved);
		runAgendaTaskMock.mockResolvedValue({ task: running });

		await renderWelcomeScreen({
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
			onOpenSession,
		});
		expect(listAgendaTasksMock).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: "workspace",
				workspaceRoot: "/projects/project-1",
				types: ["suggestion", "reminder", "follow-up"],
			}),
		);
		await clickButton("Review PR checks");
		expect(approveAgendaTaskMock).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain(task.instructions);
		await clickButton("Approve and start", false, document);

		expect(approveAgendaTaskMock).toHaveBeenCalledWith({
			taskId: "task-1",
			expectedRevision: 1,
		});
		expect(runAgendaTaskMock).toHaveBeenCalledWith({
			taskId: "task-1",
			expectedRevision: 2,
		});
		expect(onOpenSession).toHaveBeenCalledWith("task-session-1");
	});

	it("shows workspace follow-up items", async () => {
		listAgendaTasksMock.mockResolvedValue([
			agendaTask({
				type: "follow-up",
				title: "Finish accessibility review",
				description: undefined,
			}),
		]);

		await renderWelcomeScreen({
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
		});

		expect(container.textContent).toContain("Finish accessibility review");
		expect(container.textContent).toContain("Follow-up · P1");
	});

	it("hides expired workspace suggestions", async () => {
		listAgendaTasksMock.mockResolvedValue([
			agendaTask({ expiresAt: "2020-01-01T00:00:00.000Z" }),
		]);

		await renderWelcomeScreen({
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
		});

		expect(container.textContent).not.toContain("Review PR checks");
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

		const heading = container.querySelector("h1");
		expect(heading?.textContent).toBe("What would you like to build?");
		expect(heading?.classList.contains("sr-only")).toBe(true);
		expect(container.querySelector("[data-welcome-hero]")).not.toBeNull();
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
		subscribeMock.mockClear();
		let fetches = 0;
		let resolveScopedRepositories:
			| ((value: { connected: true; repositories: [] }) => void)
			| undefined;
		const scopedRepositories = new Promise<{
			connected: true;
			repositories: [];
		}>((resolve) => {
			resolveScopedRepositories = resolve;
		});
		invokeMock.mockImplementation(async (command: string) => {
			if (command === "list_cloud_repositories") {
				fetches += 1;
				if (fetches > 1) return await scopedRepositories;
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
		const onRepoUrlChange = vi.fn();
		const onCloudBranchChange = vi.fn();
		await renderWelcomeScreen({
			workspaceRoot: "/projects/project-1",
			workspaces: ["/projects/project-1"],
			cloudAgentsEnabled: true,
			executionTarget: "cloud",
			repoUrl: "https://github.com/org/repo",
			onRepoUrlChange,
			onCloudBranchChange,
		});
		onRepoUrlChange.mockClear();
		onCloudBranchChange.mockClear();
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
		expect(onRepoUrlChange).toHaveBeenCalledWith("");
		expect(onCloudBranchChange).toHaveBeenCalledWith("");
		await act(async () => {
			resolveScopedRepositories?.({ connected: true, repositories: [] });
			await scopedRepositories;
		});
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

function agendaTask(
	overrides: Partial<AgendaTaskRecord> = {},
): AgendaTaskRecord {
	return {
		taskId: "task-1",
		type: "suggestion",
		status: "pending_approval",
		title: "Review PR checks",
		description: "Check whether CI is green.",
		instructions: "Review the pull request checks.",
		scope: "workspace",
		workspaceRoot: "/projects/project-1",
		resourcePaths: [],
		priority: 1,
		availableAt: "2026-08-13T00:00:00.000Z",
		expiresAt: "2099-08-20T00:00:00.000Z",
		automationEligible: true,
		revision: 1,
		createdBy: { kind: "agent" },
		updatedBy: { kind: "agent" },
		createdAt: "2026-08-13T00:00:00.000Z",
		updatedAt: "2026-08-13T00:00:00.000Z",
		...overrides,
	};
}
