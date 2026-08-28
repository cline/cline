// @vitest-environment jsdom

import type { AgendaTaskRecord } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { WelcomeScreen } from "./welcome-chat";

const listAgendaTasksMock = vi.hoisted(() => vi.fn());
const approveAgendaTaskMock = vi.hoisted(() => vi.fn());
const runAgendaTaskMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		listAgendaTasks: listAgendaTasksMock,
		approveAgendaTask: approveAgendaTaskMock,
		cancelAgendaTask: vi.fn(),
		runAgendaTask: runAgendaTaskMock,
		subscribe: vi.fn(() => () => undefined),
		subscribeTransportState: vi.fn(() => () => undefined),
	},
}));
// The Agenda UI ships hidden for now; these tests force the flag on so they
// keep guarding the dormant feature. agenda-ui-hidden.test.tsx covers the
// shipped (hidden) state.
vi.mock("@/lib/feature-flags", () => ({ AGENDA_UI_ENABLED: true }));

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
					onOpenSession={onOpenSession}
					onSwitchGitBranch={vi.fn(async () => true)}
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
