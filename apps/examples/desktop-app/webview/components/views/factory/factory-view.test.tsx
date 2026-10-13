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
	invoke: vi.fn(
		async (_command: string, _args?: unknown): Promise<unknown> => [],
	),
	subscribe: vi.fn(() => () => {}),
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
	mocks.invoke.mockImplementation(async () => []);
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

function changeInput(selector: string, value: string) {
	const input = document.querySelector(selector);
	if (!(input instanceof HTMLInputElement))
		throw new Error(`Missing input ${selector}`);
	Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
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
	it("approves the saved revision and starts the design interview without leaving the feature", async () => {
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
		expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
		expect(mocks.approveAgendaTask).toHaveBeenCalledWith({
			taskId: "feature-1",
			expectedRevision: 3,
			allWorkspaces: true,
		});
		await act(async () => button("Interview with agent").click());
		expect(mocks.designFactoryTask).toHaveBeenCalledWith("feature-1");
		await act(async () => button("Interview with agent").click());
		expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
		expect(openSession).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Questions will appear here");
		await act(async () => button("Open design conversation").click());
		expect(openSession).toHaveBeenCalledWith("design-1");
	});
	it("collects a running feature question in Needs you and answers it through the existing protocol", async () => {
		mocks.tasks = [
			task({ status: "in_progress" }),
			task({ taskId: "other", title: "Unblocked feature" }),
		];
		let pending = true;
		mocks.invoke.mockImplementation(async (command) => {
			if (command === "factory_attention")
				return pending
					? [
							{
								taskId: "feature-1",
								needsAttention: true,
								questions: [
									{
										requestId: "q1",
										sessionId: "builder-1",
										createdAt: "2026-01-01T00:00:00Z",
										question: "Which format?",
										options: ["CSV", "JSON"],
									},
								],
							},
						]
					: [];
			if (command === "respond_ask_question") pending = false;
			return undefined;
		});
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Needs you (1)").click());
		expect(container.textContent).not.toContain("Unblocked feature");
		await act(async () => button("Export activity").click());
		expect(document.body.textContent).toContain("Which format?");
		const answer = Array.from(
			document.querySelectorAll('[aria-label="Follow-up question"] button'),
		).find((item) => item.textContent?.includes("CSV"));
		if (!(answer instanceof HTMLButtonElement))
			throw new Error("Missing CSV option");
		await act(async () => answer.click());
		expect(mocks.invoke).toHaveBeenCalledWith("respond_ask_question", {
			environmentId: "local",
			requestId: "q1",
			answer: "CSV",
		});
		expect(document.body.textContent).not.toContain("Which format?");
		expect(container.textContent).toContain("Needs you (0)");
	});
	it("loads an agent-saved brief into the open feature without copying from chat", async () => {
		mocks.tasks = [task({ status: "pending_approval" })];
		const render = () =>
			root.render(
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			);
		await act(async () => render());
		await act(async () => button("Export activity").click());
		mocks.tasks = [
			task({
				status: "pending_approval",
				revision: 4,
				instructions: "Export CSV with quoted values and UTF-8 headers.",
			}),
		];
		await act(async () => render());
		const brief = document.querySelector('textarea[aria-label="Design brief"]');
		expect(brief).toBeInstanceOf(HTMLTextAreaElement);
		if (brief instanceof HTMLTextAreaElement)
			expect(brief.value).toBe(
				"Export CSV with quoted values and UTF-8 headers.",
			);
	});
	it("imports an issue into editable fields and opens an existing feature instead of duplicating it", async () => {
		mocks.tasks = [task()];
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_import_issue"
				? {
						title: "Import activity",
						description: "Accept CSV uploads",
						source: {
							provider: "github",
							id: "owner/repo#7",
							url: "https://github.com/owner/repo/issues/7",
						},
					}
				: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("New feature").click());
		await act(async () =>
			changeInput("#feature-issue", "https://github.com/owner/repo/issues/7"),
		);
		await act(async () => button("Import").click());
		expect(mocks.invoke).toHaveBeenCalledWith("factory_import_issue", {
			url: "https://github.com/owner/repo/issues/7",
			cwd: "/repo",
		});
		const title = document.querySelector("#feature-name");
		const request = document.querySelector("#feature-request");
		if (
			!(title instanceof HTMLInputElement) ||
			!(request instanceof HTMLTextAreaElement)
		)
			throw new Error("Missing feature fields");
		expect(title.value).toBe("Import activity");
		expect(request.value).toBe("Accept CSV uploads");
		mocks.invoke.mockResolvedValueOnce({
			title: "Import activity",
			description: "Accept CSV uploads",
			source: {
				provider: "github",
				id: "owner/repo#7",
				url: "https://github.com/owner/repo/issues/7",
			},
			existingTaskId: "feature-1",
		});
		await act(async () => button("Import").click());
		expect(document.querySelector("#feature-name")).toBeNull();
		expect(document.body.textContent).toContain("Design brief");
	});
	it.each([
		"watching",
		"blocked",
		"ready",
		"closed",
	] as const)("controls %s PR follow-up without changing its repair budget", async (phase) => {
		const feature = task({ status: "completed", lastRunId: "run-1" });
		if (!feature.factory) throw new Error("Missing factory configuration");
		feature.factory.watchPullRequest = true;
		feature.factory.publishPullRequest = true;
		mocks.tasks = [feature];
		mocks.getFactoryTask.mockResolvedValueOnce({
			runs: [
				{
					runId: "run-1",
					taskId: feature.taskId,
					taskRevision: feature.revision,
					status: "completed",
					createdAt: feature.createdAt,
					updatedAt: feature.updatedAt,
					factory: {
						phase: phase === "closed" ? "ready" : phase,
						repairRound: 2,
						sessions: [],
						checks: [],
						candidateCommit: "candidate",
						workspace: {
							path: "/feature",
							branch: "feat/feature",
							baseBranch: "main",
							baseCommit: "base",
						},
						pullRequestUrl: "https://github.com/owner/repo/pull/9",
						pullRequestWatch:
							phase === "closed"
								? undefined
								: {
										headCommit: "candidate",
										handledFeedbackIds: [],
										paused: phase === "ready",
									},
					},
				},
			],
		});
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? [
						{
							taskId: feature.taskId,
							questions: [],
							needsAttention: phase !== "watching",
						},
					]
				: null,
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		expect(container.textContent).toContain(
			`Needs you (${phase === "watching" ? 0 : 1})`,
		);
		await act(async () => button("Export activity").click());
		if (phase === "closed") {
			expect(document.body.textContent).not.toContain("Resume PR follow-up");
			expect(document.body.textContent).not.toContain("Pause PR follow-up");
			return;
		}
		await act(async () =>
			button(
				phase === "watching" ? "Pause PR follow-up" : "Resume PR follow-up",
			).click(),
		);
		expect(mocks.invoke).toHaveBeenCalledWith("task.factory.watch", {
			taskId: "feature-1",
			expectedRevision: 3,
			enabled: phase !== "watching",
			allWorkspaces: true,
		});
		expect(document.body.textContent).toContain("Repair round 2 of 2");
	});
});
