// @vitest-environment jsdom
import type { AgendaTaskRecord, AgendaTaskRunRecord } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryView } from "./factory-view";

const mocks = vi.hoisted(() => ({
	tasks: [] as AgendaTaskRecord[],
	refresh: vi.fn(async () => {}),
	startFactoryQueue: vi.fn(async () => ({ queued: 1 })),
	updateAgendaTask: vi.fn(),
	approveAgendaTask: vi.fn(),
	getFactoryTask: vi.fn(async () => ({ runs: [] as AgendaTaskRunRecord[] })),
	designFactoryTask: vi.fn(async () => ({ sessionId: "design-1" })),
}));
vi.mock("@/hooks/use-agenda-tasks", () => ({
	useAgendaTasks: () => ({
		tasks: mocks.tasks,
		refresh: mocks.refresh,
		isLoading: false,
	}),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: mocks,
	openExternalUrl: vi.fn(),
}));

function task(overrides: Partial<AgendaTaskRecord> = {}): AgendaTaskRecord {
	return {
		taskId: "feature-1",
		title: "Export activity",
		instructions: "Export the activity view as CSV.",
		type: "todo",
		scope: "workspace",
		workspaceRoot: "/repo",
		status: "approved",
		resourcePaths: [],
		priority: 2,
		availableAt: "2026-01-01T00:00:00Z",
		expiresAt: "2027-01-01T00:00:00Z",
		automationEligible: false,
		revision: 3,
		createdBy: { kind: "user" },
		updatedBy: { kind: "user" },
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		factory: {
			execution: "local",
			approval: "required",
			maxRepairRounds: 2,
			checks: [
				{ name: "API test", command: "bun test", kind: "api", artifacts: [] },
			],
			publishPullRequest: false,
		},
		...overrides,
	};
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
function button(label: string): HTMLButtonElement {
	const found = Array.from(document.querySelectorAll("button")).find((item) =>
		item.textContent?.includes(label),
	);
	if (!found) throw new Error(`Missing button ${label}`);
	return found;
}

describe("Factory workflow", () => {
	it("labels evidence from an older brief without claiming the edited feature is ready", async () => {
		mocks.tasks = [task({ status: "pending_approval", revision: 4 })];
		mocks.getFactoryTask.mockResolvedValueOnce({
			runs: [
				{
					runId: "run-1",
					taskId: "feature-1",
					taskRevision: 3,
					status: "completed",
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:00:00Z",
					factory: {
						phase: "ready",
						repairRound: 0,
						sessions: [],
						checks: [],
						workspace: {
							path: "/feature",
							branch: "feat/feature",
							baseBranch: "main",
							baseCommit: "base",
						},
					},
				},
			],
		});
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Export activity").click());
		expect(document.body.textContent).toContain("revision 3 (previous brief)");
		expect(document.body.textContent).not.toContain(
			"Changes are ready for your review",
		);
	});
	it("starts only approved factory features and leaves ordinary Agenda tasks untouched", async () => {
		const approved = task();
		mocks.tasks = [
			approved,
			task({
				taskId: "design",
				title: "Needs design",
				status: "pending_approval",
			}),
			task({
				taskId: "ordinary",
				title: "Ordinary reminder",
				factory: undefined,
			}),
		];
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		expect(container.textContent).not.toContain("Ordinary reminder");
		await act(async () => button("Start queue").click());
		expect(mocks.startFactoryQueue).toHaveBeenCalledWith([approved]);
		expect(container.textContent).toContain("1 feature queued");
	});
	it("approves the saved revision, then opens the existing chat for the design interview", async () => {
		mocks.tasks = [task({ status: "pending_approval" })];
		mocks.updateAgendaTask.mockResolvedValue(task({ revision: 4 }));
		mocks.approveAgendaTask.mockResolvedValue(task({ revision: 5 }));
		const openSession = vi.fn(async () => {});
		await act(async () =>
			root.render(
				<FactoryView workspacePaths={[]} onOpenSession={openSession} />,
			),
		);
		await act(async () => button("Export activity").click());
		await act(async () => button("Approve for queue").click());
		expect(mocks.updateAgendaTask).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "feature-1",
				expectedRevision: 3,
				factory: expect.objectContaining({ publishPullRequest: false }),
			}),
		);
		expect(mocks.approveAgendaTask).toHaveBeenCalledWith({
			taskId: "feature-1",
			expectedRevision: 4,
			allWorkspaces: true,
		});
		await act(async () => button("Interview with agent").click());
		expect(openSession).toHaveBeenCalledWith(
			"design-1",
			expect.stringContaining("Export the activity view as CSV."),
		);
	});
});
