// @vitest-environment jsdom
import type { AgendaTaskRecord, AgendaTaskRunRecord } from "@cline/shared";
import {
	factoryDesignProgressSchema,
	factoryDesignReviewSchema,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "@/lib/desktop-client";
import type { DesktopTransportState } from "@/lib/desktop-transport";
import { subscribeFactoryDiscussion } from "@/lib/factory-feedback";
import { type FactoryDraft, FeatureDetail } from "./factory-detail";

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
		createAgendaTask: vi.fn(),
		listAgendaTasks: vi.fn(async (): Promise<AgendaTaskRecord[]> => []),
		invoke: vi.fn(async (_command: string): Promise<unknown> => []),
	};
});
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: mocks,
	openExternalUrl: vi.fn(),
}));
// The real diff renders into @pierre/diffs' shadow DOM, which jsdom lacks.
vi.mock("@cline/ui/components/agent-chat/tool-diff", () => ({
	ToolFileDiff: ({ newText }: { newText: string }) => (
		<div data-new={newText} data-testid="tool-file-diff" />
	),
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
		acceptanceCriteria: [
			{
				id: "title-search",
				text: "Searching a title lists the note",
				required: true,
				check: "API",
			},
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
					coverage: {
						static: [],
						exercised: ["browser"],
						requiredGaps: [],
						limitations: [
							"Native verification is outside this browser review.",
						],
					},
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
const onOpenTask = vi.fn();
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
	unreadable?: string,
) {
	await act(async () =>
		root.render(
			<FeatureDetail
				drafts={drafts}
				task={value}
				onRefresh={vi.fn(async () => {})}
				onClose={onClose}
				onOpenSession={onOpenSession}
				onOpenTask={onOpenTask}
				questions={questions}
				onAnswer={vi.fn(async () => {})}
				unreadable={unreadable}
			/>,
		),
	);
}

it("keeps the reason a card's status could not be read under Details", async () => {
	await render(task, [], "intake.key: Invalid input: expected string");
	const details = document.querySelector('[data-testid="factory-details"]');
	expect(
		details?.querySelector('[data-testid="factory-details-unreadable"]')
			?.textContent,
	).toBe(
		"This card could not be readintake.key: Invalid input: expected string",
	);
});

it("offers one Start, not approval, for an unscoped card that cannot be approved yet", async () => {
	await render({
		...task,
		status: "pending_approval",
		factory: { ...task.factory!, checks: [] },
	});
	// Activity calls it "Not started"; the card agrees.
	expect(progress()?.textContent).toContain("Not started");
	expect(progress()?.textContent).not.toContain("Plan not ready to approve");
	expect(document.body.textContent).not.toContain(
		"The agent still needs to prepare verification checks",
	);
	expect(() => button("Approve and run")).toThrow();
	expect(startButtons()).toEqual(["Start scoping"]);
	expect(() => button("Save brief")).toThrow();
	await act(async () => button("Start scoping").click());
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
	expect(mocks.approveAgendaTask).not.toHaveBeenCalled();
});
/** Every Start button: a card offers exactly one way to begin. */
function startButtons() {
	return [...document.querySelectorAll("button")]
		.map((item) => item.textContent?.trim())
		.filter((text) => text?.startsWith("Start"));
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
	// Scoping waits on the person: said once, with no spinner, timer or
	// disabled approval beside the question.
	const progress = document.querySelector('[aria-label="Task progress"]');
	expect(progress?.textContent).toContain("Waiting for your answer");
	expect(progress?.querySelector(".animate-spin")).toBeNull();
	expect(document.body.textContent).not.toContain(
		"Answer the agent’s question so scoping can continue.",
	);
	expect(document.body.textContent).not.toContain("Preparing plan");
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
	// Before a run there is no Verification section, so no tab for one.
	expect(
		[...document.querySelectorAll('[role="tab"]')].map((item) =>
			item.textContent?.trim(),
		),
	).not.toContain("Verification");
	expect(document.body.textContent).toContain("Which title?");
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
	expect(document.body.textContent).toContain("Nonblocking limitations");
	expect(document.body.textContent).toContain(
		"Native verification is outside this browser review.",
	);
	expect(document.body.textContent).toContain("from an earlier attempt");
	expect(() => button("Accept")).toThrow();
	await act(async () => button("Open agent verification session").click());
	expect(onOpenSession).toHaveBeenCalledWith("verifier");
	await act(async () => resolveOld({ runs: [{ ...run, runId: "new-run" }] }));
	expect(document.body.textContent).toContain("from an earlier attempt");
	mocks.invoke.mockRejectedValueOnce(new Error("Artifact unavailable"));
	await act(async () => button("Browser screenshot").click());
	expect(document.body.textContent).toContain("Artifact unavailable");
	mocks.getFactoryTask.mockRejectedValueOnce(
		new Error("Evidence refresh failed"),
	);
	await render({ ...completed, revision: 3 });
	expect(document.body.textContent).toContain("Evidence refresh failed");
	expect(document.body.textContent).toContain(
		"couldn't refresh; showing saved results",
	);
	expect(() => button("Accept")).toThrow();
});

it.each([
	["designing", "Scoping"],
	["reviewing", "Checking the plan"],
] as const)("cancels %s using the displayed revision and removes active progress", async (phase, headline) => {
	const designing: AgendaTaskRecord = {
		...task,
		status: "pending_approval",
		factoryDesignProgress: factoryDesignProgressSchema.parse({
			revision: task.revision,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase,
			reviewerSessions: [],
			reviews: [],
		}),
	};
	await render(designing);
	expect(
		document.querySelector('[aria-label="Task progress"]')?.textContent,
	).toContain(headline);
	await menuItem("Stop this work…");
	expect(mocks.cancelAgendaTask).not.toHaveBeenCalled();
	await act(async () => button("Stop work").click());
	expect(mocks.cancelAgendaTask).toHaveBeenCalledTimes(1);
	expect(mocks.cancelAgendaTask).toHaveBeenCalledWith({
		taskId: task.taskId,
		expectedRevision: task.revision,
		allWorkspaces: true,
	});
	await render({ ...designing, status: "cancelled" });
	expect(document.body.textContent).not.toContain("Cancel scoping");
	const progress = document.querySelector('[aria-label="Task progress"]');
	expect(progress?.textContent).toContain("Cancelled");
	expect(progress?.textContent).not.toContain(headline);
	await menuItem("Archive");
	expect(mocks.invoke).toHaveBeenCalledWith("task.archive", {
		taskId: task.taskId,
		expectedRevision: task.revision,
		allWorkspaces: true,
	});
});

it("keeps a replay brief frozen and follows its automatically queued plan review", async () => {
	const variant: AgendaTaskRecord = {
		...task,
		taskId: "task_replay_a",
		status: "pending_approval",
		factory: factoryTaskConfigSchema.parse({
			...task.factory,
			agents: { planReviewers: [{}] },
			replay: {
				comparisonId: "comparison_1",
				variantIndex: 0,
				requestHash: "a".repeat(64),
				sourceTaskId: task.taskId,
				sourceRunId: run.runId,
				sourceTaskRevision: 1,
				baseCommit: "base",
				baseBranch: "main",
				label: "Cheaper review",
			},
		}),
	};
	// Creation queues the review; it records no progress until it starts.
	await render(variant);
	expect(
		document.querySelector('[aria-label="Task progress"]')?.textContent,
	).toContain("Plan review queued");
	expect(button("Edit").disabled).toBe(true);
	expect(document.body.textContent).not.toContain("Save brief");
	expect(document.body.textContent).not.toContain("View design transcript");
	expect(document.body.textContent).toContain(
		"Creating the replay queued a fresh plan review",
	);
	expect(document.body.textContent).toContain(
		"Nothing is implemented until you approve it",
	);
	expect(button("Plan review queued").disabled).toBe(true);
	expect(button("Approve and run").disabled).toBe(true);
	expect(document.body.textContent).toContain(
		"plan review is queued and starts automatically",
	);
	await render({
		...variant,
		factoryDesignProgress: factoryDesignProgressSchema.parse({
			revision: task.revision,
			repairRound: 0,
			agents: { planReviewers: [{}] },
			designerSessionId: "plan-reviewer",
			findings: [],
			phase: "reviewing",
			reviewerSessions: [{ reviewerIndex: 0, sessionId: "plan-reviewer" }],
			reviews: [],
		}),
	});
	expect(button("Plan review in progress").disabled).toBe(true);
	expect(
		document.querySelector('[aria-label="Task progress"]')?.textContent,
	).toContain("Checking the plan");
	// Blockers clear the progress and record the error; retrying is explicit.
	await render({
		...variant,
		error: "Replay plan review found blockers.",
	});
	await act(async () => button("Retry plan review").click());
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(variant.taskId);
	expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
});

it.each([
	"in_progress",
	"completed",
	"failed",
] satisfies AgendaTaskRecord["status"][])("opens execution evidence for a %s task with a run", async (status) => {
	mocks.getFactoryTask.mockResolvedValue({ runs: [run] });
	await render({ ...task, status, lastRunId: run.runId });
	expect(button("Verification").getAttribute("aria-selected")).toBe("true");
	expect(document.body.textContent).toContain("Latest results");
	expect(document.body.textContent).not.toContain("revision 1");
	expect(document.querySelector("h1")?.textContent).toBe(task.title);
});

it("keeps reviewer indices, current revision and required gaps in the approval gate", async () => {
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
		coverage: {
			static: ["brief"],
			exercised: [],
			requiredGaps: [],
			limitations: ["Platform coverage is outside this plan review."],
		},
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
	// Core's blocker, in plain words.
	expect(document.body.textContent).toContain(
		"The plan has not passed its review yet.",
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
					coverage: {
						static: [],
						exercised: [],
						requiredGaps: ["browser flow"],
						limitations: [],
					},
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

it("names acceptance criteria in the plan and keeps approval closed until each one has a proof owner", async () => {
	const unscoped: AgendaTaskRecord = {
		...task,
		status: "pending_approval",
		factory: factoryTaskConfigSchema.parse({
			...task.factory,
			acceptanceCriteria: undefined,
		}),
	};
	await render(unscoped);
	const plan = () =>
		document.querySelector('section[aria-label="Requirements"]')?.textContent ??
		"";
	expect(plan()).toContain("No acceptance criteria are recorded");
	// Not started: Start is the one action until the plan is edited by hand.
	expect(() => button("Approve and run")).toThrow();
	await act(async () => button("Add criterion").click());
	expect(button("Approve and run").disabled).toBe(true);
	expect(document.body.textContent).toContain(
		"Describe every acceptance criterion before approval.",
	);
	await change(
		'input[aria-label="Criterion criterion-1"]',
		"Searching a title lists it",
	);
	// No verifier is configured, so the criterion needs a named check.
	expect(button("Approve and run").disabled).toBe(true);
	expect(document.body.textContent).toContain(
		"needs a named approved check or a configured verifier",
	);
	await change('select[aria-label="Proven by"]', "API");
	// The plan's criterion ids are internal: the list shows the text.
	expect(plan()).not.toContain("criterion-1");
	expect(plan()).toContain("Searching a title lists it");
	expect(plan()).toContain("Required · proven by check “API”");
	mocks.updateAgendaTask.mockResolvedValueOnce({ ...unscoped, revision: 2 });
	await act(async () => button("Approve and run").click());
	expect(mocks.updateAgendaTask).toHaveBeenCalledWith(
		expect.objectContaining({
			factory: expect.objectContaining({
				acceptanceCriteria: [
					{
						id: "criterion-1",
						text: "Searching a title lists it",
						required: true,
						check: "API",
					},
				],
			}),
		}),
	);
	expect(mocks.approveAgendaTask).toHaveBeenCalledWith({
		taskId: task.taskId,
		expectedRevision: 2,
		allWorkspaces: true,
	});
});

it("shows each criterion's recorded outcome and evidence, and no per-criterion claim for older runs", async () => {
	const completed: AgendaTaskRecord = {
		...task,
		status: "completed",
		lastRunId: run.runId,
	};
	mocks.getFactoryTask.mockResolvedValueOnce({ runs: [run] });
	await render(completed);
	expect(document.body.textContent).toContain(
		"Not proven per requirement: this run only ran the checks.",
	);
	expect(document.body.textContent).not.toContain("required proven");
	const candidate = run.factory?.candidate;
	if (!candidate?.verification) throw new Error("Missing fixture candidate");
	const scored = {
		...run,
		factory: factoryRunStateSchema.parse({
			...run.factory,
			inputSnapshot: {
				scope: "workspace",
				workspaceRoot: "/repo",
				title: task.title,
				instructions: task.instructions,
				resourcePaths: [],
				factory: {
					...task.factory,
					agents: { verifier: {} },
					acceptanceCriteria: [
						{ id: "api-search", text: "API finds titles", check: "API" },
						{ id: "browser-flow", text: "Browser search shows results" },
						{
							id: "empty-state",
							text: "Empty query keeps the list",
							required: false,
						},
					],
				},
			},
			candidate: {
				...candidate,
				checks: [
					{
						name: "API",
						kind: "api",
						command: "node check.mjs",
						status: "passed",
						exitCode: 0,
						output: "ok",
						artifacts: [],
					},
				],
				// A global pass does not prove the criterion it never reported.
				verification: {
					...candidate.verification,
					review: {
						...candidate.verification.review,
						acceptance: [
							{
								criterionId: "empty-state",
								outcome: "failed",
								evidence: "The list cleared on an empty query.",
							},
						],
					},
				},
			},
		}),
	};
	mocks.getFactoryTask.mockResolvedValueOnce({ runs: [scored] });
	await act(async () => button("Refresh results").click());
	const results =
		document.querySelector('section[aria-label="Acceptance results"]')
			?.textContent ?? "";
	expect(results).toContain(
		"1/2 required proven · 1 unverified · optional 0/1 passed",
	);
	expect(results).toContain('Check "API" passed (exit 0)');
	expect(results).toContain("No evidence recorded.");
	expect(results).toContain("The list cleared on an empty query.");
});

it("keeps retry history links separate from the latest plan-review attempt", async () => {
	const factory = factoryTaskConfigSchema.parse({
		...task.factory,
		agents: { planReviewers: [{}] },
	});
	const progress = factoryDesignProgressSchema.parse({
		phase: "reviewing",
		revision: task.revision,
		repairRound: 0,
		agents: factory.agents,
		designerSessionId: "designer",
		findings: [],
		reviews: [],
		reviewerSessions: [
			{ reviewerIndex: 0, sessionId: "failed-attempt" },
			{ reviewerIndex: 0, sessionId: "current-attempt" },
		],
	});
	await render({
		...task,
		factory,
		originSessionId: "designer",
		factoryDesignProgress: progress,
	});
	// Only the running attempt is offered live.
	expect(
		document.querySelector('[data-testid="factory-live-line"]')?.textContent,
	).toContain("Plan checker");
	// The Agents tab lists the running plan checker first and shows its
	// conversation; "Open in chat" opens that session.
	const lanes = () =>
		[...document.querySelectorAll('[data-testid="factory-agent-lane"]')].map(
			(lane) => lane.textContent,
		);
	expect(lanes()[0]).toContain("Plan checker");
	await act(async () => button("Open in chat").click());
	expect(onOpenSession).toHaveBeenLastCalledWith("current-attempt");
	expect(button("Preparing plan…").disabled).toBe(true);
	// Once review finishes, its step keeps the latest attempt apart from retries.
	await render({
		...task,
		factory,
		originSessionId: "designer",
		factoryDesignProgress: factoryDesignProgressSchema.parse({
			...progress,
			phase: "complete",
		}),
	});
	expect(document.body.textContent).not.toContain("Watch live");
	expect(
		document.querySelector('[data-testid="factory-agent-lane"][data-running]'),
	).toBeNull();
	// The failed retry never got a lane of its own.
	expect(onOpenSession).not.toHaveBeenCalledWith("failed-attempt");
});

it("uses the selected team for approval and invalidates it when the brief changes", async () => {
	const configured = {
		...task,
		factory: factoryTaskConfigSchema.parse({
			...task.factory,
			reviewMode: "adaptive",
			agents: {
				planReviewers: [{}, {}],
				reviewers: [
					{ modelSelection: { providerId: "test", modelId: "general" } },
					{ modelSelection: { providerId: "test", modelId: "desktop" } },
				],
			},
		}),
	};
	await render(configured);
	expect(button("Approve and run").disabled).toBe(true);
	const progress = factoryDesignProgressSchema.parse({
		phase: "complete",
		revision: task.revision,
		repairRound: 0,
		agents: configured.factory.agents,
		designerSessionId: "designer",
		findings: [],
		reviewerSessions: [],
		reviews: [],
		reviewSelection: {
			impact: "local",
			rationale: "Only the Desktop search control changes.",
			affectedPaths: ["apps/desktop/search.tsx"],
			consumers: ["Desktop Sessions"],
			planReviewerIndices: [],
			reviewerIndices: [1],
		},
	});
	await render({
		...configured,
		factoryDesignProgress: { ...progress, revision: 2 },
	});
	expect(button("Approve and run").disabled).toBe(true);
	await render({ ...configured, factoryDesignProgress: progress });
	expect(button("Approve and run").disabled).toBe(false);
	const team = document.querySelector('[aria-label="Selected review team"]');
	expect(team?.textContent).toContain(
		"Only the Desktop search control changes.",
	);
	expect(team?.textContent).toContain("desktop");
	expect(team?.textContent).not.toContain("general");
	await act(async () => button("Edit").click());
	await editBrief("Also change the shared search API.");
	expect(button("Approve and run").disabled).toBe(true);
	expect(
		document.querySelector('[aria-label="Selected review team"]'),
	).toBeNull();
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
	// Each role session has its own lane in the Agents tab, numbered per role.
	expect(document.body.textContent).not.toContain("Sessions");
	await openPanelTab("Agents");
	expect(
		[...document.querySelectorAll('[data-testid="factory-agent-lane"]')].map(
			(lane) => lane.getAttribute("aria-label"),
		),
	).toEqual([
		"Show the builder's conversation",
		"Show the code reviewer's conversation",
		"Show the tester's conversation",
	]);
	expect(button("Accept")).toBeDefined();
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
	expect(button("Accept").disabled).toBe(true);
	mocks.getFactoryTask.mockResolvedValueOnce({
		runs: [{ ...rolesRun, taskRevision: 2 }],
	});
	await render({
		...completed,
		revision: 2,
		updatedAt: "2026-01-01T00:02:00Z",
	});
	await act(async () => resolveRefresh({ runs: [rolesRun] }));
	expect(document.body.textContent).toContain("Latest results");
	expect(document.body.textContent).not.toContain("from an earlier attempt");
});

it("protects unsaved back and role-session navigation and remembers the selected section", async () => {
	await render({ ...task, originSessionId: "designer" });
	await act(async () => button("Edit").click());
	await editBrief("Unsaved brief");
	await act(async () => button("Back to Factory").click());
	expect(onClose).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain("Leave unsaved brief changes?");
	expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
	await act(async () => button("Keep editing").click());
	await act(async () => button("View design transcript").click());
	expect(onOpenSession).not.toHaveBeenCalled();
	await act(async () => button("Discard and continue").click());
	expect(onOpenSession).toHaveBeenCalledWith("designer");
	expect(document.body.textContent).not.toContain("Unsaved draft");
	expect(drafts.has(task.taskId)).toBe(false);
	// A card with a run remembers its section.
	await act(async () => root.render(null));
	await render({ ...task, lastRunId: "run-1" });
	await tab("Verification");
	await act(async () => root.render(null));
	await render({ ...task, lastRunId: "run-1", originSessionId: "designer" });
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
	expect(button("Accept").disabled).toBe(false);
	await act(async () => {
		for (const handler of mocks.transportListeners) handler("reconnecting");
	});
	expect(button("Accept").disabled).toBe(true);
	expect(document.body.textContent).toContain(
		"connection unavailable; showing saved results",
	);
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
	expect(button("Accept").disabled).toBe(true);
	await act(async () => resolveRefresh({ runs: [run] }));
	expect(button("Accept").disabled).toBe(false);
});

it("does not label an intake session as the designer before scoping starts", async () => {
	await render({
		...task,
		status: "pending_approval",
		originSessionId: "scheduled-intake",
		factory: factoryTaskConfigSchema.parse({
			...task.factory,
			intake: { source: "issue-watch", key: "issue-42" },
		}),
	});
	expect(document.body.textContent).not.toContain("View design transcript");
	await act(async () => button("Start scoping").click());
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
	await act(async () => button("View design transcript").click());
	expect(onOpenSession).toHaveBeenCalledWith("designer");
});

it.each([
	"draft",
	"saved",
])("refines an edited %s after opening the completed plan", async (state) => {
	await render({
		...task,
		originSessionId: "designer",
		factoryDesignProgress: factoryDesignProgressSchema.parse({
			phase: "complete",
			revision: task.revision,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			reviewerSessions: [],
			reviews: [],
		}),
	});
	// A finished plan is edited with the Brief's Edit; no second button
	// labelled as scoping opens the same editor.
	expect(
		[...document.querySelectorAll("button")].some(
			(item) => item.textContent?.trim() === "Refine design",
		),
	).toBe(false);
	await act(async () => button("Edit").click());
	expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
	expect(mocks.designFactoryTask).not.toHaveBeenCalled();
	const editor = document.querySelector('textarea[aria-label="Design brief"]');
	expect(editor).toBeInstanceOf(HTMLTextAreaElement);
	expect(document.activeElement).toBe(editor);
	const instructions = "Clarify empty-query behavior using existing controls.";
	await editBrief(instructions);
	const saved: AgendaTaskRecord = {
		...task,
		revision: 2,
		status: "pending_approval",
		instructions,
		approvedRevision: undefined,
		originSessionId: "designer",
		factoryDesignProgress: undefined,
	};
	mocks.updateAgendaTask.mockResolvedValueOnce(saved);
	if (state === "saved") {
		await act(async () => button("Save brief").click());
		await render(saved);
	}
	await act(async () => button("Refine design").click());
	expect(mocks.updateAgendaTask).toHaveBeenCalledWith({
		taskId: task.taskId,
		expectedRevision: 1,
		instructions,
		factory: task.factory,
		allWorkspaces: true,
	});
	expect(mocks.updateAgendaTask).toHaveBeenCalledTimes(1);
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
	expect(mocks.designFactoryTask).toHaveBeenCalledTimes(1);
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
	await act(async () => button("Refresh results").click());
	expect(button("Accept").disabled).toBe(false);
	expect(document.body.textContent).not.toContain("Evidence read failed");
});

async function change(selector: string, value: string) {
	const field = document.querySelector(selector);
	if (
		!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
	)
		throw new Error(`Missing field: ${selector}`);
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(field),
			"value",
		)?.set?.call(field, value);
		field.dispatchEvent(
			new Event(field instanceof HTMLSelectElement ? "change" : "input", {
				bubbles: true,
			}),
		);
	});
}

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
	expect(button("Accept").disabled).toBe(true);
	await act(async () => resolveEvent({ runs: [updatedRun] }));
	expect(document.body.textContent).toContain("You accepted this delivery.");
	expect(() => button("Accept")).toThrow();
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

it("shows a designer conclusion, keeps approval blocked and offers dismissal or a brief revision", async () => {
	const conclusion = {
		outcome: "duplicate" as const,
		rationale: "Title search is already planned in another card.",
		evidence: ["task_other", "src/search.ts:12"],
		duplicateOf: "task_other",
	};
	const concluded: AgendaTaskRecord = {
		...task,
		status: "pending_approval",
		factoryDesignProgress: factoryDesignProgressSchema.parse({
			revision: task.revision,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase: "complete",
			reviewerSessions: [],
			reviews: [],
			conclusion,
		}),
	};
	await render(concluded);
	const banner = document.querySelector(
		'section[aria-label="Designer conclusion"]',
	);
	expect(banner?.textContent).toContain("No build needed · Duplicate");
	expect(banner?.textContent).toContain(conclusion.rationale);
	for (const item of conclusion.evidence)
		expect(banner?.querySelector("ul")?.textContent).toContain(item);
	expect(document.body.textContent).toContain(
		"Dismiss this card, or revise the brief to build anyway.",
	);
	expect(button("Approve and run").disabled).toBe(true);
	expect(
		document.getElementById("factory-approval-reason")?.textContent,
	).toContain(
		"The designer concluded no build is needed (duplicate). Dismiss the card, or revise the brief to design it anyway.",
	);

	await act(async () => button("task_other").click());
	expect(onOpenTask).toHaveBeenCalledWith("task_other");

	await act(async () => button("Edit brief").click());
	expect(
		document.querySelector('textarea[aria-label="Design brief"]'),
	).not.toBeNull();

	await act(async () => button("Dismiss").click());
	expect(mocks.invoke).toHaveBeenCalledWith("task.archive", {
		taskId: task.taskId,
		expectedRevision: task.revision,
		allWorkspaces: true,
	});
	expect(onClose).toHaveBeenCalled();

	// A conclusion from an older brief no longer applies.
	await render({ ...concluded, revision: 2 });
	expect(
		document.querySelector('section[aria-label="Designer conclusion"]'),
	).toBeNull();
});

it("shows a held hands-off card on hold with a Start action that starts scoping", async () => {
	await render({
		...task,
		status: "pending_approval",
		factory: {
			...factoryTaskConfigSchema.parse(task.factory),
			autonomy: "hands_off",
			approval: "automatic",
			hold: true,
		},
	});
	expect(document.body.textContent).toContain("On hold");
	expect(document.body.textContent).not.toContain("Queued for scoping");
	await act(async () => button("Start").click());
	// Core clears the hold when scoping starts.
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
});

const handsOffConfig = {
	...factoryTaskConfigSchema.parse(task.factory),
	autonomy: "hands_off" as const,
	approval: "automatic" as const,
};
const attempt = (
	sessionId: string,
	role: "builder" | "reviewer" | "verifier",
	status: "running" | "completed",
	createdAt = "2026-01-01T00:00:00Z",
) => ({
	id: sessionId,
	key: sessionId,
	role,
	repairRound: 0,
	createdAt,
	sessionId,
	instructions: "Work.",
	agent: {},
	status,
	...(status === "completed"
		? { summary: "Done.", completedAt: "2026-01-01T00:05:00Z" }
		: {}),
});
function withState(state: Record<string, unknown>): AgendaTaskRunRecord {
	return {
		...run,
		status: "running" as AgendaTaskRunRecord["status"],
		factory: factoryRunStateSchema.parse({ ...run.factory, ...state }),
	};
}
function progress() {
	return document.querySelector('[aria-label="Task progress"]');
}
/** "build:current", "checks:stopped": where the card is on its station line. */
function currentStage() {
	const line = document.querySelector('[data-testid="factory-card-stations"]');
	const item =
		line?.querySelector('[data-state="current"],[data-state="stopped"]') ??
		[...(line?.querySelectorAll('[data-state="done"]') ?? [])].at(-1);
	return item
		? `${item.getAttribute("data-factory-station")}:${item.getAttribute("data-state")}`
		: undefined;
}
/** The station names on the card's line, skipped ones left out. */
function stationNames() {
	return (
		document.querySelector('[data-testid="factory-card-stations"]')
			?.textContent ?? ""
	);
}
function panelTab(name: string) {
	const item = [
		...document.querySelectorAll(
			'[data-testid="factory-artifact-panel"] [role="tab"]',
		),
	].find((tab) => tab.textContent?.trim() === name);
	if (!(item instanceof HTMLElement)) throw new Error(`Missing tab: ${name}`);
	return item;
}
function emit(event: string, payload: unknown) {
	for (const handler of mocks.listeners.get(event) ?? []) handler(payload);
}

it("says scoping stopped, once, when scoping ran and could not settle the plan", async () => {
	await render({
		...task,
		status: "pending_approval",
		error: "Design did not complete: Plan repair limit (2) reached.",
		factory: handsOffConfig,
		factoryDesignProgress: factoryDesignProgressSchema.parse({
			phase: "reviewing",
			revision: task.revision,
			repairRound: 2,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			reviewerSessions: [],
			reviews: [],
		}),
	});
	expect(progress()?.querySelector("strong")?.textContent).toBe(
		"Scoping stopped",
	);
	expect(document.body.textContent).not.toContain("Not started");
	expect(document.body.textContent).not.toContain("Design did not complete");
	expect(
		document.body.textContent?.split("still had objections after 2 rounds")
			.length,
	).toBe(2);
	const actions = [
		...(document
			.querySelector('[data-testid="factory-card-actions"]')
			?.querySelectorAll("button") ?? []),
	].map((item) => item.textContent?.trim());
	expect(actions).toEqual(["Try scoping again"]);
	expect(() => button("Start scoping")).toThrow();
	await act(async () => button("Try scoping again").click());
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
	await menuItem("Edit plan");
	expect(
		document.querySelector('textarea[aria-label="Design brief"]'),
	).not.toBeNull();
});

it("keeps feedback optional: one quiet row on a delivered card and More → Rate", async () => {
	const delivered = withState({
		phase: "ready",
		pullRequestUrl: "https://github.com/example/repo/pull/7",
		inputSnapshot: undefined,
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...delivered, status: "completed" }],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
	expect(document.querySelector('[aria-label="Feedback"]')).not.toBeNull();
	// Nothing asks for a rating: an unrated delivery is not waiting on anyone.
	expect(progress()?.textContent?.toLowerCase()).not.toContain("feedback");
	expect(document.querySelector("#factory-feedback-finding")).toBeNull();
	await menuItem("Leave feedback…");
	await act(async () => new Promise(requestAnimationFrame));
	const field = document.querySelector("#factory-feedback-finding");
	expect(field).toBeInstanceOf(HTMLTextAreaElement);
	expect(document.activeElement).toBe(field);
	expect(
		document
			.querySelector('[aria-controls="factory-feedback"]')
			?.getAttribute("aria-expanded"),
	).toBe("true");
});

it("offers no feedback on a card that is not delivered", async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...withState({ phase: "implementing" }), status: "running" }],
	});
	await render({
		...task,
		status: "in_progress",
		currentRunId: run.runId,
		factory: handsOffConfig,
	});
	expect(document.querySelector('[aria-label="Feedback"]')).toBeNull();
	expect(
		document.querySelector('[aria-controls="factory-feedback"]'),
	).toBeNull();
	await expect(menuItem("Leave feedback…")).rejects.toThrow(
		"Missing menu item",
	);
});

it("leads a delivered card with its proof, the draft PR as the header's action and a two-click feedback path", async () => {
	const delivered = withState({
		phase: "ready",
		pullRequestUrl: "https://github.com/example/repo/pull/7",
		inputSnapshot: undefined,
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...delivered, status: "completed" }],
	});
	const card: AgendaTaskRecord = {
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	};
	await render(card);
	expect(progress()?.querySelector("strong")?.textContent).toBe(
		"Draft PR ready",
	);
	const proof = document.querySelector('[aria-label="Proof"]');
	expect(proof?.textContent).toContain("Tester · model not recorded · passed");
	// The draft PR is the header's one primary action, never in a tab.
	const actions = document.querySelector(
		'[data-testid="factory-card-actions"]',
	);
	expect(
		[...(actions?.querySelectorAll("button") ?? [])].map((item) =>
			item.textContent?.trim(),
		),
	).toEqual(["Open draft PR"]);
	// Hands-off: feedback is the completion act; no section tabs, stamp or
	// sampling. Changes are in the artifact panel, not behind a button.
	expect(() => button("Accept")).toThrow();
	expect(document.body.textContent).not.toContain("Sample this outcome");
	expect(document.body.textContent).not.toContain("awaiting your feedback");
	expect(
		document.querySelector('[role="tablist"][aria-label="Task sections"]'),
	).toBeNull();
	expect(() => button("View changes")).toThrow();
	expect(panelTab("Changes").getAttribute("aria-selected")).toBe("true");
	// A finished card offers no scoping, not even a disabled button.
	expect(document.getElementById("factory-design-action")).toBeNull();
	await act(async () => button("Open draft PR").click());
	expect(openExternalUrl).toHaveBeenCalledWith(
		"https://github.com/example/repo/pull/7",
	);
	await act(async () => button("Good").click());
	expect(mocks.invoke).toHaveBeenCalledWith("task.factory.audit", {
		taskId: task.taskId,
		finding: "",
		allWorkspaces: true,
	});
	await act(async () => button("Something's off…").click());
	const field = document.querySelector("#factory-feedback-finding");
	if (!(field instanceof HTMLTextAreaElement)) throw new Error("No field");
	expect(
		document.querySelector('label[for="factory-feedback-finding"]')
			?.textContent,
	).toBe("What did Factory miss?");
	expect(button("Send feedback").disabled).toBe(true);
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(field, "Empty titles still match.");
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(async () => button("Send feedback").click());
	expect(mocks.invoke).toHaveBeenLastCalledWith("task.factory.audit", {
		taskId: task.taskId,
		finding: "Empty titles still match.",
		allWorkspaces: true,
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...delivered,
				status: "completed",
				factory: factoryRunStateSchema.parse({
					...delivered.factory,
					audit: {
						selectedAt: "2026-01-02T00:00:00Z",
						reviewedAt: "2026-01-02T00:00:00Z",
						finding: "",
					},
				}),
			},
		],
	});
	await render({ ...card, updatedAt: "2026-01-02T00:00:00Z" });
	expect(document.body.textContent).toContain("Thanks. Feedback recorded.");
	expect(() => button("Good")).toThrow();
	expect(document.body.textContent).not.toContain("Fix this in Factory");
});

it("asks a manual card's reviewer to Accept beside its proof, without a separate thumbs-up", async () => {
	mocks.getFactoryTask.mockResolvedValue({ runs: [run] });
	await render({ ...task, status: "completed", lastRunId: run.runId });
	expect(document.querySelector('[aria-label="Proof"]')).not.toBeNull();
	expect(button("Accept").disabled).toBe(false);
	// Accept records the good feedback, so there is no separate thumbs-up.
	expect(() => button("Good")).toThrow();
	expect(button("Something's off…")).toBeTruthy();
	expect(document.querySelector('[role="tablist"]')).not.toBeNull();
});

it("orders a hands-off card status first and keeps configuration read-only behind Details", async () => {
	mocks.getFactoryTask.mockResolvedValue({ runs: [] });
	await render({
		...task,
		status: "failed",
		error: "Plan review blocked.",
		factory: handsOffConfig,
		modelSelection: { providerId: "test", modelId: "model-x" },
	});
	const sections = [
		...document.querySelectorAll(
			'[aria-label="Task progress"], [aria-label="Brief"], details',
		),
	].map(
		(node) =>
			node.getAttribute("aria-label") ??
			node.querySelector("summary")?.textContent,
	);
	expect(sections).toEqual(["Task progress", "Brief", "Details"]);
	const header = document.querySelector("header")?.textContent ?? "";
	expect(header).not.toContain("Revision");
	expect(header).not.toContain("Local execution");
	expect(header).not.toContain("model-x");
	const details = [...document.querySelectorAll("details")].find(
		(item) => item.querySelector("summary")?.textContent === "Details",
	);
	expect(details?.textContent).toContain("Model: test/model-x");
	expect(details?.textContent).toContain("Plan settings");
	expect(details?.textContent).toContain("node check.mjs");
	expect(details?.textContent).toContain("No test setup.");
	expect(document.querySelector('input[aria-label="Check name"]')).toBeNull();
	expect(document.body.textContent).not.toContain(
		"How scoping and approval work",
	);
	// Edit plan lives in More, not in Plan settings.
	expect(details?.querySelector("button")?.textContent).not.toBe("Edit plan…");
	await menuItem("Edit plan");
	expect(
		document.querySelector('input[aria-label="Check name"]'),
	).not.toBeNull();
	expect(
		document.querySelector('textarea[aria-label="Design brief"]'),
	).not.toBeNull();
	expect(document.body.textContent).toContain(
		"Editing the plan restarts scoping when you save it.",
	);
	await act(async () => button("Cancel editing").click());
	expect(document.querySelector('input[aria-label="Check name"]')).toBeNull();
});

it("shows the running agent in the status line and its lane in the Agents tab", async () => {
	const startedAt = new Date(Date.now() - 252_000).toISOString();
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			withState({
				phase: "implementing",
				attempts: [attempt("builder-1", "builder", "running", startedAt)],
			}),
		],
	});
	const card: AgendaTaskRecord = {
		...task,
		status: "in_progress",
		currentRunId: run.runId,
		factory: handsOffConfig,
	};
	await render(card);
	const line = () =>
		document.querySelector('[data-testid="factory-live-line"]')?.textContent;
	expect(line()).toContain("Builder · Working");
	expect(line()).toContain("4m 12s");
	await act(async () =>
		emit("chat_event", {
			sessionId: "builder-1",
			stream: "chat_tool_call_start",
			chunk: JSON.stringify({
				toolName: "read_files",
				input: { files: [{ path: "src/api/routes.ts" }] },
			}),
		}),
	);
	expect(line()).toContain("Builder · Reading");
	expect(line()).toContain("routes.ts");
	// Other sessions' events are ignored.
	await act(async () =>
		emit("chat_event", {
			sessionId: "unrelated",
			stream: "chat_tool_call_start",
			chunk: JSON.stringify({ toolName: "run_commands", input: {} }),
		}),
	);
	expect(line()).toContain("routes.ts");
	// No "Watch live" button: the Agents tab is the content.
	expect(() => button("Watch live")).toThrow();
	const lane = () =>
		document.querySelector('[data-testid="factory-agent-lane"]');
	expect(lane()?.getAttribute("data-running")).toBe("true");
	expect(lane()?.textContent).toContain("Builder");
	expect(lane()?.textContent).toContain("Reading");
	expect(lane()?.textContent).toContain("4m");
	await act(async () => button("Open in chat").click());
	expect(onOpenSession).toHaveBeenCalledWith("builder-1");
	expect(
		JSON.parse(sessionStorage.getItem("factory.watchOrigin") ?? ""),
	).toEqual({ sessionId: "builder-1", taskId: task.taskId, title: task.title });
	await act(async () => {
		for (const handler of mocks.transportListeners) handler("reconnecting");
	});
	expect(line()).toContain("Live activity paused: reconnecting");
	await act(async () => {
		for (const handler of mocks.transportListeners) handler("connected");
	});
	await act(async () => emit("chat_session_ended", { sessionId: "builder-1" }));
	expect(line()).toContain("Builder finished");
	// The finished lane folds to one line; the tab says the last fact.
	expect(lane()?.getAttribute("data-running")).toBeNull();
	expect(lane()?.textContent).toContain("Builder finished");
	expect(
		document.querySelector('[data-testid="factory-agents-idle"]')?.textContent,
	).toMatch(/^No agent on this card\. Builder finished \d+s ago\.$/);
});

it("gives parallel sessions a lane each and says when a card waits for a slot", async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			withState({
				phase: "reviewing",
				attempts: [
					attempt("reviewer-1", "reviewer", "running"),
					attempt("reviewer-2", "reviewer", "running"),
				],
			}),
		],
	});
	await render({
		...task,
		status: "in_progress",
		currentRunId: run.runId,
		factory: handsOffConfig,
	});
	expect(
		document.querySelector('[data-testid="factory-live-line"]')?.textContent,
	).not.toContain("more");
	const lanes = [
		...document.querySelectorAll('[data-testid="factory-agent-lane"]'),
	];
	expect(lanes.map((lane) => lane.getAttribute("aria-label"))).toEqual([
		"Show the code reviewer 1's conversation",
		"Show the code reviewer 2's conversation",
	]);
	expect(lanes.every((lane) => lane.hasAttribute("data-running"))).toBe(true);
	// Selecting a lane shows its transcript below.
	expect(lanes[0]?.getAttribute("aria-pressed")).toBe("true");
	await act(async () => (lanes[1] as HTMLElement).click());
	expect(
		document.querySelector(
			'[data-testid="factory-agent-lane"][aria-pressed="true"]',
		)?.textContent,
	).toContain("Code reviewer 2");
	expect(
		document
			.querySelector('[data-testid="factory-live-transcript"]')
			?.getAttribute("aria-label"),
	).toBe("Code reviewer 2 conversation");
	mocks.getFactoryTask.mockResolvedValue({ runs: [] });
	await render({
		...task,
		status: "approved",
		factory: handsOffConfig,
		factoryQueued: "run",
		updatedAt: "2026-01-03T00:00:00Z",
	});
	expect(progress()?.textContent).toContain("Waiting for a free slot");
	expect(document.body.textContent).not.toContain("Watch live");
});

it("puts deterministic checks under Build and Verify only around the verifier agent", async () => {
	const card: AgendaTaskRecord = {
		...task,
		status: "in_progress",
		currentRunId: run.runId,
		factory: handsOffConfig,
	};
	// No verifier configured: no Verify step at all.
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			withState({ phase: "verifying", candidate: undefined, sessions: [] }),
		],
	});
	await render(card);
	expect(progress()?.textContent).toContain("Building · running 1 check");
	// The plan's checks run as part of Build.
	expect(currentStage()).toBe("build:current");
	expect(stationNames()).not.toContain("Verify");
	const verifierCard = {
		...card,
		factory: {
			...handsOffConfig,
			agents: factoryTaskConfigSchema.parse({ agents: { verifier: {} } })
				.agents,
		},
		updatedAt: "2026-01-02T00:00:00Z",
	};
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			withState({ phase: "verifying", candidate: undefined, sessions: [] }),
		],
	});
	await render(verifierCard);
	// The plan's checks run as part of Build.
	expect(currentStage()).toBe("build:current");
	expect(stationNames()).toContain("Verify");
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			withState({
				phase: "verifying",
				attempts: [attempt("verifier-1", "verifier", "running")],
			}),
		],
	});
	await render({ ...verifierCard, updatedAt: "2026-01-03T00:00:00Z" });
	expect(currentStage()).toBe("verify:current");
	expect(progress()?.textContent).toContain("Testing the running app");
	// A check failure stops the Build step.
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			withState({
				phase: "blocked",
				candidate: {
					commit: "candidate",
					reviews: [],
					checks: [
						{
							name: "API",
							command: "node check.mjs",
							kind: "api",
							status: "failed",
							exitCode: 1,
							output: "boom",
							artifacts: [],
						},
					],
				},
			}),
		],
	});
	await render({
		...verifierCard,
		status: "failed",
		updatedAt: "2026-01-04T00:00:00Z",
	});
	expect(progress()?.textContent).toContain("Checks did not pass");
	// The shared line places a stop by what the run recorded (factoryStation);
	// failed checks stop the card at Build.
	expect(currentStage()).toBe("build:stopped");
});

const LONG_LOG = [
	"Required checks did not pass after 2 repair rounds. See the evidence for details.",
	"API: failed (exit 1)",
	"Lint: blocked",
	...Array.from({ length: 300 }, (_, index) =>
		index % 2
			? `--- PASS: TestCase${index} (0.00s)`
			: `=== RUN   TestCase${index}`,
	),
].join("\n");

it("summarizes a stopped card in plain words with Try again and the log collapsed", async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({ phase: "blocked", repairRound: 2, error: LONG_LOG }),
				status: "failed",
			},
		],
	});
	const failed: AgendaTaskRecord = {
		...task,
		status: "failed",
		lastRunId: run.runId,
		error: LONG_LOG,
		factory: handsOffConfig,
		factoryDesignProgress: factoryDesignProgressSchema.parse({
			revision: task.revision,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase: "complete",
			reviewerSessions: [],
			reviews: [],
		}),
	};
	await render(failed);
	const panel = progress()?.textContent ?? "";
	expect(panel).toContain("Stopped after 2 repair attempts");
	expect(
		document.querySelector('[data-testid="factory-failure-reason"]')
			?.textContent,
	).toBe("Required checks did not pass after 2 repair rounds.");
	expect(panel).not.toContain("=== RUN");
	// Raw output is never a red alert; checks are listed and the log is folded.
	expect(document.querySelector('[role="alert"]')).toBeNull();
	const summary = document.querySelector(
		'[aria-label="What stopped this work"]',
	);
	expect(summary?.textContent).toContain("API failed · (exit 1)");
	expect(summary?.textContent).toContain("Lint was blocked");
	const log = document.querySelector('[data-testid="factory-error-log"]');
	expect(log?.closest("details")?.open).toBe(false);
	expect(log?.textContent).toContain("=== RUN   TestCase0");
	expect(button("Copy log")).toBeTruthy();
	// The footer offers only what fits a failure.
	expect(document.body.textContent).not.toContain("Approve and run");
	expect(document.body.textContent).not.toContain("Save brief");
	await act(async () => button("Try again").click());
	expect(mocks.approveAgendaTask).toHaveBeenCalledWith({
		taskId: task.taskId,
		expectedRevision: task.revision,
		allWorkspaces: true,
	});
	// Without a finished plan, trying again restarts scoping.
	await render({
		...failed,
		factoryDesignProgress: undefined,
		lastRunId: undefined,
		error: "Scoping failed: the designer ended without a plan.",
		updatedAt: "2026-01-05T00:00:00Z",
	});
	expect(progress()?.textContent).toContain("Scoping stopped");
	await act(async () => button("Try again").click());
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
	// Try again is the one action; Edit plan moved into More.
	expect(
		[
			...(document
				.querySelector('[data-testid="factory-card-actions"]')
				?.querySelectorAll("button") ?? []),
		].map((item) => item.textContent?.trim()),
	).toEqual(["Try again"]);
	await menuItem("Edit plan");
	expect(
		document.querySelector('textarea[aria-label="Design brief"]'),
	).not.toBeNull();
});

it("restarts scoping when a plan whose checks need fixing is tried again", async () => {
	mocks.getFactoryTask.mockResolvedValue({ runs: [] });
	await render({
		...task,
		status: "failed",
		approvedRevision: task.revision,
		error: "Repair limit (2) reached.",
		factory: {
			...handsOffConfig,
			checks: [
				{
					name: "API",
					command: "node check.mjs | tee /tmp/api.log",
					kind: "test",
					artifacts: ["/tmp/api.log"],
				},
			],
		},
	});
	// Said once: the headline names the fault and the scoping step is marked.
	expect(progress()?.querySelector("strong")?.textContent).toBe(
		"The plan's checks need fixing",
	);
	expect(progress()?.textContent).toContain(
		"Try again sends it back to scoping, or edit the plan.",
	);
	expect(progress()?.textContent).not.toContain("Stopped after");
	expect(
		progress()?.textContent?.split("The plan's checks need fixing").length,
	).toBe(2);
	// A plan fault stops at its checks, part of Build on the shared line.
	expect(currentStage()).toBe("build:stopped");
	await act(async () => button("Try again").click());
	// Re-approving the same plan would fail again at once: scoping restarts.
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
	expect(mocks.approveAgendaTask).not.toHaveBeenCalled();
});

it("says the draft PR could not be opened and stops the line after Review", async () => {
	const reason =
		"The base branch feature is not on GitHub and has unpublished commits. Push it, or start this work from a published branch.";
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "blocked",
					error: reason,
					pullRequestError: reason,
					candidate: {
						commit: "candidate",
						reviews: [],
						checks: [
							{
								name: "API",
								command: "node check.mjs",
								kind: "api",
								status: "passed",
								exitCode: 0,
								output: "ok",
								artifacts: [],
							},
						],
					},
				}),
				status: "failed",
			},
		],
	});
	await render({
		...task,
		status: "failed",
		lastRunId: run.runId,
		error: reason,
		factory: { ...handsOffConfig, publishPullRequest: true },
	});
	expect(progress()?.textContent).toContain("Could not open the draft PR");
	expect(
		document.querySelector('[data-testid="factory-failure-reason"]')
			?.textContent,
	).toBe(reason);
	// A draft PR that could not open stops after Review on the shared line.
	expect(currentStage()).toBe("review:stopped");
});

it("offers Start scoping instead of promising progress for an unqueued hands-off card without a plan", async () => {
	const orphan: AgendaTaskRecord = {
		...task,
		status: "pending_approval",
		approvedRevision: undefined,
		lastRunId: run.runId,
		factory: handsOffConfig,
	};
	mocks.getFactoryTask.mockResolvedValue({ runs: [] });
	await render(orphan);
	expect(progress()?.textContent).not.toContain("Waiting to start");
	expect(progress()?.textContent).not.toContain("Factory continues on its own");
	// One way in: the header's Start, with no Start scoping or approval.
	expect(startButtons()).toEqual(["Start scoping"]);
	expect(() => button("Approve and run")).toThrow();
	expect(progress()?.textContent).toContain("Not started");
	expect(progress()?.textContent).toContain(
		"Factory hasn't scoped this yet. Start scoping to write a plan you can approve.",
	);
	await act(async () => button("Start scoping").click());
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
	await render({
		...orphan,
		factoryQueued: "design",
		updatedAt: "2026-01-06T00:00:00Z",
	});
	expect(progress()?.textContent).toContain("Waiting to start");
	expect(progress()?.textContent).not.toContain("Not started");
});

it("shows a draft PR left open with unresolved review findings as a result to review, not a failure", async () => {
	const worktree = "/data/factory/factory-worktrees/3122/repo";
	const long = `Reviewer 1: Unrelated churn in ${worktree}/apps/desktop/sidecar/server.ts (import reorder) ${"and more formatting ".repeat(12)}`;
	const findings = [
		`Reviewer 1: Redundant gate call in ${worktree}/apps/desktop/sidecar/cloud-handoff.ts.`,
		"Reviewer 1: assertCloudAgentsEnabled evaluates the flag twice.",
		long,
	];
	const url = "https://github.com/example/project/pull/15672";
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "blocked",
					repairRound: 2,
					pullRequestUrl: url,
					unresolvedFindings: {
						commit: "candidate",
						findings,
						pullRequestOpen: true,
					},
					humanReview: { required: true, reason: "review findings unresolved" },
					candidate: {
						commit: "candidate",
						checks: [
							{
								name: "API",
								command: "node check.mjs",
								kind: "api",
								status: "passed",
								exitCode: 0,
								output: "ok",
								artifacts: [],
							},
						],
						reviews: [
							{
								reviewerIndex: 0,
								sessionId: "reviewer",
								review: {
									verdict: "changes_requested",
									summary: "Three findings.",
									findings,
								},
							},
						],
					},
				}),
				status: "failed",
			},
		],
	});
	await render({
		...task,
		status: "failed",
		approvedRevision: task.revision,
		lastRunId: run.runId,
		error: `Repair limit (2) reached; the draft PR stays open with 3 unresolved findings.\n- ${findings[0]}`,
		factory: { ...handsOffConfig, publishPullRequest: true },
	});
	const panel = progress()?.textContent ?? "";
	expect(panel).toContain("Draft PR open · reviewer has 3 unresolved findings");
	expect(panel).not.toContain("Stopped after");
	expect(progress()?.className).not.toContain("destructive");
	expect(
		document.querySelector('[data-testid="factory-failure-reason"]'),
	).toBeNull();
	// Short, repository-relative lines; the full text is folded away.
	const list = document.querySelector('[data-testid="factory-open-findings"]');
	expect(list?.textContent).toContain(
		"Reviewer 1: Redundant gate call in apps/desktop/sidecar/cloud-handoff.ts.",
	);
	expect(list?.textContent).not.toContain("factory-worktrees");
	expect(list?.querySelector("details")?.open).toBe(false);
	expect(list?.querySelector("details")?.textContent).toContain(
		"apps/desktop/sidecar/server.ts (import reorder) and more formatting",
	);
	expect(document.body.textContent).not.toContain("factory-worktrees");
	// The open draft PR is the delivery: the line ends at Delivered, not
	// stopped anywhere.
	expect(currentStage()).toBe("delivered:done");
	expect(
		document.querySelector(
			'[data-testid="factory-card-stations"] [data-state="stopped"]',
		),
	).toBeNull();
	expect(() => button("Try again")).toThrow();
	await act(async () => button("Open draft PR").click());
	expect(openExternalUrl).toHaveBeenCalledWith(url);
	await act(async () => button("Have Factory fix").click());
	expect(mocks.startFactoryQueue).toHaveBeenCalledWith([
		expect.objectContaining({ taskId: task.taskId, revision: task.revision }),
	]);
	await act(async () => button("Accept").click());
	// Accept records the review only, never feedback.
	expect(mocks.invoke).toHaveBeenLastCalledWith("task.factory.stamp", {
		taskId: task.taskId,
		expectedHead: "candidate",
		allWorkspaces: true,
	});
	// Factory's reason sits beside Accept; the proof leads the left column.
	expect(
		document.querySelector('[data-testid="factory-review-reason"]')
			?.textContent,
	).toBe(
		"The reviewer left 3 findings Factory did not fix. Have Factory fix them, or accept as is.",
	);
	expect(
		document.querySelector('[data-testid="factory-proof-open-findings"]')
			?.textContent,
	).toBe("3 reviewer findings left unresolved");
});

it("hands a failed card whose plan is still approved back to the Factory queue on Try again", async () => {
	await render({
		...task,
		status: "failed",
		approvedRevision: task.revision,
		error: "Repair limit (2) reached.",
		factory: handsOffConfig,
	});
	await act(async () => button("Try again").click());
	expect(mocks.startFactoryQueue).toHaveBeenCalledWith([
		expect.objectContaining({ taskId: task.taskId, revision: task.revision }),
	]);
	expect(mocks.approveAgendaTask).not.toHaveBeenCalled();
	expect(mocks.designFactoryTask).not.toHaveBeenCalled();
});

it("restarts scoping on Try again when the last run's check was blocked by its own setup", async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "blocked",
					candidate: {
						commit: "candidate",
						reviews: [],
						checks: [
							{
								name: "API",
								command: "node check.mjs",
								kind: "api",
								status: "blocked",
								blockedBy: "configuration",
								exitCode: 1,
								output: "",
								artifacts: [],
							},
						],
					},
				}),
				status: "failed",
			},
		],
	});
	await render({
		...task,
		status: "failed",
		approvedRevision: task.revision,
		lastRunId: run.runId,
		error: "Check API was blocked.",
		factory: handsOffConfig,
	});
	expect(progress()?.textContent).toContain(
		"Try again sends it back to scoping, or edit the plan.",
	);
	await act(async () => button("Try again").click());
	expect(mocks.designFactoryTask).toHaveBeenCalledWith(task.taskId);
	expect(mocks.startFactoryQueue).not.toHaveBeenCalled();
});

it("offers Edit plan, not Try again, when Factory could not fix the plan's checks itself", async () => {
	await render({
		...task,
		status: "failed",
		approvedRevision: task.revision,
		error:
			'The plan\'s checks still need fixing: Check "API" artifact "/tmp/api.log" is an absolute path outside the task worktree.',
		factory: handsOffConfig,
	});
	expect(progress()?.textContent).toContain(
		"Factory could not fix the plan's checks on its own. Edit the plan to fix them.",
	);
	expect(progress()?.textContent).not.toContain("Try again sends it back");
	expect(() => button("Try again")).toThrow();
	expect(button("Edit plan")).toBeTruthy();
});

it("edits a check's evidence paths in Edit plan, flags absolute paths before saving, and re-queues scoping", async () => {
	const faulty: AgendaTaskRecord = {
		...task,
		status: "failed",
		approvedRevision: task.revision,
		error: "Repair limit (2) reached.",
		factory: {
			...handsOffConfig,
			checks: [
				{
					name: "API",
					command: "node check.mjs | tee /tmp/api.log",
					kind: "test",
					artifacts: ["/tmp/api.log"],
				},
			],
		},
	};
	await render(faulty);
	await menuItem("Edit plan");
	// Cancel editing is the plan's action now; the header drops Edit plan.
	expect(button("Cancel editing")).toBeTruthy();
	expect(() => button("Edit plan")).toThrow();
	const pathInput = () =>
		document.querySelector<HTMLInputElement>(
			'input[aria-label="Evidence path"]',
		);
	expect(pathInput()?.value).toBe("/tmp/api.log");
	expect(pathInput()?.getAttribute("aria-invalid")).toBe("true");
	expect(
		document.querySelector('[aria-label="Problems with API"]')?.textContent,
	).toContain(
		'Check "API" artifact "/tmp/api.log" is an absolute path outside the task worktree.',
	);
	const setInput = async (input: HTMLInputElement | null, value: string) => {
		if (!input) throw new Error("Missing input");
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(input, value);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	};
	await setInput(pathInput(), "../api.log");
	expect(
		document.querySelector('[aria-label="Problems with API"]')?.textContent,
	).toContain('Check "API" artifact "../api.log" escapes the task worktree.');
	expect(button("Save plan").disabled).toBe(true);
	// Removing the path and fixing the command clears the problem.
	await act(async () =>
		document
			.querySelector<HTMLButtonElement>(
				'button[aria-label="Remove evidence path ../api.log"]',
			)
			?.click(),
	);
	expect(pathInput()).toBeNull();
	// The command is a multi-line field.
	const command = document.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Check command"]',
	);
	if (!command) throw new Error("Missing command");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(command, "node check.mjs");
		command.dispatchEvent(new Event("input", { bubbles: true }));
	});
	expect(document.querySelector('[aria-label="Problems with API"]')).toBeNull();
	mocks.updateAgendaTask.mockResolvedValueOnce({
		...faulty,
		revision: 2,
		factoryQueued: "design",
	});
	await act(async () => button("Save plan").click());
	expect(mocks.updateAgendaTask).toHaveBeenCalledWith(
		expect.objectContaining({
			taskId: task.taskId,
			factory: expect.objectContaining({
				checks: [
					expect.objectContaining({
						name: "API",
						command: "node check.mjs",
						artifacts: [],
					}),
				],
			}),
		}),
	);
	await render({
		...faulty,
		status: "pending_approval",
		error: undefined,
		revision: 2,
		factoryQueued: "design",
		factory: {
			...handsOffConfig,
			checks: [
				{ name: "API", command: "node check.mjs", kind: "test", artifacts: [] },
			],
		},
		updatedAt: "2026-01-07T00:00:00Z",
	});
	expect(document.body.textContent).toContain(
		"Saved. Sending it back to scoping.",
	);
	expect(progress()?.textContent).toContain("Waiting to start");
});

it.each([
	["a candidate that passed everything and has no PR", undefined],
	[
		"an older run's publish error",
		"Could not confirm the draft PR: GitHub did not answer. Try again in a minute.",
	],
])("says the draft PR could not be opened for %s", async (_label, error) => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "blocked",
					...(error ? { error } : {}),
					candidate: {
						commit: "candidate",
						checks: [
							{
								name: "API",
								command: "node check.mjs",
								kind: "api",
								status: "passed",
								exitCode: 0,
								output: "ok",
								artifacts: [],
							},
						],
						reviews: [
							{
								reviewerIndex: 0,
								sessionId: "reviewer",
								review: {
									verdict: "pass",
									summary: "Fine.",
									findings: [],
								},
							},
						],
					},
				}),
				status: "failed",
			},
		],
	});
	await render({
		...task,
		status: "failed",
		lastRunId: run.runId,
		error: error ?? "The run stopped.",
		factory: { ...handsOffConfig, publishPullRequest: true },
	});
	expect(progress()?.querySelector("strong")?.textContent).toBe(
		"Could not open the draft PR",
	);
	// The shared line places it by the recorded error: Review when it names
	// publishing, else Build.
	expect(currentStage()).toBe(error ? "review:stopped" : "build:stopped");
	if (error)
		expect(
			document.querySelector('[data-testid="factory-failure-reason"]')
				?.textContent,
		).toBe("GitHub did not answer.");
});

it("notes in Details when the run was built from the published default branch", async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			withState({
				phase: "implementing",
				workspace: {
					path: "/candidate",
					branch: "feat/example",
					baseBranch: "main",
					baseCommit: "base",
					baseSource: "remote_default",
				},
			}),
		],
	});
	await render({
		...task,
		status: "in_progress",
		lastRunId: run.runId,
		currentRunId: run.runId,
		factory: handsOffConfig,
	});
	expect(document.body.textContent).toContain(
		"Built from the published default branch (main), not your local branch.",
	);
});

it("asks for review on a hands-off result core marked as needing it: Accept with the reason beside it", async () => {
	const delivered = withState({
		phase: "ready",
		pullRequestUrl: "https://github.com/example/repo/pull/7",
		inputSnapshot: undefined,
		humanReview: { required: true, reason: "shared contract" },
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...delivered, status: "completed" }],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
	expect(progress()?.textContent).toContain("Needs your review");
	expect(
		document.querySelector('[data-testid="factory-review-reason"]')
			?.textContent,
	).toBe("Factory asks for your review: touches a shared contract.");
	// Accept is the one primary action; the draft PR is a quiet secondary.
	const actions = [
		...(document
			.querySelector('[data-testid="factory-card-actions"]')
			?.querySelectorAll("button") ?? []),
	];
	expect(actions.map((item) => item.textContent?.trim())).toEqual([
		"Accept",
		"Open draft PR",
	]);
	// Accept replaces both "Mark as reviewed" and the thumbs-up.
	expect(document.body.textContent).not.toContain("Mark as reviewed");
	expect(() => button("Good")).toThrow();
	expect(button("Something's off…")).toBeTruthy();
	expect(document.querySelector('[data-testid="factory-footer"]')).toBeNull();
	// No merge or un-draft action is offered.
	expect(document.body.textContent).not.toMatch(/Merge|Ready for review/);
	mocks.invoke.mockClear();
	await act(async () => button("Accept").click());
	// Accept stamps only: no "looks good" is recorded for the person.
	expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
		"task.factory.stamp",
	]);
	expect(mocks.invoke).toHaveBeenCalledWith("task.factory.stamp", {
		taskId: task.taskId,
		expectedHead: "candidate",
		allWorkspaces: true,
	});
});

it("keeps Accept on a delivery that needs review after a note", async () => {
	const delivered = withState({
		phase: "ready",
		pullRequestUrl: "https://github.com/example/repo/pull/7",
		inputSnapshot: undefined,
		humanReview: { required: true, reason: "shared contract" },
		audit: {
			selectedAt: "2026-11-11T00:00:00.000Z",
			finding: "The empty state copy is wrong.",
			reviewedAt: "2026-11-11T00:00:00.000Z",
		},
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...delivered, status: "completed" }],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
	// The note is optional feedback: the review is still the person's to give.
	expect(progress()?.textContent).toContain("Needs your review");
	expect(button("Accept")).toBeTruthy();
});

it("shows why Accept's review stamp failed", async () => {
	const delivered = withState({
		phase: "ready",
		pullRequestUrl: "https://github.com/example/repo/pull/7",
		inputSnapshot: undefined,
		humanReview: { required: true, reason: "shared contract" },
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...delivered, status: "completed" }],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
	mocks.invoke.mockClear();
	mocks.invoke.mockRejectedValueOnce(new Error("Checks still pending"));
	await act(async () => button("Accept").click());
	expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
		"task.factory.stamp",
	]);
	expect(document.querySelector('[role="alert"]')?.textContent).toContain(
		"Checks still pending",
	);
});

it("ends a sampled result at the draft PR, even on a manual card", async () => {
	const delivered = withState({
		phase: "ready",
		pullRequestUrl: "https://github.com/example/repo/pull/7",
		inputSnapshot: undefined,
		humanReview: { required: false, reason: "local change" },
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...delivered, status: "completed" }],
	});
	await render({ ...task, status: "completed", lastRunId: run.runId });
	expect(document.querySelector('[aria-label="Proof"]')).not.toBeNull();
	expect(button("Good")).toBeTruthy();
	expect(() => button("Accept")).toThrow();
	expect(progress()?.textContent).toContain("Draft PR ready");
	expect(button("Open draft PR")).toBeTruthy();
});

it("calls only the automatic retry itself Retrying in the card header", async () => {
	const recovery = {
		attempts: 1,
		reason: "Provider unavailable",
		at: "2026-01-01T00:05:00Z",
	};
	const runAt = (runId: string, createdAt: string, status: string) => ({
		...withState({ phase: "implementing", autoRecovery: recovery }),
		runId,
		createdAt,
		status: status as AgendaTaskRunRecord["status"],
	});
	const card: AgendaTaskRecord = {
		...task,
		status: "in_progress",
		factory: handsOffConfig,
		currentRunId: "run-2",
		lastRunId: "run-2",
	};
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			runAt("run-1", "2026-01-01T00:00:00Z", "failed"),
			runAt("run-2", "2026-01-01T00:06:00Z", "running"),
		],
	});
	await render(card);
	expect(progress()?.textContent).toContain("Retrying after failure (1/1)");

	// A manual Try again after the retry failed inherits the recovery record.
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			runAt("run-1", "2026-01-01T00:00:00Z", "failed"),
			runAt("run-2", "2026-01-01T00:06:00Z", "failed"),
			runAt("run-3", "2026-01-01T00:09:00Z", "running"),
		],
	});
	await render({
		...card,
		currentRunId: "run-3",
		lastRunId: "run-3",
		updatedAt: "2026-01-01T00:09:00Z",
	});
	expect(progress()?.textContent).not.toContain("Retrying");
	expect(progress()?.textContent).toContain("Building");
});

it("marks a card Factory filed for a recurring review pattern", async () => {
	await render({
		...task,
		factory: {
			...handsOffConfig,
			intake: { source: "factory:repo-rules", key: "no-unchecked-any" },
		},
	});
	expect(document.body.textContent).toContain("Suggested by Factory");
	expect(document.body.textContent).toContain(
		"Factory filed this because reviewers saw the same pattern in more than one card.",
	);
	await render(task);
	expect(document.body.textContent).not.toContain("Suggested by Factory");
});

it("shows the verification setup and its dry run in Details", async () => {
	const hash = "e".repeat(64);
	const delivered = withState({
		phase: "ready",
		inputSnapshot: undefined,
		verificationProfile: {
			hash,
			preflight: "failed",
			stage: "start",
			detail: "port in use",
		},
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...delivered, status: "completed" }],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: {
			...handsOffConfig,
			verificationProfile: {
				hash,
				origin: "proposed",
				profile: {
					schemaVersion: 1,
					environment: { start: "bun run dev" },
					exercise: "Open the app.",
					artifacts: [],
				},
			},
		},
	});
	const setup = document.querySelector('[aria-label="Test setup"]');
	expect(setup?.textContent).toContain(
		"Proposed by this plan: reviewed before it runs",
	);
	expect(setup?.textContent).toContain("Startbun run dev");
	expect(setup?.textContent).toContain("Dry run failed at start");
	expect(document.body.textContent).not.toContain("No test setup.");
});

async function openPanelTab(name: string) {
	await act(async () => {
		const item = panelTab(name);
		item.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
		item.click();
	});
}
const diffCalls = () =>
	mocks.invoke.mock.calls.filter(([command]) => command === "factory_get_diff");
const failedCheck = {
	name: "API",
	command: "node check.mjs",
	kind: "api",
	status: "failed",
	exitCode: 1,
	output: "boom: expected 200",
	artifacts: [
		{ path: "api.png", label: "API screenshot", mimeType: "image/png" },
	],
};

it("opens the artifact panel on the tab that fits the stage, and hides it before hands-off work starts", async () => {
	// Not started: no panel.
	await render({
		...task,
		status: "pending_approval",
		factory: handsOffConfig,
	});
	expect(
		document.querySelector('[data-testid="factory-artifact-panel"]'),
	).toBeNull();
	// Building: Live, with the builder's transcript and nothing fetched.
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			withState({
				phase: "implementing",
				candidate: undefined,
				attempts: [attempt("builder-1", "builder", "running")],
			}),
		],
	});
	await render({
		...task,
		status: "in_progress",
		currentRunId: run.runId,
		factory: handsOffConfig,
		updatedAt: "2026-01-02T00:00:00Z",
	});
	expect(panelTab("Agents").getAttribute("aria-selected")).toBe("true");
	expect(
		document.querySelector('[data-testid="factory-live-transcript"]'),
	).not.toBeNull();
	expect(diffCalls()).toHaveLength(0);
	// Failed: Checks, with output in the tool-output block, not <details><pre>.
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "blocked",
					candidate: {
						commit: "candidate",
						reviews: [],
						checks: [failedCheck],
					},
				}),
				status: "failed",
			},
		],
	});
	await render({
		...task,
		status: "failed",
		lastRunId: run.runId,
		currentRunId: undefined,
		factory: handsOffConfig,
		updatedAt: "2026-01-03T00:00:00Z",
	});
	expect(panelTab("Checks").getAttribute("aria-selected")).toBe("true");
	const output = document.querySelector('[data-testid="factory-check-output"]');
	expect(output?.tagName).toBe("PRE");
	expect(output?.className).toContain("cline-chat-tool-code");
	expect(output?.textContent).toBe("boom: expected 200");
	expect(output?.closest("details")).toBeNull();
	const panel = document.querySelector(
		'[data-testid="factory-artifact-panel"]',
	);
	expect(panel?.querySelector("details pre")).toBeNull();
	expect(diffCalls()).toHaveLength(0);
	// Screenshots open in the lightbox; the card never shows bare media.
	mocks.invoke.mockResolvedValueOnce({ dataUrl: "data:image/png;base64,AA" });
	await act(async () => button("API screenshot").click());
	expect(mocks.invoke).toHaveBeenCalledWith("factory_read_artifact", {
		taskId: task.taskId,
		runId: run.runId,
		path: "api.png",
	});
	expect(panel?.querySelector("img, video")).toBeNull();
	const lightbox = document.querySelector(
		'[data-testid="factory-evidence-lightbox"]',
	);
	expect(lightbox?.querySelector("img")?.getAttribute("alt")).toBe(
		"API screenshot",
	);
	await act(async () =>
		(
			lightbox?.querySelector(
				'button[aria-label="Close image viewer"]',
			) as HTMLButtonElement
		).click(),
	);
	expect(
		document.querySelector('[data-testid="factory-evidence-lightbox"]'),
	).toBeNull();
});

it("loads the candidate's diff only when Changes opens, pinned to its commit", async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "blocked",
					candidate: {
						commit: "candidate",
						reviews: [],
						checks: [failedCheck],
					},
				}),
				status: "failed",
			},
		],
	});
	await render({
		...task,
		status: "failed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
	expect(panelTab("Checks").getAttribute("aria-selected")).toBe("true");
	expect(diffCalls()).toHaveLength(0);
	mocks.invoke.mockImplementation(async (command: string) =>
		command === "factory_get_diff"
			? [{ path: "src/search.ts", additions: 2, deletions: 1, hunks: [] }]
			: [],
	);
	await openPanelTab("Changes");
	expect(diffCalls()).toEqual([
		[
			"factory_get_diff",
			{ taskId: task.taskId, runId: run.runId, expectedCommit: "candidate" },
		],
	]);
	const panel = document.querySelector(
		'[data-testid="factory-artifact-panel"]',
	);
	expect(panel?.textContent).toContain("Feature changes");
	expect(panel?.textContent).toContain("src/search.ts");
	// The old inline diff box is gone.
	expect(document.querySelector(".h-\\[32rem\\]")).toBeNull();
	// A failed read stays in the tab with a retry.
	mocks.invoke.mockImplementation(async (command: string) => {
		if (command === "factory_get_diff") throw new Error("Commit moved");
		return [];
	});
	await openPanelTab("Checks");
	await openPanelTab("Changes");
	expect(panel?.querySelector('[role="alert"]')?.textContent).toBe(
		"Commit moved",
	);
	// It reloads the diff only, so it is not called Try again.
	expect(button("Reload changes")).toBeTruthy();
	// The user's choice is kept for the card and wins over the default.
	expect(sessionStorage.getItem("factory.panelTab.feature")).toBe("changes");
	await render({
		...task,
		status: "failed",
		lastRunId: run.runId,
		factory: handsOffConfig,
		updatedAt: "2026-01-02T00:00:00Z",
	});
	expect(panelTab("Changes").getAttribute("aria-selected")).toBe("true");
});

const passingReview = {
	reviewerIndex: 0,
	sessionId: "reviewer",
	review: { verdict: "pass", summary: "Looks right.", findings: [] },
};

it("hides a tab with nothing in it and never opens on it", async () => {
	// The user last chose Review; this card's PR has no CI or code review yet.
	sessionStorage.setItem("factory.panelTab.feature", "pr");
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "ready",
					pullRequestUrl: "https://github.com/example/repo/pull/7",
				}),
				status: "completed",
			},
		],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
	const tabs = [
		...document.querySelectorAll(
			'[data-testid="factory-artifact-panel"] [role="tab"]',
		),
	].map((item) => item.textContent);
	expect(tabs).toEqual(["Agents", "Changes", "Checks"]);
	// The delivered card's default, not the hidden choice.
	expect(panelTab("Changes").getAttribute("aria-selected")).toBe("true");
	// The header opens the PR; the panel does not repeat it.
	expect(
		[...document.querySelectorAll("button")].filter(
			(item) => item.textContent?.trim() === "Open draft PR",
		),
	).toHaveLength(1);
});

it("restores a chosen panel tab over the stage default and returns focus on Esc", async () => {
	sessionStorage.setItem("factory.panelTab.feature", "pr");
	const delivered = withState({
		phase: "ready",
		pullRequestUrl: "https://github.com/example/repo/pull/7",
		inputSnapshot: undefined,
		candidate: { ...run.factory?.candidate, reviews: [passingReview] },
	});
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...delivered, status: "completed" }],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
	expect(panelTab("Review").getAttribute("aria-selected")).toBe("true");
	expect(diffCalls()).toHaveLength(0);
	const tabItem = panelTab("Review");
	tabItem.focus();
	await act(async () => {
		tabItem.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	expect(document.activeElement).toBe(
		document.querySelector('[data-testid="factory-card-main"]'),
	);
});

it("lists open findings above the diff once, with the actions only in the header", async () => {
	const findings = ["Reviewer 1: Redundant gate call in src/gate.ts."];
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "blocked",
					repairRound: 2,
					pullRequestUrl: "https://github.com/example/repo/pull/9",
					unresolvedFindings: {
						commit: "candidate",
						findings,
						pullRequestOpen: true,
					},
					candidate: {
						commit: "candidate",
						checks: [],
						reviews: [
							{
								reviewerIndex: 0,
								sessionId: "reviewer",
								review: {
									verdict: "changes_requested",
									summary: "One finding.",
									findings,
								},
							},
						],
					},
				}),
				status: "failed",
			},
		],
	});
	await render({
		...task,
		status: "failed",
		approvedRevision: task.revision,
		lastRunId: run.runId,
		error: "Repair limit (2) reached; the draft PR stays open.",
		factory: { ...handsOffConfig, publishPullRequest: true },
	});
	expect(panelTab("Changes").getAttribute("aria-selected")).toBe("true");
	const panel = document.querySelector(
		'[data-testid="factory-artifact-panel"]',
	);
	// The list moved from the header to the panel; the header keeps the actions.
	expect(
		progress()?.querySelector('[data-testid="factory-open-findings"]'),
	).toBeNull();
	expect(
		panel?.querySelector('[data-testid="factory-open-findings"]')?.textContent,
	).toContain("Redundant gate call in src/gate.ts.");
	await openPanelTab("Review");
	// The findings are listed once, above the diff; Review has the code review.
	expect(panel?.textContent).not.toContain(
		"Draft PR open · reviewer has 1 unresolved finding",
	);
	expect(panel?.textContent).toContain("Code review");
	// One place for the actions: the header.
	const actions = [...(panel?.querySelectorAll("button") ?? [])].map((item) =>
		item.textContent?.trim(),
	);
	expect(actions).not.toContain("Have Factory fix");
	expect(actions).not.toContain("Accept");
	const header = [
		...(document
			.querySelector('[data-testid="factory-card-actions"]')
			?.querySelectorAll("button") ?? []),
	].map((item) => item.textContent?.trim());
	expect(header).toEqual(["Accept", "Have Factory fix", "Open draft PR"]);
});

it("joins the panel's tabs with the card's section tabs on a narrow card", async () => {
	await atCardWidth(600, async () => {
		mocks.getFactoryTask.mockResolvedValue({ runs: [run] });
		await render({ ...task, status: "completed", lastRunId: run.runId });
		const lists = document.querySelectorAll('[role="tablist"]');
		expect(lists).toHaveLength(1);
		expect(
			[...(lists[0]?.querySelectorAll('[role="tab"]') ?? [])].map(
				(item) => item.textContent,
			),
		).toEqual(["Plan", "Verification", "Agents", "Changes", "Checks"]);
		await openPanelTab("Checks");
		expect(panelTab("Checks").getAttribute("aria-selected")).toBe("true");
		expect(document.body.textContent).toContain(
			"Open agent verification session",
		);
		await openPanelTab("Plan");
		expect(panelTab("Plan").getAttribute("aria-selected")).toBe("true");
		expect(document.body.textContent).toContain("Search plan");
	});
});

it("leads the card's title with its short id", async () => {
	await render({ ...task, factoryNumber: 42 });
	const title = document.querySelector("h1");
	// First, so a wrapping title never leaves the id alone on a line.
	expect(title?.textContent).toBe(`F42${task.title}`);
	expect(title?.querySelector("[data-factory-id]")?.textContent).toBe("F42");
});

/** Measures every card at `width` while `body` runs. */
async function atCardWidth(width: number, body: () => Promise<void>) {
	const measured = vi
		.spyOn(HTMLElement.prototype, "getBoundingClientRect")
		.mockReturnValue({ width, height: 0 } as DOMRect);
	try {
		await body();
	} finally {
		measured.mockRestore();
	}
}
const deliveredHandsOff = async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [{ ...withState({ phase: "ready" }), status: "completed" }],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
};
const card = () => document.querySelector('[data-testid="factory-card"]');
const cardMain = () =>
	document.querySelector('[data-testid="factory-card-main"]');
const artifactPanel = () =>
	document.querySelector('[data-testid="factory-artifact-panel"]');
const SPLIT_HEIGHT =
	"@min-[700px]:h-[calc(100dvh_-_var(--window-title-bar-height)_-_5rem_-_var(--factory-card-title)_-_1.25rem)]";

it("splits the card into two columns from 700px, each exactly as tall as the visible page", async () => {
	await deliveredHandsOff();
	expect(card()?.getAttribute("data-layout")).toBe("two-column");
	// The title row spans the card above its two columns.
	expect(card()?.firstElementChild?.querySelector("h1")?.textContent).toContain(
		task.title,
	);
	const grid = card()?.children[1];
	// A 320-380px column from 700px of card width, 360-420px from 1000px.
	expect(grid?.className).toContain(
		"@min-[700px]:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]",
	);
	expect(grid?.className).toContain(
		"@min-[1000px]:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]",
	);
	expect(grid?.className).not.toContain("1100px");
	// Sized from the title bar, the page padding and the title row above
	// them, so the page itself does not scroll; only the columns do.
	for (const column of [cardMain(), artifactPanel()]) {
		expect(column?.className).toContain(SPLIT_HEIGHT);
		expect(column?.className).toContain("@min-[700px]:sticky");
		expect(column?.className).toContain("@min-[700px]:overscroll-contain");
		expect(column?.className).not.toContain("100dvh-5rem");
	}
	expect(cardMain()?.className).toContain("@min-[700px]:overflow-y-auto");
	expect(grid?.lastElementChild).toBe(artifactPanel());
});

it("leaves room for the title row above the two columns, so the page does not scroll", async () => {
	const measured = vi
		.spyOn(HTMLElement.prototype, "getBoundingClientRect")
		.mockReturnValue({ width: 900, height: 64 } as DOMRect);
	try {
		await deliveredHandsOff();
		expect(card()?.getAttribute("data-layout")).toBe("two-column");
		expect(
			(card() as HTMLElement | null)?.style.getPropertyValue(
				"--factory-card-title",
			),
		).toBe("64px");
	} finally {
		measured.mockRestore();
	}
});

it("puts the panel right after the status on a one-column card", async () => {
	await atCardWidth(600, async () => {
		await deliveredHandsOff();
		expect(card()?.getAttribute("data-layout")).toBe("stacked");
		const panel = artifactPanel();
		const plan = document.querySelector('[aria-label="Brief"]');
		expect(panel && cardMain()?.contains(panel)).toBe(true);
		expect(panel?.className).not.toContain(SPLIT_HEIGHT);
		// Status, then the diff, then the plan.
		if (!panel || !plan) throw new Error("Missing panel or plan");
		expect(
			(progress()?.compareDocumentPosition(panel) ?? 0) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			panel.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});

it("opens a narrow manual card on its panel tab, not on the plan", async () => {
	await atCardWidth(600, async () => {
		mocks.getFactoryTask.mockResolvedValue({ runs: [run] });
		await render({ ...task, status: "completed", lastRunId: run.runId });
		const selected = document.querySelector(
			'[role="tablist"] [role="tab"][aria-selected="true"]',
		);
		expect(["Agents", "Changes", "Checks", "PR"]).toContain(
			selected?.textContent,
		);
	});
});

it("pins the action footer to the bottom of the column, inside its width, with a full border", async () => {
	await render(task);
	const footer = document.querySelector('[data-testid="factory-footer"]');
	expect(footer?.textContent).toContain("Approve and run");
	for (const name of ["sticky", "bottom-0", "mt-auto", "rounded-lg", "border"])
		expect(footer?.className.split(" ")).toContain(name);
	for (const name of ["-mx-2", "border-b-0", "rounded-t-xl"])
		expect(footer?.className.split(" ")).not.toContain(name);
	expect(footer?.parentElement).toBe(cardMain());
});

it("reads a manual card with no plan yet as Not started, with one Start", async () => {
	await render({
		...task,
		status: "pending_approval",
		factory: factoryTaskConfigSchema.parse({
			...task.factory,
			reviewMode: "adaptive",
		}),
	});
	expect(progress()?.querySelector("strong")?.textContent).toBe("Not started");
	expect(document.body.textContent).not.toContain("Plan not ready to approve");
	expect(document.body.textContent).not.toContain("adaptive design");
	expect(startButtons()).toEqual(["Start scoping"]);
	expect(() => button("Approve and run")).toThrow();
	expect(progress()?.textContent).toContain("Factory hasn't scoped this yet.");
});

it("states core's adaptive-design blocker in plain words", async () => {
	await render({
		...task,
		factory: factoryTaskConfigSchema.parse({
			...task.factory,
			reviewMode: "adaptive",
		}),
	});
	expect(document.body.textContent).toContain(
		"Scoping has not chosen reviewers for this plan yet.",
	);
	expect(document.body.textContent).not.toContain(
		"Complete adaptive design and reviewer selection",
	);
});

it("does not call a reviewed result ready again", async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...run,
				factory: factoryRunStateSchema.parse({
					...run.factory,
					humanApproval: {
						commit: "candidate",
						approvedAt: "2026-01-01T00:01:00Z",
					},
				}),
			},
		],
	});
	await render({ ...task, status: "completed", lastRunId: run.runId });
	expect(progress()?.querySelector("strong")?.textContent).toBe("Reviewed");
	expect(progress()?.textContent).toContain("You accepted this delivery.");
	expect(progress()?.textContent).not.toContain("Ready for you");
	expect(() => button("Accept")).toThrow();
	// Delivered without a PR: the header's action shows the changes.
	await act(async () => button("View changes").click());
	expect(panelTab("Changes").getAttribute("aria-selected")).toBe("true");
});

it("counts agent runs in plain words, singular for one", async () => {
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "ready",
					attempts: [attempt("builder-1", "builder", "completed")],
				}),
				status: "completed",
			},
		],
	});
	await render({ ...task, status: "completed", lastRunId: run.runId });
	expect(document.body.textContent).toContain("1 agent run");
	expect(document.body.textContent).not.toContain("execution attempts");
	expect(document.body.textContent).not.toContain("1 agent runs");
});

it("keeps workflow comparison out of a running card and puts it, refresh, version and worktree under More → Details", async () => {
	mocks.getFactoryTask.mockResolvedValue({ runs: [run] });
	await render({ ...task, status: "in_progress", lastRunId: run.runId });
	expect(document.body.textContent).not.toContain(
		"Try this work with other models",
	);
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		updatedAt: "2026-01-03T00:00:00Z",
	});
	const details = document.querySelector<HTMLDetailsElement>(
		'[data-testid="factory-details"]',
	);
	expect(details?.tagName).toBe("DETAILS");
	expect(details?.open).toBe(false);
	expect(details?.querySelector("summary")?.textContent).toBe("Details");
	const inside = details?.textContent ?? "";
	expect(inside).toContain("Try this work with other models");
	expect(inside).toContain("Run it again with other models…");
	expect(inside).toContain("Plan version 1 · Attempt 1");
	expect(inside).toContain("Refresh results");
	expect(inside).toContain("/candidate");
	expect(
		details?.querySelector('button[aria-label="Copy worktree path"]'),
	).not.toBeNull();
	// None of it shows outside Details.
	const outside = (document.body.textContent ?? "").replace(inside, "");
	for (const text of [
		"Try this work with other models",
		"Refresh results",
		"Plan version",
		"/candidate",
	])
		expect(outside).not.toContain(text);
	// Details is opened in place; More has no second way to it.
	await expect(menuItem("Details")).rejects.toThrow("Missing menu item");
});

it("leaves a delivered card's requirements to its proof receipt", async () => {
	const criteria = task.factory?.acceptanceCriteria;
	mocks.getFactoryTask.mockResolvedValue({
		runs: [
			{
				...withState({
					phase: "ready",
					inputSnapshot: {
						scope: "workspace",
						workspaceRoot: "/repo",
						title: task.title,
						instructions: task.instructions,
						resourcePaths: [],
						factory: { ...handsOffConfig, acceptanceCriteria: criteria },
					},
				}),
				status: "completed",
			},
		],
	});
	await render({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factory: handsOffConfig,
	});
	const plan = document.querySelector('[aria-label="Brief"]');
	expect(plan?.querySelector('[aria-label="Acceptance results"]')).toBeNull();
	expect(plan?.textContent).not.toContain("Acceptance criteria");
});

it("does not repeat the title as the brief's first heading", async () => {
	await render({
		...task,
		instructions: `# ${task.title}\n\nUse **titles**.`,
	});
	const headings = [...document.querySelectorAll("h1, h2")].map(
		(item) => item.textContent,
	);
	expect(headings.filter((text) => text === task.title)).toHaveLength(1);
	expect(document.body.textContent).toContain("Use titles.");
	// Only display changes: the saved brief keeps its heading.
	await act(async () => button("Edit").click());
	expect(
		document.querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Design brief"]',
		)?.value,
	).toBe(`# ${task.title}\n\nUse **titles**.`);
});

it("strips only a leading heading that matches the title", async () => {
	const { factoryBriefWithoutTitle } = await import("./factory-detail");
	expect(
		factoryBriefWithoutTitle("# Search notes!\n\nBody", "Search notes"),
	).toBe("Body");
	expect(
		factoryBriefWithoutTitle("## search  NOTES\nBody", "Search notes"),
	).toBe("Body");
	expect(factoryBriefWithoutTitle("# Other plan\n\nBody", "Search notes")).toBe(
		"# Other plan\n\nBody",
	);
	expect(factoryBriefWithoutTitle("Body\n# Search notes", "Search notes")).toBe(
		"Body\n# Search notes",
	);
});

describe("feedback analysis on a delivered card", () => {
	const note = "Empty titles still match.";
	const proposal = {
		role: "reviewer",
		scope: "user",
		change: { topic: "Empty titles", text: "Check empty titles." },
		baseHash: "h1",
		hash: "h2",
		diff: "--- a/factory-guidance/reviewer.md\n+++ b/factory-guidance/reviewer.md\n@@ -0,0 +1,2 @@\n+## Empty titles\n+Check empty titles.\n",
		summary: 'Added "Empty titles"',
	};
	const card = (): AgendaTaskRecord => ({
		...task,
		status: "completed",
		lastRunId: run.runId,
		factoryNumber: 12,
		factory: handsOffConfig,
	});
	async function renderAnalysis(
		analysis: Record<string, unknown> | undefined,
		finding = note,
	) {
		mocks.getFactoryTask.mockResolvedValue({
			runs: [
				{
					...withState({
						phase: "blocked",
						error: `Human sample finding: ${finding}`,
						pullRequestUrl: "https://github.com/example/repo/pull/7",
						audit: {
							selectedAt: "2026-01-02T00:00:00Z",
							reviewedAt: "2026-01-02T00:00:00Z",
							finding,
							...(analysis ? { analysis } : {}),
						},
					}),
					status: "completed",
				},
			],
		});
		await render(card());
	}
	const row = () => document.querySelector('[aria-label="Feedback"]');
	const rowButtons = () =>
		[...(row()?.querySelectorAll("button") ?? [])].map((item) =>
			item.textContent?.trim(),
		);
	const startedAt = new Date().toISOString();

	it("shows the note and that Factory is checking it", async () => {
		await renderAnalysis({ status: "running", trigger: "feedback", startedAt });
		expect(row()?.textContent).toContain(note);
		expect(row()?.textContent).toContain("Checking what Factory missed…");
		expect(rowButtons()).toEqual([]);
		expect(document.body.textContent).not.toContain("Fix this in Factory");
	});

	it("offers the proposed rule's exact diff with Save, Discard and Discuss", async () => {
		const discussed: unknown[] = [];
		const stop = subscribeFactoryDiscussion((request) =>
			discussed.push(request),
		);
		await renderAnalysis({
			status: "proposed",
			trigger: "feedback",
			startedAt,
			completedAt: startedAt,
			summary: "Code review passed a search that matched empty titles.",
			responsible: "reviewer",
			evidence: ["Reviewer 1: pass. Looks good."],
			proposal,
		});
		const text = row()?.textContent ?? "";
		expect(text).toContain(
			"Code review passed a search that matched empty titles.",
		);
		expect(text).toContain("Code reviewer guidance · all your projects");
		expect(text).toContain("Reviewer 1: pass. Looks good.");
		expect(text).toContain("2 lines added, 0 removed");
		expect(
			row()
				?.querySelector('[data-testid="tool-file-diff"]')
				?.getAttribute("data-new"),
		).toBe("## Empty titles\nCheck empty titles.");
		expect(rowButtons()).toEqual(["Save rule", "Discard", "Discuss"]);
		// The header asks for the rule, not the merge: its primary action
		// brings the rule into view.
		const status = document.querySelector('[aria-label="Task progress"]');
		expect(status?.querySelector("strong")?.textContent).toBe(
			"Review proposed rule",
		);
		expect(status?.textContent).not.toContain("You decide when to merge");
		const review = [
			...(status?.querySelectorAll<HTMLButtonElement>(
				'[data-testid="factory-card-actions"] button',
			) ?? []),
		];
		expect(review[0]?.textContent).toBe("Review the rule");
		const scrolled = vi.fn();
		const ruleBlock = document.querySelector<HTMLElement>(
			'[data-testid="factory-feedback-proposal"]',
		);
		if (ruleBlock) ruleBlock.scrollIntoView = scrolled;
		await act(async () => review[0]?.click());
		expect(scrolled).toHaveBeenCalled();
		// The card is the only place with Save and Discard.
		expect(
			[...document.querySelectorAll("button")].filter(
				(item) => item.textContent?.trim() === "Save rule",
			),
		).toHaveLength(1);
		await act(async () => button("Save rule").click());
		expect(mocks.invoke).toHaveBeenCalledWith("task.factory.audit.resolve", {
			taskId: task.taskId,
			decision: "save",
			expectedHash: "h2",
			allWorkspaces: true,
		});
		await act(async () => button("Discard").click());
		expect(mocks.invoke).toHaveBeenLastCalledWith(
			"task.factory.audit.resolve",
			{ taskId: task.taskId, decision: "discard", allWorkspaces: true },
		);
		await act(async () => button("Discuss").click());
		stop();
		expect(discussed).toEqual([
			{
				taskId: task.taskId,
				shortId: "F12",
				draft: expect.stringContaining(note),
			},
		]);
		expect((discussed[0] as { draft: string }).draft).toContain(
			"Code review passed a search that matched empty titles.",
		);
	});

	it("says a repository rule is written into the project", async () => {
		await renderAnalysis({
			status: "proposed",
			trigger: "feedback",
			startedAt,
			proposal: { ...proposal, scope: "repository", workspaceRoot: "/repo" },
		});
		expect(row()?.textContent).toContain(
			"Code reviewer guidance · this project",
		);
		expect(row()?.textContent).toContain("it is not committed");
	});

	it("shows only the verdict when no rule is needed", async () => {
		await renderAnalysis({
			status: "no_rule",
			trigger: "feedback",
			startedAt,
			summary: "The brief never asked for empty titles.",
			reason: "about_request",
		});
		expect(row()?.textContent).toContain(
			"The brief never asked for empty titles.",
		);
		expect(rowButtons()).toEqual([]);
	});

	it("offers Try again and Discuss when the check failed", async () => {
		await renderAnalysis({
			status: "failed",
			trigger: "feedback",
			startedAt,
			error: "The analysis did not return a readable answer.",
		});
		expect(row()?.textContent).toContain(
			"The analysis did not return a readable answer.",
		);
		expect(rowButtons()).toEqual(["Try again", "Discuss"]);
		await act(async () => button("Try again").click());
		expect(mocks.invoke).toHaveBeenCalledWith("task.factory.audit.resolve", {
			taskId: task.taskId,
			decision: "retry",
			allWorkspaces: true,
		});
	});

	it("treats a check still running after ten minutes as stopped", async () => {
		await renderAnalysis({
			status: "running",
			trigger: "feedback",
			startedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
		});
		expect(row()?.textContent).toContain(
			"Factory stopped before it finished checking this note.",
		);
		expect(rowButtons()).toEqual(["Try again", "Discuss"]);
	});

	it.each([
		["saved", "Rule saved. Factory follows it from the next card."],
		["discarded", "Rule discarded. Nothing was saved."],
	])("shows a %s rule as settled", async (status, line) => {
		await renderAnalysis({
			status,
			trigger: "feedback",
			startedAt,
			proposal,
		});
		expect(row()?.textContent).toContain(line);
		expect(rowButtons()).toEqual([]);
	});

	describe("More → Rate", () => {
		let report: (visible: boolean) => void = () => {};
		beforeEach(() => {
			vi.stubGlobal(
				"IntersectionObserver",
				class {
					constructor(
						callback: (entries: Array<{ isIntersecting: boolean }>) => void,
					) {
						report = (visible) => callback([{ isIntersecting: visible }]);
					}
					observe() {}
					disconnect() {}
				},
			);
		});
		afterEach(() => vi.unstubAllGlobals());

		it("is hidden while the unanswered row is on screen", async () => {
			mocks.getFactoryTask.mockResolvedValue({
				runs: [
					{
						...withState({
							phase: "ready",
							pullRequestUrl: "https://github.com/example/repo/pull/7",
						}),
						status: "completed",
					},
				],
			});
			await render(card());
			await act(async () => report(true));
			await expect(menuItem("Leave feedback…")).rejects.toThrow(
				"Missing menu item",
			);
		});

		it("changes an answer even while the row is on screen", async () => {
			await renderAnalysis({
				status: "no_rule",
				trigger: "feedback",
				startedAt,
				summary: "A one-off.",
			});
			await act(async () => report(true));
			await menuItem("Leave feedback…");
			await act(async () => new Promise(requestAnimationFrame));
			const field = document.querySelector("#factory-feedback-finding");
			expect(field).toBeInstanceOf(HTMLTextAreaElement);
			expect((field as HTMLTextAreaElement).value).toBe(note);
			expect(rowButtons()).toContain("Something's off…");
		});
	});
});
