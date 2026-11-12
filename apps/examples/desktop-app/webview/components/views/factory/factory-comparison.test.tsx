// @vitest-environment jsdom
import type { AgendaTaskRecord, AgendaTaskRunRecord } from "@cline/shared";
import { factoryRunStateSchema, factoryTaskConfigSchema } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FactoryComparison } from "./factory-comparison";

const mocks = vi.hoisted(() => ({
	getFactoryTask: vi.fn(
		async (
			_taskId: string,
		): Promise<{ task?: AgendaTaskRecord; runs: AgendaTaskRunRecord[] }> => ({
			runs: [],
		}),
	),
	listAgendaTasks: vi.fn(
		async (_input: Record<string, unknown>): Promise<AgendaTaskRecord[]> => [],
	),
	replayFactoryTask: vi.fn(
		async (_input: unknown): Promise<AgendaTaskRecord[]> => [],
	),
	invoke: vi.fn(async (_command: string): Promise<unknown> => ({})),
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: mocks }));

const timestamps = {
	availableAt: "2026-01-01T00:00:00Z",
	expiresAt: "2027-01-01T00:00:00Z",
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};
const sourceTask: AgendaTaskRecord = {
	...timestamps,
	taskId: "source",
	title: "Search notes",
	instructions: "Search note titles.",
	type: "todo",
	scope: "workspace",
	workspaceRoot: "/repo",
	status: "completed",
	resourcePaths: [],
	priority: 2,
	automationEligible: false,
	revision: 1,
	createdBy: { kind: "user" },
	updatedBy: { kind: "user" },
	lastRunId: "run-source",
	factory: factoryTaskConfigSchema.parse({
		checks: [{ name: "API", command: "node check.mjs", kind: "api" }],
		acceptanceCriteria: [
			{ id: "api-search", text: "API finds titles", check: "API" },
		],
	}),
};
const snapshot = {
	scope: "workspace",
	workspaceRoot: "/repo",
	title: sourceTask.title,
	instructions: sourceTask.instructions,
	resourcePaths: [],
	modelSelection: { providerId: "cline", modelId: "model-z" },
	factory: sourceTask.factory,
};
function runRecord(
	taskId: string,
	runId: string,
	status: AgendaTaskRunRecord["status"],
	state: Record<string, unknown> | undefined,
): AgendaTaskRunRecord {
	return {
		...timestamps,
		runId,
		taskId,
		taskRevision: 1,
		attempt: 1,
		status,
		claimedAt: "2026-01-01T00:00:00Z",
		startedAt: "2026-01-01T00:00:00Z",
		completedAt: "2026-01-01T00:02:05Z",
		factory: state
			? factoryRunStateSchema.parse({
					phase: "ready",
					repairRound: 0,
					sessions: [],
					workspace: {
						path: `/worktrees/${runId}`,
						branch: `factory/${runId}`,
						baseBranch: "main",
						baseCommit: "base111",
					},
					...state,
				})
			: undefined,
	};
}
const sourceRun = runRecord("source", "run-source", "completed", {
	inputSnapshot: snapshot,
	humanApproval: { commit: "c0", approvedAt: "2026-01-02T00:00:00Z" },
});
function variant(
	taskId: string,
	label: string,
	variantIndex: number,
	overrides: Partial<AgendaTaskRecord> = {},
): AgendaTaskRecord {
	return {
		...sourceTask,
		taskId,
		title: `Search notes · ${label}`,
		status: "pending_approval",
		lastRunId: undefined,
		originTaskId: "source",
		factory: factoryTaskConfigSchema.parse({
			...sourceTask.factory,
			workflow: { name: "Cheaper", revision: "b".repeat(64) },
			replay: {
				comparisonId: "comparison_1",
				variantIndex,
				requestHash: "a".repeat(64),
				sourceTaskId: "source",
				sourceRunId: "run-source",
				sourceTaskRevision: 1,
				baseCommit: "base111",
				baseBranch: "main",
				label,
			},
		}),
		...overrides,
	};
}
const attempt = {
	key: "unit",
	repairRound: 0,
	createdAt: timestamps.createdAt,
	instructions: "",
};
const finished = { summary: "done", completedAt: timestamps.updatedAt };
const variantA = variant("task_replay_a", "Cheaper review", 0, {
	status: "completed",
	lastRunId: "run-a",
});
const variantARun = runRecord("task_replay_a", "run-a", "completed", {
	inputSnapshot: {
		...snapshot,
		factory: {
			...variantA.factory,
			acceptanceCriteria: [
				{ id: "api-search", text: "API finds titles", check: "API" },
				{ id: "empty-state", text: "Empty query keeps the list" },
				{ id: "export", text: "Results export", required: false },
			],
		},
	},
	attempts: [
		{
			...attempt,
			...finished,
			id: "a1",
			role: "builder",
			sessionId: "s1",
			status: "completed",
			agent: {
				modelSelection: { providerId: "anthropic", modelId: "claude-x" },
			},
		},
		{
			...attempt,
			...finished,
			id: "a2",
			role: "reviewer",
			sessionId: "s2",
			status: "completed",
			agent: {
				resolvedProfile: {
					name: "reviewer",
					description: "",
					systemPrompt: "",
					providerId: "openai",
					modelId: "gpt-y",
				},
			},
		},
		{
			...attempt,
			id: "a3",
			role: "verifier",
			sessionId: "s3",
			status: "failed",
			failure: "runtime",
			error: "provider unavailable",
			completedAt: timestamps.updatedAt,
			agent: {},
		},
	],
	usage: {
		totals: {
			inputTokens: 120,
			outputTokens: 30,
			cacheReadTokens: 50,
			cacheWriteTokens: 10,
			totalCost: 0.42,
		},
		unknownSessionIds: ["s3"],
	},
	candidate: {
		commit: "c1",
		checks: [
			{
				name: "API",
				kind: "api",
				command: "node check.mjs",
				status: "passed",
				exitCode: 0,
				output: "",
				artifacts: [],
			},
		],
		reviews: [
			{
				reviewerIndex: 0,
				sessionId: "s2",
				review: { verdict: "pass", summary: "ok", findings: [] },
			},
		],
	},
	audit: {
		selectedAt: timestamps.updatedAt,
		reviewedAt: timestamps.updatedAt,
		finding: "Missed the empty state",
	},
});
const variantB = variant("task_replay_b", "Strict review", 1, {
	status: "failed",
	lastRunId: "run-b",
});
const variantBRun = runRecord("task_replay_b", "run-b", "failed", {
	inputSnapshot: { ...snapshot, factory: variantB.factory },
	phase: "blocked",
	workspace: {
		path: "/worktrees/run-b",
		branch: "factory/run-b",
		baseBranch: "main",
		baseCommit: "base222",
	},
});
// Created with plan reviewers: queued, with no progress until review starts.
const queued = variant("task_replay_q", "Original workflow", 2);

let root: Root;
let container: HTMLDivElement;
const onOpenTask = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	mocks.listAgendaTasks.mockResolvedValue([]);
	mocks.invoke.mockResolvedValue({});
	mocks.getFactoryTask.mockImplementation(async (taskId) => ({
		task: taskId === "source" ? sourceTask : undefined,
		runs:
			taskId === "source"
				? [sourceRun]
				: taskId === "task_replay_a"
					? [variantARun]
					: taskId === "task_replay_b"
						? [variantBRun]
						: [],
	}));
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

// Comparison loads chain several requests; let them settle inside act.
async function settle(action: () => void = () => {}) {
	await act(async () => {
		action();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}
async function render(task: AgendaTaskRecord, runs: AgendaTaskRunRecord[]) {
	await settle(() =>
		root.render(
			<FactoryComparison
				task={task}
				runs={runs}
				defaultRunId={runs[0]?.runId}
				onOpenTask={onOpenTask}
			/>,
		),
	);
}
function button(label: string): HTMLButtonElement {
	const found = [...container.querySelectorAll("button")].find(
		(item) => item.textContent?.trim() === label,
	);
	if (!found) throw new Error(`Missing button ${label}`);
	return found;
}
function column(label: string): string[] {
	const headers = [...container.querySelectorAll("thead th")];
	const index = headers.findIndex((header) =>
		header.textContent?.startsWith(label),
	);
	if (index < 0) throw new Error(`Missing column ${label}`);
	return [...container.querySelectorAll("tbody tr")].map(
		(row) => row.children[index]?.textContent ?? "",
	);
}

it("compares source and variant runs, including failures, unknown usage and provenance", async () => {
	mocks.listAgendaTasks.mockResolvedValue([
		variantB,
		variantA,
		queued,
		{ ...sourceTask, taskId: "unrelated", title: "Other work" },
	]);
	await render(sourceTask, [sourceRun]);
	expect(mocks.listAgendaTasks.mock.calls.map(([input]) => input)).toEqual([
		{
			allWorkspaces: true,
			includeArchived: true,
			factoryReplaySourceRunId: "run-source",
			limit: 200,
		},
		{
			allWorkspaces: true,
			includeArchived: true,
			factoryComparisonId: "comparison_1",
		},
	]);
	expect(mocks.getFactoryTask).not.toHaveBeenCalledWith("unrelated");
	expect(mocks.getFactoryTask).not.toHaveBeenCalledWith("source");
	expect(
		[...container.querySelectorAll("thead th")].map((th) => th.textContent),
	).toEqual([
		"Variant",
		"Source (this task)",
		"Cheaper review",
		"Strict review",
		"Original workflow",
	]);

	const source = column("Source").join("\n");
	expect(source).toContain("Checked off");
	expect(source).toContain("Original settings");
	// Without a candidate nothing is claimed as proven.
	expect(source).toContain("1 required, 0 optional · not evaluated");
	const cheaper = column("Cheaper review").join("\n");
	expect(cheaper).toContain("Cline");
	expect(cheaper).toContain(
		"Implementer: anthropic/claude-x · Reviewer: openai/gpt-y · Verifier: cline/model-z",
	);
	expect(cheaper).toContain("120 / 30");
	expect(cheaper).toContain("50 / 10");
	expect(cheaper).toContain("$0.42 + 1 session with unknown usage");
	expect(cheaper).toContain("2m 5s");
	expect(cheaper).toContain("1 failed agent attempts");
	expect(cheaper).toContain("1/1 passed");
	expect(cheaper).toContain("Not checked off");
	expect(cheaper).toContain("Something's off: Missed the empty state");
	// The missing verifier report leaves its required criterion unverified.
	expect(cheaper).toContain(
		"1/2 required proven · unverified: empty-state · optional 0/1 passed",
	);
	expect(cheaper).toContain(`Cheaper · ${"b".repeat(8)}`);
	// Replays skip the designer, so their totals are scoped differently.
	expect(cheaper).toContain("Plan review and execution sessions; no designer");
	expect(source).toContain(
		"Design and plan review sessions recorded for the task, plus execution",
	);
	expect(container.textContent).toContain(
		"these totals are not equivalent end-to-end costs",
	);
	expect(cheaper).not.toContain("differs from source");
	const strict = column("Strict review").join("\n");
	expect(strict).toContain("failed · blocked");
	expect(strict).toContain("Unknown");
	expect(strict).toContain("main@base222 · differs from source");
	expect(strict).not.toContain("required proven");
	const original = column("Original workflow").join("\n");
	expect(original).toContain("Queued for plan review");
	expect(container.textContent).not.toContain("Start plan review");

	await settle(() => button("Open task").click());
	expect(onOpenTask).toHaveBeenCalledWith("task_replay_a");
});

it("loads runs for one recent comparison at a time, never slicing its variants", async () => {
	const at = (minute: number) =>
		new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
	// 98 older two-variant comparisons and the newest four-variant one fill a
	// whole run listing.
	const older = Array.from({ length: 98 }, (_, index) =>
		[0, 1].map((variantIndex) =>
			variant(
				`old_${index}_${variantIndex}`,
				`Old ${variantIndex}`,
				variantIndex,
				{
					createdAt: at(index),
					factory: factoryTaskConfigSchema.parse({
						...queued.factory,
						replay: {
							...queued.factory?.replay,
							comparisonId: `comparison_old_${index}`,
							variantIndex,
						},
					}),
				},
			),
		),
	).flat();
	const newest = [0, 1, 2, 3].map((variantIndex) =>
		variant(`new_${variantIndex}`, `New ${variantIndex}`, variantIndex, {
			createdAt: at(200),
		}),
	);
	const all = [...older, ...newest];
	expect(all).toHaveLength(200);
	mocks.listAgendaTasks.mockImplementation(async (input) =>
		input.factoryComparisonId
			? all.filter(
					(task) =>
						task.factory?.replay?.comparisonId === input.factoryComparisonId,
				)
			: all,
	);
	await render(sourceTask, [sourceRun]);
	expect(
		mocks.getFactoryTask.mock.calls.map(([taskId]) => taskId).sort(),
	).toEqual(["new_0", "new_1", "new_2", "new_3"]);
	expect(
		[...container.querySelectorAll("thead th")].map((th) => th.textContent),
	).toEqual([
		"Variant",
		"Source (this task)",
		"New 0",
		"New 1",
		"New 2",
		"New 3",
	]);
	const choices = container.querySelectorAll<HTMLOptionElement>(
		'option[value^="comparison_"]',
	);
	expect(choices).toHaveLength(10);
	expect(container.textContent).toContain(
		"Lists up to the 10 most recent comparisons of this run.",
	);
	expect(container.textContent).toContain(
		"Discovery is limited to the 200 most recent replay tasks.",
	);

	const select = choices[0]?.parentElement;
	if (!(select instanceof HTMLSelectElement)) throw new Error("Missing select");
	await settle(() => {
		select.value = "comparison_old_97";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(6);
	expect(
		mocks.getFactoryTask.mock.calls
			.slice(4)
			.map(([taskId]) => taskId)
			.sort(),
	).toEqual(["old_97_0", "old_97_1"]);
});

it("loads a variant's comparison by ID with its source run", async () => {
	mocks.listAgendaTasks.mockResolvedValue([variantA]);
	await render(variantA, [variantARun]);
	expect(mocks.listAgendaTasks).toHaveBeenCalledWith({
		allWorkspaces: true,
		includeArchived: true,
		factoryComparisonId: "comparison_1",
	});
	expect(mocks.getFactoryTask).toHaveBeenCalledWith("source");
	expect(container.textContent).not.toContain("Run it again with other models");
	expect(column("Cheaper review")[0]).toContain("completed");
	expect(
		[...container.querySelectorAll("thead th")].map((th) => th.textContent),
	).toEqual(["Variant", "Source", "Cheaper review (this task)"]);
	expect(column("Source").join("\n")).toContain("Checked off");
	await settle(() => button("Open task").click());
	expect(onOpenTask).toHaveBeenCalledWith("source");
});

it("explains a replay whose source task was deleted", async () => {
	mocks.listAgendaTasks.mockResolvedValue([variantA]);
	mocks.getFactoryTask.mockImplementation(async (taskId) => {
		if (taskId === "source") throw new Error("unknown task: source");
		return { runs: [variantARun] };
	});
	await render(variantA, [variantARun]);
	expect(container.querySelector('[role="alert"]')).toBeNull();
	expect(container.textContent).toContain("The source task is unavailable");
	expect(container.querySelector("table")).toBeNull();
});

it.each([
	[
		"without saved execution inputs",
		{},
		"recorded before Factory saved its execution inputs",
	],
	[
		"recorded before acceptance criteria",
		{
			inputSnapshot: {
				...snapshot,
				factory: { ...sourceTask.factory, acceptanceCriteria: undefined },
			},
		},
		"predates named acceptance criteria",
	],
] as const)("does not offer replay for a run %s", async (_case, state, reason) => {
	const legacy = runRecord("source", "run-source", "completed", state);
	await render(sourceTask, [legacy]);
	await settle(() => button("Run it again with other models…").click());
	expect(container.textContent).toContain(reason);
	expect(container.textContent).not.toContain("Create comparison");
	expect(mocks.replayFactoryTask).not.toHaveBeenCalled();
});

it("creates variants from saved workflows and reuses the comparison ID on retry", async () => {
	const cheaper = {
		name: "Cheaper",
		revision: "b".repeat(64),
		config: { approval: "required", maxRepairRounds: 1 },
	};
	mocks.invoke.mockImplementation(async (command) =>
		command === "get_desktop_settings"
			? {
					factoryPresets: [
						cheaper,
						{
							name: "Adaptive",
							revision: "c".repeat(64),
							config: {
								approval: "required",
								maxRepairRounds: 2,
								reviewMode: "adaptive",
							},
						},
					],
				}
			: {},
	);
	await render(sourceTask, [sourceRun]);
	await settle(() => button("Run it again with other models…").click());
	await settle(() => button("Add variant").click());
	const workflow = container.querySelector<HTMLSelectElement>(
		'select[aria-label="Variant 2 workflow"]',
	);
	if (!workflow) throw new Error("Missing workflow select");
	expect(
		workflow.querySelector<HTMLOptionElement>('option[value="Adaptive"]')
			?.disabled,
	).toBe(true);
	await act(async () => {
		workflow.value = "Cheaper";
		workflow.dispatchEvent(new Event("change", { bubbles: true }));
	});
	mocks.replayFactoryTask.mockRejectedValueOnce(new Error("Hub unavailable"));
	await settle(() => button("Create comparison").click());
	expect(container.querySelector('[role="alert"]')?.textContent).toBe(
		"Hub unavailable",
	);
	await settle(() => button("Retry creating comparison").click());

	const [first, second] = mocks.replayFactoryTask.mock.calls.map(
		([input]) => input,
	);
	expect(first).toEqual({
		taskId: "source",
		runId: "run-source",
		comparisonId: expect.stringMatching(/^comparison_[A-Za-z0-9_-]+$/),
		variants: [
			{ label: "Original workflow" },
			{
				label: "Variant 2",
				recipe: { schemaVersion: 1, ...cheaper },
			},
		],
	});
	expect(second).toEqual(first);
	// Success closes the form and reloads this run's comparisons.
	expect(container.textContent).not.toContain("Create comparison");
	expect(mocks.listAgendaTasks).toHaveBeenCalledTimes(2);
});
