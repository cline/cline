// @vitest-environment jsdom
import type { AgendaTaskRecord, AgendaTaskRunRecord } from "@cline/shared";
import {
	factoryDesignProgressSchema,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
	factoryDesignReviewSchema,
} from "@cline/shared";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopTransportState } from "@/lib/desktop-transport";
import { FeatureDetail, type FactoryDraft } from "./factory-detail";

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const transportListeners = new Set<(state: DesktopTransportState) => void>();
	return {
		listeners,
		transportListeners,
		subscribe: vi.fn((event: string, handler: (payload: unknown) => void) => {
			const handlers = listeners.get(event) ?? new Set();
			handlers.add(handler);
			listeners.set(event, handlers);
			return () => {
				handlers.delete(handler);
			};
		}),
		subscribeTransportState: vi.fn(
			(handler: (state: DesktopTransportState) => void) => {
				transportListeners.add(handler);
				handler("connected");
				return () => {
					transportListeners.delete(handler);
				};
			},
		),
		getFactoryTask: vi.fn<() => Promise<{ runs: AgendaTaskRunRecord[] }>>(),
		designFactoryTask: vi.fn(async () => ({ sessionId: "designer" })),
		approveAgendaTask: vi.fn(async () => task),
		startFactoryQueue: vi.fn(async () => ({ queued: 1 })),
		updateAgendaTask: vi.fn(),
		cancelAgendaTask: vi.fn(async () => {}),
		invoke: vi.fn(async (_command: string): Promise<unknown> => []),
	};
});
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: mocks,
	openExternalUrl: vi.fn(),
}));

const task: AgendaTaskRecord = {
	taskId: "feature",
	title: "Search notes",
	instructions: "# Search plan\n\nUse **titles**.",
	type: "todo",
	scope: "workspace",
	workspaceRoot: "/repo",
	status: "approved",
	resourcePaths: [],
	priority: 2,
	availableAt: "2026-01-01T00:00:00Z",
	expiresAt: "2027-01-01T00:00:00Z",
	automationEligible: false,
	revision: 1,
	createdBy: { kind: "user" },
	updatedBy: { kind: "user" },
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	factory: {
		execution: "local",
		approval: "required",
		maxRepairRounds: 2,
		checks: [
			{ name: "API", command: "node check.mjs", kind: "api", artifacts: [] },
		],
		publishPullRequest: false,
	},
};
const run: AgendaTaskRunRecord = {
	runId: "run",
	taskId: task.taskId,
	taskRevision: 1,
	attempt: 1,
	status: "completed",
	claimedAt: task.createdAt,
	createdAt: task.createdAt,
	updatedAt: task.updatedAt,
	factory: factoryRunStateSchema.parse({
		phase: "ready",
		repairRound: 0,
		sessions: [{ role: "verifier", sessionId: "verifier" }],
		workspace: {
			path: "/candidate",
			branch: "feat/example",
			baseBranch: "main",
			baseCommit: "base",
		},
		candidate: {
			commit: "candidate",
			checks: [],
			reviews: [],
			verification: {
				sessionId: "verifier",
				review: {
					verdict: "pass",
					summary: "## Browser results\n\nThe **search** works.",
					findings: [],
					coverage: { static: [], exercised: ["browser"], unverified: [] },
				},
				artifacts: [
					{
						path: "screen.png",
						label: "Browser screenshot",
						mimeType: "image/png",
					},
				],
			},
		},
	}),
};
let root: Root;
let container: HTMLDivElement;
const onOpenSession = vi.fn(async () => {});
const onClose = vi.fn();
const drafts = new Map<string, FactoryDraft>();
beforeEach(() => {
	vi.clearAllMocks();
	drafts.clear();
	mocks.listeners.clear();
	mocks.transportListeners.clear();
	sessionStorage.clear();
	mocks.getFactoryTask.mockResolvedValue({ runs: [] });
	mocks.invoke.mockResolvedValue([]);
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollTo = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render(
	value: AgendaTaskRecord,
	questions: ComponentProps<typeof FeatureDetail>["questions"] = [],
) {
	await act(async () =>
		root.render(
			<FeatureDetail
				drafts={drafts}
				task={value}
				onRefresh={vi.fn(async () => {})}
				onClose={onClose}
				onOpenSession={onOpenSession}
				questions={questions}
				onAnswer={vi.fn(async () => {})}
			/>,
		),
	);
}
function button(text: string) {
	const item = [...document.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === text,
	);
	if (!item) throw new Error(`Missing button: ${text}`);
	return item;
}
async function menuItem(text: string) {
	await act(async () => {
		button("More").dispatchEvent(
			new MouseEvent("pointerdown", {
				bubbles: true,
				button: 0,
				ctrlKey: false,
			}),
		);
	});
	const item = [...document.querySelectorAll('[role="menuitem"]')].find(
		(item) => item.textContent?.trim() === text,
	);
	if (!(item instanceof HTMLElement))
		throw new Error(`Missing menu item: ${text}`);
	await act(async () => item.click());
}
async function tab(text: string) {
	await act(async () => {
		const item = button(text);
		item.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
		item.click();
	});
}
it("archives with revision protection, surfaces conflicts, and restores without starting work", async () => {
	await render(task);
	mocks.invoke.mockRejectedValueOnce(new Error("Revision conflict"));
	await menuItem("Archive");
	expect(onClose).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain("Revision conflict");
	await menuItem("Archive");
	expect(mocks.invoke).toHaveBeenCalledWith("task.archive", {
		taskId: task.taskId,
		expectedRevision: task.revision,
		allWorkspaces: true,
	});
	expect(onClose).toHaveBeenCalledTimes(1);
	await render({ ...task, status: "cancelled", archivedAt: task.updatedAt });
	expect(document.body.textContent).not.toContain("Approve and run");
	await menuItem("Restore");
	expect(mocks.invoke).toHaveBeenLastCalledWith("task.restore", {
		taskId: task.taskId,
		expectedRevision: task.revision,
		allWorkspaces: true,
	});
	expect(onClose).toHaveBeenCalledTimes(2);
});

it("requires explicit confirmation before deleting a task", async () => {
	await render(task);
	await menuItem("Delete…");
	expect(mocks.invoke).not.toHaveBeenCalledWith(
		"task.delete",
		expect.anything(),
	);
	await act(async () => button("Keep task").click());
	expect(onClose).not.toHaveBeenCalled();
	await menuItem("Delete…");
	await act(async () => button("Delete permanently").click());
	expect(mocks.invoke).toHaveBeenCalledWith("task.delete", {
		taskId: task.taskId,
		expectedRevision: task.revision,
		allWorkspaces: true,
	});
	expect(onClose).toHaveBeenCalledOnce();
});

it("previews Markdown, preserves draft edits across tabs, and retains revision conflict handling", async () => {
	await render(task, [
		{
			requestId: "q",
			sessionId: "designer",
			question: "Which title?",
			options: [],
			createdAt: task.createdAt,
		},
	]);
	expect(
		document.querySelector('[data-streamdown="heading-1"]')?.textContent,
	).toBe("Search plan");
	expect(
		document.querySelector('textarea[aria-label="Design brief"]'),
	).toBeNull();
	await act(async () => button("Edit").click());
	const editor = document.querySelector('textarea[aria-label="Design brief"]');
	if (!(editor instanceof HTMLTextAreaElement))
		throw new Error("Missing plan editor");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(editor, "# My draft");
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(async () => button("Preview").click());
	expect(document.body.textContent).toContain("Unsaved draft");
	await tab("Verification");
	expect(document.body.textContent).toContain("Which title?");
	expect(document.body.textContent).toContain(
		"No verification has been recorded yet.",
	);
	await tab("Plan");
	expect(
		document.querySelector('[data-streamdown="heading-1"]')?.textContent,
	).toBe("My draft");
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(1);
	await render({ ...task, revision: 2, instructions: "# Agent revision" });
	expect(
		document.querySelector('[data-streamdown="heading-1"]')?.textContent,
	).toBe("My draft");
	expect(document.body.textContent).toContain("The agent saved a newer brief");
	mocks.updateAgendaTask.mockRejectedValueOnce(new Error("Revision conflict"));
	await act(async () => button("Save brief").click());
	expect(mocks.updateAgendaTask).toHaveBeenCalledWith(
		expect.objectContaining({
			expectedRevision: 1,
			instructions: "# My draft",
		}),
	);
	expect(document.body.textContent).toContain("Revision conflict");
	await act(async () => button("Load saved brief").click());
	expect(
		document.querySelector('[data-streamdown="heading-1"]')?.textContent,
	).toBe("Agent revision");
});

it("renders saved reports, opens the exact role session, and keeps failed or late evidence honest", async () => {
	let resolveOld = (_value: { runs: AgendaTaskRunRecord[] }) => {};
	mocks.getFactoryTask.mockReturnValueOnce(
		new Promise((resolve) => {
			resolveOld = resolve;
		}),
	);
	const completed = { ...task, status: "completed" as const, lastRunId: "run" };
	await render(completed);
	await tab("Verification");
	expect(document.body.textContent).toContain("Loading verification…");
	mocks.getFactoryTask.mockResolvedValueOnce({ runs: [run] });
	await render({ ...completed, lastRunId: "new-run" });
	expect(
		document.querySelector('[data-streamdown="heading-2"]')?.textContent,
	).toBe("Browser results");
	expect(document.body.textContent).toContain(
		"previous execution — not current evidence",
	);
	expect(document.body.textContent).not.toContain("Check off this result");
	await act(async () => button("Open agent verification session").click());
	expect(onOpenSession).toHaveBeenCalledWith("verifier");
	await act(async () => resolveOld({ runs: [{ ...run, runId: "new-run" }] }));
	expect(document.body.textContent).toContain(
		"previous execution — not current evidence",
	);
	mocks.invoke.mockRejectedValueOnce(new Error("Artifact unavailable"));
	await act(async () => button("Browser screenshot").click());
	expect(document.body.textContent).toContain("Artifact unavailable");
	mocks.getFactoryTask.mockRejectedValueOnce(
		new Error("Evidence refresh failed"),
	);
	await render({ ...completed, revision: 3 });
	expect(document.body.textContent).toContain("Evidence refresh failed");
	expect(document.body.textContent).toContain("cached; refresh failed");
	expect(document.body.textContent).not.toContain("Check off this result");
});

it("cancels an active designer using the displayed task revision", async () => {
	const designing: AgendaTaskRecord = {
		...task,
		status: "pending_approval",
		factoryDesignProgress: factoryDesignProgressSchema.parse({
			revision: task.revision,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase: "designing",
		}),
	};
	await render(designing);
	await act(async () => button("Cancel scoping").click());
	expect(mocks.cancelAgendaTask).toHaveBeenCalledTimes(1);
	expect(mocks.cancelAgendaTask).toHaveBeenCalledWith({
		taskId: task.taskId,
		expectedRevision: task.revision,
		allWorkspaces: true,
	});
	await render({ ...designing, status: "cancelled" });
	expect(document.body.textContent).not.toContain("Cancel scoping");
});

it.each([
	"in_progress",
	"completed",
	"failed",
] satisfies AgendaTaskRecord["status"][])("opens execution evidence for a %s task with a run", async (status) => {
	mocks.getFactoryTask.mockResolvedValue({ runs: [run] });
	await render({ ...task, status, lastRunId: run.runId });
	expect(button("Verification").getAttribute("aria-selected")).toBe("true");
	expect(document.body.textContent).toContain("Verification · revision 1");
	expect(document.querySelector("h1")?.textContent).toBe(task.title);
});

it("keeps reviewer indices, current revision and unverified coverage in the approval gate", async () => {
	const configured: AgendaTaskRecord = {
		...task,
		factory: factoryTaskConfigSchema.parse({
			...task.factory,
			agents: { planReviewers: [{}, {}] },
		}),
	};
	const review = {
		verdict: "pass",
		summary: "Reviewed the current plan.",
		findings: [],
		coverage: { static: ["brief"], exercised: [], unverified: [] },
	};
	const reports = factoryDesignReviewSchema.parse({
		revision: 1,
		reviews: [
			{ reviewerIndex: 0, sessionId: "reviewer-a", review },
			{ reviewerIndex: 1, sessionId: "reviewer-b", review },
		],
	});
	await render(configured);
	expect(button("Approve and run").disabled).toBe(true);
	expect(document.body.textContent).toContain(
		"Complete plan review for this revision",
	);
	for (const blocked of [
		{ ...reports, revision: 2 },
		{ ...reports, reviews: [reports.reviews[0]] },
		{
			...reports,
			reviews: reports.reviews.map((result) => ({
				...result,
				review: {
					...result.review,
					findings: ["Missing acceptance criterion"],
				},
			})),
		},
		{
			...reports,
			reviews: reports.reviews.map((result) => ({
				...result,
				review: {
					...result.review,
					coverage: { static: [], exercised: [], unverified: ["browser flow"] },
				},
			})),
		},
	]) {
		await render({
			...configured,
			factoryDesignReview: factoryDesignReviewSchema.parse(blocked),
		});
		expect(button("Approve and run").disabled).toBe(true);
	}
	await render({ ...configured, factoryDesignReview: reports });
	expect(button("Approve and run").disabled).toBe(false);
	await act(async () => button("Edit").click());
	await editBrief("Changed acceptance brief");
	expect(button("Approve and run").disabled).toBe(true);
	expect(document.body.textContent).toContain(
		"Draft changes need a new plan review",
	);
	expect(mocks.approveAgendaTask).not.toHaveBeenCalled();
});

it("refreshes evidence for semantic task updates, fences stale requests and numbers each role separately", async () => {
	const completed: AgendaTaskRecord = {
		...task,
		status: "completed",
		lastRunId: run.runId,
	};
	const rolesRun = {
		...run,
		factory: factoryRunStateSchema.parse({
			...run.factory,
			sessions: [
				{ role: "builder", sessionId: "builder" },
				{ role: "reviewer", sessionId: "reviewer" },
				{ role: "verifier", sessionId: "verifier" },
			],
		}),
	};
	mocks.getFactoryTask.mockResolvedValueOnce({ runs: [rolesRun] });
	await render(completed);
	expect(document.body.textContent).toContain("Reviewer 1");
	expect(document.body.textContent).toContain("Verifier 1");
	expect(button("Check off this result")).toBeDefined();
	await render({ ...completed });
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(1);
	let resolveRefresh = (_value: { runs: AgendaTaskRunRecord[] }) => {};
	mocks.getFactoryTask.mockReturnValueOnce(
		new Promise((resolve) => {
			resolveRefresh = resolve;
		}),
	);
	await render({ ...completed, updatedAt: "2026-01-01T00:01:00Z" });
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(2);
	expect(document.body.textContent).toContain("refreshing…");
	expect(button("Check off this result").disabled).toBe(true);
	expect(document.body.textContent).toContain(
		"Actions are unavailable until current evidence is refreshed",
	);
	mocks.getFactoryTask.mockResolvedValueOnce({
		runs: [{ ...rolesRun, taskRevision: 2 }],
	});
	await render({
		...completed,
		revision: 2,
		updatedAt: "2026-01-01T00:02:00Z",
	});
	await act(async () => resolveRefresh({ runs: [rolesRun] }));
	expect(document.body.textContent).toContain("Verification · revision 2");
	expect(document.body.textContent).not.toContain(
		"previous execution — not current evidence",
	);
});

it("protects unsaved back and role-session navigation and remembers the selected section", async () => {
	await render({ ...task, originSessionId: "designer" });
	await act(async () => button("Edit").click());
	await editBrief("Unsaved brief");
	await act(async () => button("Back to factory").click());
	expect(onClose).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain("Leave unsaved brief changes?");
	await act(async () => button("Keep editing").click());
	await act(async () => button("Open design conversation").click());
	expect(onOpenSession).not.toHaveBeenCalled();
	await act(async () => button("Discard and continue").click());
	expect(onOpenSession).toHaveBeenCalledWith("designer");
	expect(document.body.textContent).not.toContain("Unsaved draft");
	expect(drafts.has(task.taskId)).toBe(false);
	await tab("Verification");
	await act(async () => root.render(null));
	await render({ ...task, originSessionId: "designer" });
	expect(button("Verification").getAttribute("aria-selected")).toBe("true");
});

it("restores a draft after app navigation and preserves its revision conflict", async () => {
	await render(task);
	await act(async () => button("Edit").click());
	await editBrief("Unsaved acceptance change");
	await act(async () => button("Add check").click());
	await act(async () => root.render(null));
	await render({ ...task, revision: 2, instructions: "New saved plan" });
	expect(document.body.textContent).toContain("Unsaved acceptance change");
	expect(document.body.textContent).toContain("The agent saved a newer brief");
	expect(
		document.querySelectorAll('input[aria-label="Check name"]'),
	).toHaveLength(2);
	await act(async () => button("Load saved brief").click());
	expect(document.body.textContent).toContain("New saved plan");
	expect(drafts.has(task.taskId)).toBe(false);
});

it("disables cached result actions on connection loss until a refreshed reply arrives", async () => {
	mocks.getFactoryTask.mockResolvedValue({ runs: [run] });
	await render({ ...task, status: "completed", lastRunId: run.runId });
	expect(button("Check off this result").disabled).toBe(false);
	await act(async () => {
		for (const handler of mocks.transportListeners) handler("reconnecting");
	});
	expect(button("Check off this result").disabled).toBe(true);
	expect(document.body.textContent).toContain("cached; connection unavailable");
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(1);
	let resolveRefresh = (_value: { runs: AgendaTaskRunRecord[] }) => {};
	mocks.getFactoryTask.mockReturnValueOnce(
		new Promise((resolve) => {
			resolveRefresh = resolve;
		}),
	);
	await act(async () => {
		for (const handler of mocks.transportListeners) handler("connected");
	});
	expect(button("Check off this result").disabled).toBe(true);
	await act(async () => resolveRefresh({ runs: [run] }));
	expect(button("Check off this result").disabled).toBe(false);
});

it("uses the latest revision when a restored draft was already saved while away", async () => {
	await render(task);
	await act(async () => button("Edit").click());
	await editBrief("Saved while away");
	await act(async () => root.render(null));
	await render({ ...task, revision: 2, instructions: "Saved while away" });
	await act(async () => button("Edit").click());
	await editBrief("Next change");
	mocks.updateAgendaTask.mockResolvedValueOnce({ ...task, revision: 3 });
	await act(async () => button("Save brief").click());
	expect(mocks.updateAgendaTask).toHaveBeenCalledWith(
		expect.objectContaining({
			expectedRevision: 2,
			instructions: "Next change",
		}),
	);
});

it("retries a failed evidence read without requiring a task mutation", async () => {
	mocks.getFactoryTask.mockRejectedValueOnce(new Error("Evidence read failed"));
	await render({ ...task, status: "completed", lastRunId: run.runId });
	expect(document.body.textContent).toContain("Evidence read failed");
	mocks.getFactoryTask.mockResolvedValueOnce({ runs: [run] });
	await act(async () => button("Refresh verification").click());
	expect(button("Check off this result").disabled).toBe(false);
	expect(document.body.textContent).not.toContain("Evidence read failed");
});

async function editBrief(value: string) {
	const editor = document.querySelector('textarea[aria-label="Design brief"]');
	if (!(editor instanceof HTMLTextAreaElement))
		throw new Error("Missing plan editor");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(editor, value);
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

it("refreshes run-only task events, ignores unrelated or malformed payloads and recovers after reconnect", async () => {
	const completed: AgendaTaskRecord = {
		...task,
		status: "completed",
		lastRunId: run.runId,
	};
	mocks.getFactoryTask.mockResolvedValue({ runs: [run] });
	await render(completed);
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(1);
	await act(async () => {
		for (const handler of mocks.listeners.get("task.updated") ?? []) {
			handler({ task: { ...task, taskId: "another-task" }, run });
			handler({ taskId: task.taskId });
		}
	});
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(1);
	let resolveEvent = (_value: { runs: AgendaTaskRunRecord[] }) => {};
	mocks.getFactoryTask.mockReturnValueOnce(
		new Promise((resolve) => {
			resolveEvent = resolve;
		}),
	);
	const updatedRun = {
		...run,
		factory: factoryRunStateSchema.parse({
			...run.factory,
			humanApproval: {
				commit: "candidate",
				approvedAt: "2026-01-01T00:01:00Z",
			},
		}),
	};
	await act(async () => {
		for (const handler of mocks.listeners.get("task.updated") ?? [])
			handler({ task: completed, run: updatedRun });
	});
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(2);
	expect(button("Check off this result").disabled).toBe(true);
	await act(async () => resolveEvent({ runs: [updatedRun] }));
	expect(document.body.textContent).toContain(
		"This candidate has been checked off.",
	);
	expect(document.body.textContent).not.toContain("Check off this result");
	await render({ ...completed });
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(2);
	await act(async () => {
		for (const handler of mocks.transportListeners) handler("reconnecting");
	});
	await act(async () => {
		for (const handler of mocks.transportListeners) handler("connected");
	});
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(3);
	await act(async () => {
		for (const handler of mocks.transportListeners) handler("connected");
	});
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(3);
});
