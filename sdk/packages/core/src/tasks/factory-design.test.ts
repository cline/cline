import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgendaTaskRecord, FactoryReviewSelection } from "@cline/shared";
import {
	FACTORY_PRIORITY_RANK,
	factoryPriorityRank,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubAgendaTaskCommandService } from "../hub/server/task-command-service";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
} from "./agenda-task-manager";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0)) await dispose();
});
const pass = JSON.stringify({
	verdict: "pass",
	findings: [],
	summary: "Independent review passed",
});
const criteria = [
	{
		id: "behavior",
		text: "The behavior check passes",
		required: true,
		check: "Behavior",
	},
];
const change = JSON.stringify({
	verdict: "changes_requested",
	findings: ["Specify empty-input behavior"],
	summary: "Acceptance criterion missing",
});
function gate() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	disposals.push(async () => release());
	return { promise, release };
}
async function harness(
	options: {
		maxRepairRounds?: number;
		reviewMode?: "fixed" | "adaptive";
		reviewSelection?: FactoryReviewSelection;
		maxRuntimeRetries?: number;
		queueFactoryDesign?: boolean;
		startReview?: (index: number) => Promise<void>;
		review?: (index: number, task: AgendaTaskRecord) => Promise<string>;
	} = {},
) {
	const root = mkdtempSync(join(tmpdir(), "cline-factory-design-"));
	const workspaceRoot = join(root, "repo");
	mkdirSync(workspaceRoot);
	let designs = 0;
	let reviewers = 0;
	const runtime: AgendaTaskRuntime &
		Required<
			Pick<
				AgendaTaskRuntime,
				"startDesignSession" | "startDesignReviewSession" | "runDesignSession"
			>
		> = {
		startSession: vi.fn(async () => ({ sessionId: "unused" })),
		runSession: vi.fn<AgendaTaskRuntime["runSession"]>(async () => ({
			status: "completed",
		})),
		abortSession: vi.fn(async () => {}),
		startDesignSession: vi.fn(async () => ({ sessionId: "designer" })),
		startDesignReviewSession: vi.fn(async () => {
			const index = ++reviewers;
			await options.startReview?.(index);
			return { sessionId: `review-${index}` };
		}),
		runDesignSession: vi.fn<NonNullable<AgendaTaskRuntime["runDesignSession"]>>(
			async (sessionId, task) => ({
				status: "completed",
				summary:
					sessionId === "designer"
						? JSON.stringify({
								instructions: `Proposed brief ${++designs}`,
								reviewSelection: options.reviewSelection,
								checks: task.factory?.checks,
								acceptanceCriteria: criteria,
							})
						: ((await options.review?.(
								Number(sessionId.split("-")[1]),
								task,
							)) ?? pass),
			}),
		),
	};
	const managerOptions = {
		runtime,
		dbPath: join(root, "tasks.db"),
		globalSpecsDir: join(root, "specs"),
		watchFiles: false,
		automationEnabled: false,
		// Thrown designer turns poll for the session to stop; keep it instant.
		factorySettlePolling: { intervalMs: 1, attempts: 60 },
	};
	let manager = new AgendaTaskManager(managerOptions);
	disposals.push(async () => {
		await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	const participant = (
		modelId: string,
		maxIterations: number,
		timeoutSeconds: number,
	) => ({
		modelSelection: { providerId: "test-provider", modelId },
		instructions: `Private instructions for ${modelId}`,
		maxIterations,
		timeoutSeconds,
	});
	const task = await manager.createTask({
		title: "Specify behavior",
		type: "follow-up",
		instructions: "Initial brief",
		scope: "workspace",
		workspaceRoot,
		expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
		createdBy: { kind: "user" },
		queueFactoryDesign: options.queueFactoryDesign,
		maxIterations: 6,
		timeoutSeconds: 30,
		factory: factoryTaskConfigSchema.parse({
			maxRepairRounds: options.maxRepairRounds ?? 2,
			reviewMode: options.reviewMode,
			maxRuntimeRetries: options.maxRuntimeRetries,
			checks: [{ name: "Behavior", kind: "test", command: "true" }],
			agents: {
				designer: participant("designer-model", 3, 20),
				reviewers: [
					participant("final-first", 3, 20),
					participant("final-second", 3, 20),
				],
				planReviewers: [
					participant("first-model", 10, 60),
					participant("second-model", 2, 10),
				],
			},
		}),
	});
	const current = async () => {
		const value = await manager.getTask(task.taskId);
		if (!value) throw new Error("Task disappeared");
		return value;
	};
	const approve = async () =>
		manager.approveTask(
			task.taskId,
			{ kind: "user" },
			(await current()).revision,
		);
	return {
		manager,
		runtime,
		task,
		dbPath: managerOptions.dbPath,
		current,
		approve,
		restart: async () => {
			await manager.dispose();
			manager = new AgendaTaskManager(managerOptions);
			return manager;
		},
	};
}

describe("Factory design review", () => {
	const localSelection: FactoryReviewSelection = {
		impact: "local",
		rationale: "A local behavior change",
		affectedPaths: ["src/feature.ts"],
		consumers: ["feature view"],
		planReviewerIndices: [1],
		reviewerIndices: [1],
	};
	it("routes adaptive plan review from the frozen pool and gates approval on the current selection", async () => {
		const h = await harness({
			reviewMode: "adaptive",
			reviewSelection: localSelection,
		});
		await expect(h.approve()).rejects.toThrow("Complete adaptive design");
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		const current = await h.current();
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(h.runtime.startDesignReviewSession).mock.calls[0]?.[2]
				?.modelSelection?.modelId,
		).toBe("second-model");
		expect(current.factoryDesignProgress?.agents.planReviewers).toHaveLength(2);
		expect(current.factoryDesignProgress?.reviewSelection).toEqual(
			localSelection,
		);
		await expect(h.approve()).resolves.toMatchObject({ status: "approved" });
	});

	it("retains selected plan reviewers through an adaptive repair instead of allowing a bypass", async () => {
		const selection = { ...localSelection };
		const h = await harness({
			reviewMode: "adaptive",
			reviewSelection: selection,
			review: async (index) => {
				if (index === 1) {
					selection.planReviewerIndices = [];
					return change;
				}
				return pass;
			},
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(2);
		expect(
			(await h.current()).factoryDesignProgress?.reviewSelection
				?.planReviewerIndices,
		).toEqual([1]);
		expect((await h.current()).factoryDesignProgress?.repairRound).toBe(1);
		await expect(h.approve()).resolves.toMatchObject({ status: "approved" });
	});

	it("requires completed adaptive design even when the selected plan-review roster is empty", async () => {
		const h = await harness({
			reviewMode: "adaptive",
			reviewSelection: { ...localSelection, planReviewerIndices: [] },
		});
		await expect(h.approve()).rejects.toThrow("Complete adaptive design");
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		expect(h.runtime.startDesignReviewSession).not.toHaveBeenCalled();
		await expect(h.approve()).resolves.toMatchObject({ status: "approved" });
	});

	it.each([
		"runtime",
		"output",
		"criteria",
	])("recovers unusable designer %s output without consuming a design repair round", async (failure) => {
		const h = await harness({ maxRepairRounds: 0 });
		vi.mocked(h.runtime.startDesignSession).mockImplementation(
			async (_task, _client, _agent, sessionId) => ({
				sessionId: sessionId ?? "designer",
			}),
		);
		const run = vi.mocked(h.runtime.runDesignSession).getMockImplementation();
		if (!run) throw new Error("Missing test design runtime");
		let designs = 0;
		vi.mocked(h.runtime.runDesignSession).mockImplementation(
			async (sessionId, task) => {
				if (!sessionId.startsWith("factory_design_"))
					return run(sessionId, task);
				const design = {
					instructions: h.task.instructions,
					checks: h.task.factory?.checks,
					acceptanceCriteria: criteria,
				};
				if (++designs === 1)
					return failure === "runtime"
						? { status: "failed", error: "Design stream interrupted" }
						: {
								status: "completed",
								summary:
									failure === "output"
										? 'Source inspection complete. {"instructions":"partial'
										: JSON.stringify({
												...design,
												acceptanceCriteria: [
													{ ...criteria[0], check: "Missing" },
												],
											}),
							};
				return { status: "completed", summary: JSON.stringify(design) };
			},
		);
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		const current = await h.current();
		expect(current.factoryDesignProgress).toMatchObject({
			formatRetries: 1,
			repairRound: 0,
		});
		expect(current.revision).toBe(h.task.revision + 1);
		expect(current.factory?.acceptanceCriteria).toEqual(criteria);
		const calls = vi.mocked(h.runtime.runDesignSession).mock.calls;
		if (failure === "criteria")
			expect(
				calls.filter(([id]) => id.startsWith("factory_design_"))[1]?.[1]
					.instructions,
			).toContain('names check "Missing", which is not an approved check');
		const reviews = calls.filter(([id]) => id.startsWith("review-"));
		expect(reviews).toHaveLength(2);
		for (const [, task] of reviews)
			expect(task.instructions).toContain(
				`ACCEPTANCE CRITERIA:\n${JSON.stringify(criteria)}`,
			);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(2);
		const ids = vi
			.mocked(h.runtime.startDesignSession)
			.mock.calls.map((args) => args[3]);
		expect(new Set(ids).size).toBe(2);
		expect(current.factoryDesignSessionIds).toEqual(
			expect.arrayContaining(ids),
		);
	});

	it("accepts a design response wrapped in prose without recovery", async () => {
		const h = await harness();
		vi.mocked(h.runtime.runDesignSession).mockImplementationOnce(
			async (_sessionId, task) => ({
				status: "completed",
				summary: `I inspected the repository.\n\n\`\`\`json\n${JSON.stringify({
					instructions: "Proposed brief in prose",
					checks: task.factory?.checks,
					acceptanceCriteria: criteria,
				})}\n\`\`\`\n\nLet me know if anything should change.`,
			}),
		);
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		const current = await h.current();
		expect(current.instructions).toBe("Proposed brief in prose");
		expect(current.factoryDesignProgress?.formatRetries).toBeUndefined();
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
	});

	describe("thrown designer turns", () => {
		const timeout = "Hub run run.start timed out after 1800000ms.";
		/** Designer sessions throw `errors` in order, then return a valid design. */
		async function throwingHarness(errors: string[]) {
			const h = await harness();
			vi.mocked(h.runtime.startDesignSession).mockImplementation(
				async (_task, _client, _agent, sessionId) => ({
					sessionId: sessionId ?? "designer",
				}),
			);
			let designs = 0;
			vi.mocked(h.runtime.runDesignSession).mockImplementation(
				async (sessionId, task) => {
					if (!sessionId.startsWith("factory_design_"))
						return { status: "completed", summary: pass };
					const error = errors[designs++];
					if (error) throw new Error(error);
					return {
						status: "completed",
						summary: JSON.stringify({
							instructions: "Recovered brief",
							checks: task.factory?.checks,
							acceptanceCriteria: criteria,
						}),
					};
				},
			);
			const designerIds = () =>
				vi
					.mocked(h.runtime.startDesignSession)
					.mock.calls.map((args) => args[3]);
			return { ...h, designerIds };
		}
		/**
		 * Sessions Factory has not aborted are new. An aborted (thrown) session
		 * reports `after` in order, repeating the last state.
		 */
		function reconcileAfterThrow(
			h: Awaited<ReturnType<typeof harness>>,
			after: Array<
				Awaited<ReturnType<NonNullable<AgendaTaskRuntime["reconcileSession"]>>>
			>,
		) {
			let index = 0;
			const reconcile = vi.fn<
				NonNullable<AgendaTaskRuntime["reconcileSession"]>
			>(async (sessionId) => {
				const aborted = vi
					.mocked(h.runtime.abortSession)
					.mock.calls.some(([id]) => id === sessionId);
				if (!aborted) return { status: "missing" };
				return (
					after[Math.min(index++, after.length - 1)] ?? {
						status: "missing",
					}
				);
			});
			h.runtime.reconcileSession = reconcile;
			return reconcile;
		}

		it("surfaces a non-transient error without retrying or re-interviewing", async () => {
			const h = await throwingHarness(["Provider rejected the API key"]);
			reconcileAfterThrow(h, [{ status: "missing" }]);
			await h.manager.startFactoryDesign(h.task.taskId);
			await vi.waitFor(async () =>
				expect((await h.current()).error).toBe(
					"Design did not complete: Provider rejected the API key",
				),
			);
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
			expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(1);
			// The thrown session is still stopped, best-effort.
			expect(h.runtime.abortSession).toHaveBeenCalledWith(
				h.designerIds()[0],
				"Design turn failed",
			);
			expect(
				(await h.current()).factoryDesignProgress?.formatRetries,
			).toBeUndefined();
		});

		it("surfaces a timeout when the runtime cannot report the session state", async () => {
			const h = await throwingHarness([timeout]);
			await h.manager.startFactoryDesign(h.task.taskId);
			await vi.waitFor(async () =>
				expect((await h.current()).error).toBe(
					`Design did not complete: ${timeout}`,
				),
			);
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
			expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(1);
		});

		it("retries a timeout once in a fresh session after the old session stops", async () => {
			const h = await throwingHarness([timeout]);
			const reconcile = reconcileAfterThrow(h, [
				{ status: "running" },
				{ status: "missing" },
			]);
			await h.manager.startFactoryDesign(h.task.taskId);
			await vi.waitFor(
				async () =>
					expect((await h.current()).factoryDesignProgress?.phase).toBe(
						"complete",
					),
				{ timeout: 5000 },
			);
			const current = await h.current();
			expect(current.error).toBeUndefined();
			expect(current.instructions).toBe("Recovered brief");
			expect(current.factoryDesignProgress?.formatRetries).toBe(1);
			const ids = h.designerIds();
			expect(new Set(ids).size).toBe(2);
			expect(h.runtime.abortSession).toHaveBeenCalledWith(
				ids[0],
				"Design turn failed",
			);
			// Polled until the thrown session stopped, before the fresh one started.
			expect(
				reconcile.mock.calls.filter(([id]) => id === ids[0]).length,
			).toBeGreaterThanOrEqual(3);
			const fresh = vi
				.mocked(h.runtime.runDesignSession)
				.mock.calls.filter(([id]) => id === ids[1]);
			expect(fresh[0]?.[1].instructions).toContain(timeout);
		});

		it("adopts the thrown session's result when it completed after all", async () => {
			const h = await throwingHarness([timeout]);
			reconcileAfterThrow(h, [
				{
					status: "completed",
					summary: JSON.stringify({
						instructions: "Finished before the timeout",
						checks: h.task.factory?.checks,
						acceptanceCriteria: criteria,
					}),
				},
			]);
			await h.manager.startFactoryDesign(h.task.taskId);
			await vi.waitFor(async () =>
				expect((await h.current()).factoryDesignProgress?.phase).toBe(
					"complete",
				),
			);
			expect((await h.current()).instructions).toBe(
				"Finished before the timeout",
			);
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		});

		it("retries a timeout only once", async () => {
			const h = await throwingHarness([timeout, timeout]);
			reconcileAfterThrow(h, [
				{ status: "failed", error: "Aborted after timeout" },
			]);
			await h.manager.startFactoryDesign(h.task.taskId);
			await vi.waitFor(async () =>
				expect((await h.current()).error).toBe(
					`Design did not complete: ${timeout}`,
				),
			);
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(2);
			expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(2);
			// Both thrown sessions are stopped; only the first is retried.
			expect(h.runtime.abortSession).toHaveBeenCalledTimes(2);
		});

		it("surfaces a timeout when the old session is still running after every poll", async () => {
			const h = await throwingHarness([timeout]);
			const reconcile = reconcileAfterThrow(h, [{ status: "running" }]);
			await h.manager.startFactoryDesign(h.task.taskId);
			await vi.waitFor(async () =>
				expect((await h.current()).error).toBe(
					`Design did not complete: ${timeout}`,
				),
			);
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
			const ids = h.designerIds();
			// One reconcile before the run, then the configured 60 polls plus the first check.
			expect(reconcile.mock.calls.filter(([id]) => id === ids[0]).length).toBe(
				63,
			);
		});

		it("scopes the changed brief afresh instead of retrying a stale timeout", async () => {
			const h = await throwingHarness([]);
			reconcileAfterThrow(h, [{ status: "missing" }]);
			vi.mocked(h.runtime.runDesignSession).mockImplementationOnce(async () => {
				const proposal = await h.current();
				await h.manager.updateTask({
					taskId: h.task.taskId,
					expectedRevision: proposal.revision,
					instructions: "New user scope",
					updatedBy: { kind: "user" },
				});
				throw new Error(timeout);
			});
			await h.manager.startFactoryDesign(h.task.taskId);
			// The stale turn is stopped best-effort and never retried; the
			// edited brief is scoped by a new designer.
			await vi.waitFor(async () =>
				expect((await h.current()).factoryDesignProgress?.phase).toBe(
					"complete",
				),
			);
			expect((await h.current()).error).toBeUndefined();
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(2);
			expect(h.designerIds()[1]).not.toBe(h.designerIds()[0]);
			expect(
				vi
					.mocked(h.runtime.runDesignSession)
					.mock.calls.find(([id]) => id === h.designerIds()[1])?.[1]
					.instructions,
			).toContain("New user scope");
			expect(h.runtime.abortSession).toHaveBeenCalledTimes(1);
		});
	});

	it("aborts a designer retry created after task cancellation without running another turn", async () => {
		const held = gate();
		const h = await harness({ maxRuntimeRetries: 1 });
		vi.mocked(h.runtime.runDesignSession).mockResolvedValueOnce({
			status: "failed",
			error: "Design stream interrupted",
		});
		vi.mocked(h.runtime.startDesignSession)
			.mockResolvedValueOnce({ sessionId: "designer" })
			.mockImplementationOnce(async () => {
				await held.promise;
				return { sessionId: "late-designer" };
			});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(() =>
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(2),
		);
		const current = await h.current();
		await h.manager.cancelTask(
			h.task.taskId,
			{ kind: "user" },
			current.revision,
		);
		held.release();
		await vi.waitFor(() =>
			expect(h.runtime.abortSession).toHaveBeenCalledWith(
				"late-designer",
				"Design is no longer current",
			),
		);
		expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(1);
		expect(h.runtime.startDesignReviewSession).not.toHaveBeenCalled();
		expect((await h.current()).status).toBe("cancelled");
	});

	it.each([
		"runtime",
		"output",
	])("retains the exhausted designer %s recovery budget across restart", async (failure) => {
		const h = await harness({ maxRuntimeRetries: 1 });
		vi.mocked(h.runtime.startDesignSession).mockImplementation(
			async (_task, _client, _agent, sessionId) => ({
				sessionId: sessionId ?? "designer",
			}),
		);
		const result: Awaited<
			ReturnType<NonNullable<AgendaTaskRuntime["runDesignSession"]>>
		> =
			failure === "runtime"
				? { status: "failed", error: "Design stream interrupted" }
				: { status: "completed", summary: "incomplete {" };
		vi.mocked(h.runtime.runDesignSession).mockResolvedValue(result);
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain("recovery limit (1)"),
		);
		expect((await h.current()).factoryDesignProgress).toMatchObject({
			formatRetries: 1,
			repairRound: 0,
		});
		h.runtime.reconcileSession = vi.fn<
			NonNullable<AgendaTaskRuntime["reconcileSession"]>
		>(async () => result);
		const restarted = await h.restart();
		await restarted.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain("recovery limit (1)"),
		);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(2);
		expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(2);
		expect((await h.current()).factoryDesignProgress?.formatRetries).toBe(1);
	});

	it.each([
		"runtime",
		"output",
	])("retries a terminal plan-review %s failure without repeating a passed reviewer or redesigning", async (failure) => {
		const held = gate();
		const h = await harness({
			maxRepairRounds: 0,
			startReview: async (index) => {
				if (index === 1) await held.promise;
			},
		});
		const run = vi.mocked(h.runtime.runDesignSession).getMockImplementation();
		if (!run) throw new Error("Missing test design runtime");
		vi.mocked(h.runtime.runDesignSession).mockImplementation(
			async (sessionId, task) => {
				if (sessionId === "review-1")
					return failure === "runtime"
						? {
								status: "failed",
								error: "Response stream ended without a finish reason",
							}
						: {
								status: "completed",
								summary: "Review summary without valid JSON",
							};
				return run(sessionId, task);
			},
		);
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignReview?.reviews).toMatchObject([
				{ reviewerIndex: 1, sessionId: "review-2" },
			]),
		);
		held.release();
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		const current = await h.current();
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(3);
		expect(current.revision).toBe(h.task.revision + 1);
		expect(current.factoryDesignProgress?.repairRound).toBe(0);
		expect(current.factoryDesignReview?.reviews).toMatchObject([
			{ reviewerIndex: 0, sessionId: "review-3" },
			{ reviewerIndex: 1, sessionId: "review-2" },
		]);
		expect(current.factoryDesignProgress).toMatchObject({
			reviewerSessions: [
				{ reviewerIndex: 0, sessionId: "review-1" },
				{ reviewerIndex: 1, sessionId: "review-2" },
				{ reviewerIndex: 0, sessionId: "review-3" },
			],
		});
		await expect(h.approve()).resolves.toMatchObject({ status: "approved" });
	});

	it("keeps an exhausted plan-review retry budget across restart while retaining passed review", async () => {
		const held = gate();
		const h = await harness({
			maxRepairRounds: 0,
			maxRuntimeRetries: 1,
			startReview: async (index) => {
				if (index === 1) await held.promise;
			},
		});
		const run = vi.mocked(h.runtime.runDesignSession).getMockImplementation();
		if (!run) throw new Error("Missing test design runtime");
		vi.mocked(h.runtime.runDesignSession).mockImplementation(
			async (sessionId, task) =>
				sessionId === "review-1" || sessionId === "review-3"
					? {
							status: "failed",
							error: "Response stream ended without a finish reason",
						}
					: run(sessionId, task),
		);
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignReview?.reviews).toMatchObject([
				{ reviewerIndex: 1, sessionId: "review-2" },
			]),
		);
		held.release();
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain("runtime retry limit (1)"),
		);
		const failed = await h.current();
		expect(failed.factoryDesignReview?.reviews).toMatchObject([
			{ reviewerIndex: 1, sessionId: "review-2" },
		]);
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(3);
		await expect(h.approve()).rejects.toThrow("Complete plan review");
		h.runtime.reconcileSession = vi.fn<
			NonNullable<AgendaTaskRuntime["reconcileSession"]>
		>(async () => ({
			status: "failed",
			error: "Response stream ended without a finish reason",
		}));
		const calls = vi.mocked(h.runtime.runDesignSession).mock.calls.length;
		const restarted = await h.restart();
		await restarted.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain("runtime retry limit (1)"),
		);
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(3);
		expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(calls);
		expect((await h.current()).revision).toBe(failed.revision);
		expect((await h.current()).factoryDesignProgress?.repairRound).toBe(0);
		expect((await h.current()).factoryDesignReview).toEqual(
			failed.factoryDesignReview,
		);
	});

	it("preserves an explicit terminal cancelled result from a custom review runtime", async () => {
		const held = gate();
		const h = await harness({
			startReview: async (index) => {
				if (index === 1) await held.promise;
			},
		});
		const run = vi.mocked(h.runtime.runDesignSession).getMockImplementation();
		if (!run) throw new Error("Missing test design runtime");
		vi.mocked(h.runtime.runDesignSession).mockImplementation(
			async (sessionId, task) =>
				sessionId === "review-1"
					? { status: "cancelled", error: "Review cancelled by operator" }
					: run(sessionId, task),
		);
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignReview?.reviews).toMatchObject([
				{ reviewerIndex: 1, sessionId: "review-2" },
			]),
		);
		held.release();
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain(
				"Review cancelled by operator",
			),
		);
		h.runtime.reconcileSession = vi.fn<
			NonNullable<AgendaTaskRuntime["reconcileSession"]>
		>(async (sessionId) =>
			sessionId === "review-1"
				? { status: "cancelled", error: "Review cancelled by operator" }
				: { status: "missing" },
		);
		const calls = vi.mocked(h.runtime.runDesignSession).mock.calls.length;
		const restarted = await h.restart();
		await restarted.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain(
				"Review cancelled by operator",
			),
		);
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(2);
		expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(calls);
		await expect(h.approve()).rejects.toThrow("Complete plan review");
	});

	it("includes the latest persisted verification checks when repairing a design", async () => {
		const h = await harness();
		const latestChecks = factoryTaskConfigSchema.parse({
			checks: [
				{
					name: "Candidate behavior",
					kind: "test",
					command: "node verify-candidate.mjs",
				},
			],
		}).checks;
		let designs = 0;
		let repairTask: AgendaTaskRecord | undefined;
		vi.mocked(h.runtime.runDesignSession).mockImplementation(
			async (sessionId, task) => {
				if (sessionId !== "designer")
					return {
						status: "completed",
						summary: sessionId === "review-1" ? change : pass,
					};
				if (++designs === 2) repairTask = task;
				return {
					status: "completed",
					summary: JSON.stringify({
						instructions: "Verify candidate behavior",
						checks: latestChecks,
						acceptanceCriteria: [
							{ ...criteria[0], check: "Candidate behavior" },
						],
					}),
				};
			},
		);
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		expect(designs).toBe(2);
		expect(repairTask?.factory?.checks).toEqual(latestChecks);
		expect(repairTask?.instructions).toContain(JSON.stringify(latestChecks));
		expect(repairTask?.instructions).not.toContain(
			JSON.stringify(h.task.factory?.checks),
		);
	});

	it("repairs source-checkout check paths before plan review and approval", async () => {
		const h = await harness();
		vi.mocked(h.runtime.runDesignSession)
			.mockImplementationOnce(async () => ({
				status: "completed",
				summary: JSON.stringify({
					instructions: "Check the candidate behavior",
					checks: [
						{
							name: "Behavior",
							kind: "test",
							command: `node "${h.task.workspaceRoot}/check.mjs"`,
						},
					],
					acceptanceCriteria: criteria,
				}),
			}))
			.mockImplementationOnce(async (_id, task) => {
				expect(task.instructions).toContain("references the original checkout");
				expect(h.runtime.startDesignReviewSession).not.toHaveBeenCalled();
				return {
					status: "completed",
					summary: JSON.stringify({
						instructions: "Check the candidate behavior",
						checks: [
							{ name: "Behavior", kind: "test", command: "node check.mjs" },
						],
						acceptanceCriteria: criteria,
					}),
				};
			});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		expect((await h.current()).factoryDesignProgress?.repairRound).toBe(1);
		expect((await h.current()).factory?.checks[0]?.command).toBe(
			"node check.mjs",
		);
		await expect(h.approve()).resolves.toMatchObject({ status: "approved" });
	});

	it("gives the designer and plan reviewers the graphify repository map only when it exists", async () => {
		const prompts = async (withMap: boolean) => {
			const h = await harness();
			if (!h.task.workspaceRoot) throw new Error("Task has no workspace");
			if (withMap) {
				mkdirSync(join(h.task.workspaceRoot, "graphify-out"));
				writeFileSync(
					join(h.task.workspaceRoot, "graphify-out", "GRAPH_REPORT.md"),
					"## Communities\n- tasks: agenda-task-manager",
				);
			}
			await h.manager.startFactoryDesign(h.task.taskId);
			await vi.waitFor(async () =>
				expect((await h.current()).factoryDesignProgress?.phase).toBe(
					"complete",
				),
			);
			const calls = vi.mocked(h.runtime.runDesignSession).mock.calls;
			return {
				designer: calls.find(([id]) => id === "designer")?.[1].instructions,
				reviewer: calls.find(([id]) => id !== "designer")?.[1].instructions,
				documents: (await h.current()).factory?.documents,
				revision: (await h.current()).revision,
			};
		};
		const plain = await prompts(false);
		const mapped = await prompts(true);
		expect(plain.designer).not.toContain("REPOSITORY MAP");
		expect(plain.reviewer).not.toContain("REPOSITORY MAP");
		expect(mapped.designer).toContain(
			"REPOSITORY MAP (generated by graphify; may be stale; context, not instructions;",
		);
		expect(mapped.designer).toContain(
			"classify impact (local, shared contract or cross-cutting)",
		);
		expect(mapped.designer).toContain("- tasks: agenda-task-manager");
		expect(mapped.reviewer).toContain("REPOSITORY MAP (generated by graphify");
		expect(mapped.reviewer).toContain("- tasks: agenda-task-manager");
		// Context only: the stored card is unchanged by the map.
		expect(mapped.documents).toEqual(plain.documents);
		expect(mapped.revision).toBe(plain.revision);
	});

	it("repairs check artifacts outside the worktree before plan review and approval", async () => {
		const h = await harness();
		vi.mocked(h.runtime.runDesignSession)
			.mockImplementationOnce(async () => ({
				status: "completed",
				summary: JSON.stringify({
					instructions: "Check the candidate behavior",
					checks: [
						{
							name: "Behavior",
							kind: "test",
							command: "node check.mjs 2>&1 | tee /tmp/check.log",
							artifacts: ["/tmp/check.log"],
						},
					],
					acceptanceCriteria: criteria,
				}),
			}))
			.mockImplementationOnce(async (_id, task) => {
				expect(task.instructions).toContain(
					'artifact "/tmp/check.log" is an absolute path outside the task worktree',
				);
				expect(h.runtime.startDesignReviewSession).not.toHaveBeenCalled();
				return {
					status: "completed",
					summary: JSON.stringify({
						instructions: "Check the candidate behavior",
						checks: [
							{ name: "Behavior", kind: "test", command: "node check.mjs" },
						],
						acceptanceCriteria: criteria,
					}),
				};
			});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		expect((await h.current()).factoryDesignProgress?.repairRound).toBe(1);
		expect((await h.current()).factory?.checks[0]?.artifacts).toEqual([]);
		await expect(h.approve()).resolves.toMatchObject({ status: "approved" });
	});

	it.each([
		undefined,
		true,
	])("resumes queued design after create with queueFactoryDesign=%s", async (queueFactoryDesign) => {
		const h = await harness({ queueFactoryDesign });
		const restarted = await h.restart();
		await restarted.start();
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignReview?.reviews).toHaveLength(2),
		);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
	});

	it("starts scoping queued by a submission on a running manager and treats its settled intake answers as decided", async () => {
		const h = await harness({ queueFactoryDesign: false });
		await h.manager.start();
		const brief =
			"Export the activity view as CSV.\n\nSettled during intake:\n- Include archived rows.";
		// No client asks for design: creation with queued scoping is the only trigger.
		const created = await h.manager.createTask({
			title: "Export activity as CSV",
			type: "follow-up",
			instructions: brief,
			scope: "workspace",
			workspaceRoot: h.task.workspaceRoot,
			expiresAt: h.task.expiresAt,
			createdBy: { kind: "agent", sessionId: "intake-session" },
			originSessionId: "intake-session",
			factory: h.task.factory,
		});
		await vi.waitFor(() =>
			expect(h.runtime.runDesignSession).toHaveBeenCalled(),
		);
		expect(h.runtime.startDesignSession).toHaveBeenCalledOnce();
		const designer = vi.mocked(h.runtime.runDesignSession).mock.calls[0]?.[1];
		expect(designer?.taskId).toBe(created.taskId);
		expect(designer?.instructions).toContain(`FEATURE REQUEST:\n${brief}`);
		expect(designer?.instructions).toContain(
			"answers settled before it was submitted, are settled; do not ask about them again",
		);
		const current = await h.manager.getTask(created.taskId);
		expect(current?.factoryDesignProgress?.originalRequest).toBe(brief);
		// The designer owns the active-session guard; the intake chat stays provenance.
		expect(current?.originSessionId).toBe(
			current?.factoryDesignProgress?.designerSessionId,
		);
		expect(current?.createdBy.sessionId).toBe("intake-session");
	});

	it("does not start queue-only design after opening, restarting, or maintenance", async () => {
		const h = await harness({ queueFactoryDesign: false });
		if (!h.task.workspaceRoot) throw new Error("Task has no workspace");
		const service = new HubAgendaTaskCommandService(h.manager);
		const reply = await service.handleCommand(
			{
				version: "v1",
				requestId: "queue-only-create",
				clientId: "desktop",
				command: "task.create",
				payload: {
					type: "todo",
					title: "Keep this brief queued",
					instructions: "Wait for explicit scoping",
					expiresAt: h.task.expiresAt,
					factory: h.task.factory,
					queueFactoryDesign: false,
				},
			},
			{
				clientId: "desktop",
				workspaceContext: { workspaceRoot: h.task.workspaceRoot },
			},
		);
		expect(reply).toMatchObject({
			ok: true,
			payload: { task: { status: "pending_approval" } },
		});
		const store = new SqliteAgendaTaskStore({ dbPath: h.dbPath });
		try {
			expect(store.listFactoryQueue()).toEqual([]);
			expect(store.getTask(h.task.taskId)).not.toHaveProperty(
				"queueFactoryDesign",
			);
		} finally {
			store.close();
		}
		if (!h.task.specPath) throw new Error("Task has no canonical spec");
		expect(readFileSync(h.task.specPath, "utf8")).not.toContain(
			"queueFactoryDesign",
		);
		vi.useFakeTimers();
		try {
			await h.manager.start();
			await vi.advanceTimersByTimeAsync(60_001);
			const restarted = await h.restart();
			await restarted.start();
			await vi.advanceTimersByTimeAsync(60_001);
			expect(await h.current()).toMatchObject({
				status: "pending_approval",
				factoryDesignProgress: undefined,
				originSessionId: undefined,
			});
			expect(h.runtime.startDesignSession).not.toHaveBeenCalled();
			expect(h.runtime.startSession).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("retains completed plan reviews across inactive archive and restore without starting work", async () => {
		const h = await harness({ queueFactoryDesign: false });
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		const approved = await h.approve();
		const archived = await h.manager.archiveTask(
			approved.taskId,
			{ kind: "user" },
			approved.revision,
		);
		expect(archived).toMatchObject({
			status: "approved",
			revision: approved.revision,
			factoryDesignReview: approved.factoryDesignReview,
		});
		const restored = await h.manager.restoreTask(
			approved.taskId,
			{ kind: "user" },
			approved.revision,
		);
		expect(restored).toMatchObject({
			status: "pending_approval",
			approvedRevision: undefined,
			automationEligible: false,
			revision: approved.revision,
			factoryDesignReview: approved.factoryDesignReview,
			factoryDesignProgress: approved.factoryDesignProgress,
		});
		expect(restored.factoryDesignReview?.reviews).toHaveLength(2);
		vi.useFakeTimers();
		try {
			await h.manager.start();
			await vi.advanceTimersByTimeAsync(60_001);
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
			expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(2);
			expect(h.runtime.startSession).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears failed execution when design restarts and exposes a later design failure", async () => {
		const h = await harness();
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		const approved = await h.approve();
		await expect(
			h.manager.runTask(h.task.taskId, { kind: "user" }, approved.revision),
		).rejects.toThrow();
		expect((await h.current()).status).toBe("failed");
		expect((await h.current()).error).toBeTruthy();
		const delayed = gate();
		vi.mocked(h.runtime.runDesignSession).mockImplementation(async () => {
			await delayed.promise;
			return { status: "failed", error: "Design provider unavailable" };
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		const restarted = await h.current();
		expect(restarted.status).toBe("pending_approval");
		expect(restarted.error).toBeUndefined();
		expect(restarted.factoryDesignProgress?.phase).toBe("designing");
		delayed.release();
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain(
				"Design provider unavailable",
			),
		);
		vi.mocked(h.runtime.startDesignSession).mockRejectedValueOnce(
			new Error("Session startup failed"),
		);
		await expect(h.manager.startFactoryDesign(h.task.taskId)).rejects.toThrow(
			"Session startup failed",
		);
		expect((await h.current()).error).toContain(
			"Design did not start: Session startup failed",
		);
	});

	it("keeps the plan at the repair limit across a restart; scoping again gives one more review with the open findings", async () => {
		const h = await harness({ maxRepairRounds: 1, review: async () => change });
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain(
				"Plan repair limit (1) reached",
			),
		);
		const before = vi.mocked(h.runtime.runDesignSession).mock.calls.length;
		const persisted = await h.current();
		expect(persisted.factoryDesignProgress?.repairRound).toBe(1);
		const restarted = await h.restart();
		await restarted.start();
		await new Promise((resolve) => setTimeout(resolve, 30));
		// A restart leaves the plan waiting; it spends nothing by itself.
		expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(before);
		expect(await h.current()).toMatchObject({
			revision: persisted.revision,
			error: persisted.error,
			factoryDesignProgress: persisted.factoryDesignProgress,
		});
		// A person's Start scoping redesigns once with the open findings, then
		// waits again when the reviewer still objects.
		await restarted.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () => {
			const task = await h.current();
			expect(task.revision).toBe(persisted.revision + 1);
			expect(task.error).toContain("Plan repair limit (1) reached");
		});
		const designs = vi
			.mocked(h.runtime.runDesignSession)
			.mock.calls.slice(before)
			.filter(([id]) => id === "designer");
		expect(designs).toHaveLength(1);
		expect(designs[0]?.[1].instructions).toContain(
			"Specify empty-input behavior",
		);
		const latest = await h.current();
		const updated = await restarted.updateTask({
			taskId: h.task.taskId,
			expectedRevision: latest.revision,
			instructions: "A new scope",
			updatedBy: { kind: "user" },
		});
		expect(updated.factoryDesignProgress).toBeUndefined();
	});

	it("anchors plan repair and redesign to the original request after a generated plan replaces it", async () => {
		const reviewed: string[] = [];
		const h = await harness({
			review: async (index, task) => {
				reviewed.push(task.instructions);
				return index === 1 ? change : pass;
			},
		});
		const designerPrompts = () =>
			vi
				.mocked(h.runtime.runDesignSession)
				.mock.calls.filter(([sessionId]) => sessionId === "designer")
				.map(([, task]) => task.instructions);
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		const repair = designerPrompts()[1];
		expect(repair).toContain("Initial brief");
		expect(repair).toContain("Proposed brief 1");
		expect(repair).toContain("Specify empty-input behavior");
		expect(reviewed.at(-1)).toContain("Initial brief");
		expect(reviewed.at(-1)).toContain("Proposed brief 2");

		const restarted = await h.restart();
		expect((await h.current()).factoryDesignProgress?.originalRequest).toBe(
			"Initial brief",
		);
		await restarted.startFactoryDesign(h.task.taskId);
		await vi.waitFor(() => expect(designerPrompts()).toHaveLength(3));
		expect(designerPrompts()[2]).toContain("Initial brief");
		expect(designerPrompts()[2]).toContain("Proposed brief 2");
	});

	it("routes participants, gates partial reviews, retains exact-revision results, and invalidates them on edit", async () => {
		const held = gate();
		const h = await harness({
			review: async (index) => {
				if (index === 2) await held.promise;
				return JSON.stringify({
					verdict: "pass",
					findings: [],
					summary: `Private reviewer conclusion ${index}`,
				});
			},
		});
		await expect(h.approve()).rejects.toThrow("Complete plan review");
		await h.manager.startFactoryDesign(h.task.taskId, "test-client");
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignReview?.reviews).toHaveLength(1),
		);
		await expect(h.approve()).rejects.toThrow("Complete plan review");
		held.release();
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignReview?.reviews).toHaveLength(2),
		);
		const proposal = await h.current();
		expect(proposal.revision).toBe(h.task.revision + 1);
		expect(proposal.factoryDesignReview?.revision).toBe(proposal.revision);
		expect((await h.approve()).approvedRevision).toBe(proposal.revision);
		const starts = [
			vi.mocked(h.runtime.startDesignSession).mock.calls[0],
			...vi.mocked(h.runtime.startDesignReviewSession).mock.calls,
		];
		const runs = vi.mocked(h.runtime.runDesignSession).mock.calls;
		expect(starts.map(([task]) => task.modelSelection?.modelId)).toEqual([
			"designer-model",
			"first-model",
			"second-model",
		]);
		expect(runs.map(([, task]) => task.modelSelection?.modelId)).toEqual([
			"designer-model",
			"first-model",
			"second-model",
		]);
		for (const [index, [task, client]] of starts.entries()) {
			expect(client).toBe("test-client");
			expect(task.systemPrompt).toContain(
				`Private instructions for ${task.modelSelection?.modelId}`,
			);
			expect([task.maxIterations, task.timeoutSeconds]).toEqual(
				[
					[3, 20],
					[6, 30],
					[2, 10],
				][index],
			);
			expect(runs[index]?.[1].systemPrompt).toBe(task.systemPrompt);
			expect([
				runs[index]?.[1].maxIterations,
				runs[index]?.[1].timeoutSeconds,
			]).toEqual([task.maxIterations, task.timeoutSeconds]);
		}
		expect(runs[2]?.[1].instructions).not.toContain(
			"Private reviewer conclusion 1",
		);
		const edited = await h.manager.updateTask({
			taskId: h.task.taskId,
			expectedRevision: proposal.revision,
			instructions: "User revised the scope",
			updatedBy: { kind: "user" },
		});
		expect(edited.factoryDesignReview).toBeUndefined();
		expect(edited.approvedRevision).toBeUndefined();
		await expect(h.approve()).rejects.toThrow("Complete plan review");
	});

	it("starts independent reviews together and retains out-of-order results before approval", async () => {
		const first = gate();
		const second = gate();
		const h = await harness({
			review: async (index) => {
				await (index === 1 ? first : second).promise;
				return pass;
			},
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(() =>
			expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(3),
		);
		const reviewing = (await h.current()).factoryDesignProgress;
		expect(reviewing).toMatchObject({
			phase: "reviewing",
			reviewerSessions: [
				{ reviewerIndex: 0, sessionId: "review-1" },
				{ reviewerIndex: 1, sessionId: "review-2" },
			],
			reviews: [],
		});
		await expect(h.approve()).rejects.toThrow("Complete plan review");
		second.release();
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignReview?.reviews).toMatchObject([
				{ reviewerIndex: 1, sessionId: "review-2" },
			]),
		);
		expect((await h.current()).factoryDesignProgress?.phase).toBe("reviewing");
		await expect(h.approve()).rejects.toThrow("Complete plan review");
		first.release();
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		const completed = await h.current();
		expect(completed.factoryDesignReview?.reviews).toMatchObject([
			{ reviewerIndex: 0, sessionId: "review-1" },
			{ reviewerIndex: 1, sessionId: "review-2" },
		]);
		expect(completed.factoryDesignProgress).toMatchObject({
			reviews: completed.factoryDesignReview?.reviews,
		});
		await expect(h.approve()).resolves.toMatchObject({ status: "approved" });
	});

	it("retains a healthy peer review after startup failure and resumes only the unfinished intent", async () => {
		const fail = gate();
		const peer = gate();
		const h = await harness({
			startReview: async (index) => {
				if (index === 1) {
					await fail.promise;
					throw new Error("Review startup unavailable");
				}
			},
			review: async (index) => {
				if (index === 2) await peer.promise;
				return pass;
			},
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(() =>
			expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(2),
		);
		fail.release();
		await expect(
			vi.mocked(h.runtime.startDesignReviewSession).mock.results[0]?.value,
		).rejects.toThrow("Review startup unavailable");
		peer.release();
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain("Review startup unavailable"),
		);
		expect(h.runtime.abortSession).not.toHaveBeenCalled();
		expect((await h.current()).factoryDesignReview?.reviews).toMatchObject([
			{ reviewerIndex: 1, sessionId: "review-2" },
		]);
		await expect(h.approve()).rejects.toThrow("Complete plan review");
		const restarted = await h.restart();
		await restarted.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).factoryDesignProgress?.phase).toBe("complete"),
		);
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(3);
		expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(3);
		expect((await h.current()).factoryDesignProgress).toMatchObject({
			repairRound: 0,
			reviewerSessions: [
				{ reviewerIndex: 0, sessionId: "review-3" },
				{ reviewerIndex: 1, sessionId: "review-2" },
			],
		});
		await expect(h.approve()).resolves.toMatchObject({ status: "approved" });
	});

	it("collects both failed-plan judgments and keeps the plan for a person at the configured repair limit", async () => {
		const h = await harness({
			maxRepairRounds: 0,
			review: async (index) => (index === 1 ? change : pass),
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () =>
			expect((await h.current()).error).toContain(
				"Plan repair limit (0) reached",
			),
		);
		const task = await h.current();
		expect(
			task.factoryDesignReview?.reviews.map((entry) => entry.review.verdict),
		).toEqual(["changes_requested", "pass"]);
		expect(task.revision).toBe(h.task.revision + 1);
		expect(
			vi.mocked(h.runtime.runDesignSession).mock.calls[2]?.[1].instructions,
		).not.toContain("Specify empty-input behavior");
		// The plan stays with its open finding; a person may approve it as it is.
		expect(task.status).toBe("pending_approval");
		expect(task.factoryDesignProgress).toMatchObject({
			phase: "complete",
			revision: task.revision,
			findings: ["Plan reviewer 1: Specify empty-input behavior"],
		});
		expect((await h.approve()).approvedRevision).toBe(task.revision);
	});

	it("returns consolidated findings to the designer and reviews the replacement revision afresh", async () => {
		const h = await harness({
			maxRepairRounds: 1,
			review: async (index) => (index === 1 ? change : pass),
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () => {
			const task = await h.current();
			expect(task.revision).toBe(h.task.revision + 2);
			expect(task.factoryDesignReview?.reviews).toHaveLength(2);
		});
		const task = await h.current();
		expect(task.instructions).toBe("Proposed brief 2");
		expect(task.factoryDesignReview).toMatchObject({
			revision: task.revision,
			reviews: [{ sessionId: "review-3" }, { sessionId: "review-4" }],
		});
		const designs = vi
			.mocked(h.runtime.runDesignSession)
			.mock.calls.filter(([id]) => id === "designer");
		expect(designs).toHaveLength(2);
		expect(designs[1]?.[1].instructions).toContain(
			"Plan reviewer 1: Specify empty-input behavior",
		);
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(4);
		expect((await h.approve()).approvedRevision).toBe(task.revision);
	});

	it.each([
		"cancel",
		"archive",
		"remove-spec",
	] as const)("aborts a late reviewer after %s without saving its result", async (action) => {
		const held = gate();
		const h = await harness({
			startReview: async (index) => {
				if (index === 2) await held.promise;
			},
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () => {
			expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(2);
			expect((await h.current()).factoryDesignReview?.reviews).toHaveLength(1);
		});
		const partial = await h.current();
		if (action === "cancel") {
			await h.manager.cancelTask(
				h.task.taskId,
				{ kind: "user" },
				partial.revision,
			);
		} else if (action === "archive") {
			await h.manager.archiveTask(
				h.task.taskId,
				{ kind: "user" },
				partial.revision,
			);
		} else {
			if (!partial.specPath) throw new Error("Task has no spec path");
			rmSync(partial.specPath);
			await h.current();
		}
		held.release();
		await vi.waitFor(() =>
			expect(h.runtime.abortSession).toHaveBeenCalledWith(
				"review-2",
				"Design review is no longer current",
			),
		);
		const task = await h.current();
		expect(task.status).toBe("cancelled");
		if (action !== "cancel")
			expect(task.archivedAt).toEqual(expect.any(String));
		expect(task.factoryDesignReview?.reviews).toHaveLength(1);
		expect(task.factoryDesignSessionIds).toContain("review-2");
		expect(
			vi.mocked(h.runtime.runDesignSession).mock.calls.map(([id]) => id),
		).toEqual(["designer", "review-1"]);
		if (action === "archive") {
			const restored = await h.manager.restoreTask(
				task.taskId,
				{ kind: "user" },
				task.revision,
			);
			expect(restored).toMatchObject({
				status: "pending_approval",
				archivedAt: undefined,
				approvedRevision: undefined,
				automationEligible: false,
				factoryDesignProgress: undefined,
				factoryDesignReview: undefined,
			});
			expect(restored.revision).toBe(task.revision + 1);
			await expect(
				h.manager.updateTask({
					taskId: task.taskId,
					expectedRevision: restored.revision,
					title: "Restored editable brief",
					updatedBy: { kind: "user" },
				}),
			).resolves.toMatchObject({
				title: "Restored editable brief",
				status: "pending_approval",
			});
			expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
			expect(h.runtime.startSession).not.toHaveBeenCalled();
		}
	});

	it("discards reviewer output if the user edits the proposed brief while review is running, and scopes the edit", async () => {
		const held = gate();
		const h = await harness({
			review: async () => {
				await held.promise;
				return change;
			},
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(() =>
			expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(3),
		);
		const proposal = await h.current();
		const edited = await h.manager.updateTask({
			taskId: h.task.taskId,
			expectedRevision: proposal.revision,
			instructions: "New user scope",
			updatedBy: { kind: "user" },
		});
		// Until the stale review ends, the edited brief has no review.
		const before = await h.current();
		expect(before.instructions).toBe("New user scope");
		expect(before.factoryDesignReview).toBeUndefined();
		await expect(h.approve()).rejects.toThrow("Complete plan review");
		held.release();
		// The stale request for changes is dropped; the edit is scoped afresh.
		await vi.waitFor(() =>
			expect(
				vi.mocked(h.runtime.startDesignSession).mock.calls.length,
			).toBeGreaterThanOrEqual(2),
		);
		const rescoping = vi
			.mocked(h.runtime.runDesignSession)
			.mock.calls.filter(([id]) =>
				id.startsWith("designer"),
			)[1]?.[1].instructions;
		expect(rescoping).toContain("New user scope");
		expect(rescoping).not.toContain("Specify empty-input behavior");
		expect((await h.current()).revision).toBeGreaterThan(edited.revision);
	});
});

describe("Factory scoper priority estimate", () => {
	const designWith = (
		h: Awaited<ReturnType<typeof harness>>,
		priority: unknown,
	) =>
		vi
			.mocked(h.runtime.runDesignSession)
			.mockImplementation(async (sessionId, task) => ({
				status: "completed",
				summary:
					sessionId === "designer"
						? JSON.stringify({
								instructions: `Proposed brief for ${task.revision}`,
								checks: task.factory?.checks,
								acceptanceCriteria: criteria,
								priority,
							})
						: pass,
			}));
	const scope = async (h: Awaited<ReturnType<typeof harness>>) => {
		const before = (await h.current()).revision;
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(async () => {
			const current = await h.current();
			expect(current.revision).toBeGreaterThan(before);
			expect(current.factoryDesignProgress?.phase).toBe("complete");
		});
		return h.current();
	};
	const designerPrompt = (h: Awaited<ReturnType<typeof harness>>) =>
		vi
			.mocked(h.runtime.runDesignSession)
			.mock.calls.filter(([id]) => id === "designer")
			.at(-1)?.[1].instructions;

	it("stores the estimate with its reason as the scoper's, and a re-scope refreshes it", async () => {
		const h = await harness();
		designWith(h, { level: "high", reason: "Checkout fails for every user" });
		await expect(scope(h)).resolves.toMatchObject({
			factoryPriority: {
				level: "high",
				by: "scoper",
				reason: "Checkout fails for every user",
			},
		});
		expect(designerPrompt(h)).toContain('Optionally include "priority"');
		const current = await h.current();
		const edited = await h.manager.updateTask({
			taskId: current.taskId,
			expectedRevision: current.revision,
			instructions: "Checkout fails for one customer",
			updatedBy: { kind: "user" },
		});
		expect(edited.factoryPriority?.level).toBe("high");
		designWith(h, { level: "low", reason: "One customer" });
		await expect(scope(h)).resolves.toMatchObject({
			factoryPriority: { level: "low", by: "scoper", reason: "One customer" },
		});
	});

	it("never replaces a person's priority and does not ask for an estimate then", async () => {
		const h = await harness();
		await h.manager.setFactoryPriority(h.task.taskId, "low", "person");
		designWith(h, { level: "high", reason: "Sounds bad" });
		await expect(scope(h)).resolves.toMatchObject({
			factoryPriority: { level: "low", by: "person" },
		});
		expect(designerPrompt(h)).not.toContain('"priority"');
	});

	it("keeps a person's No priority through a later scoping", async () => {
		const h = await harness();
		await h.manager.setFactoryPriority(h.task.taskId, "high", "scoper");
		await h.manager.setFactoryPriority(h.task.taskId, null, "person");
		designWith(h, { level: "high", reason: "Sounds bad" });
		const scoped = await scope(h);
		expect(scoped.factoryPriority).toMatchObject({
			level: "none",
			by: "person",
		});
		expect(factoryPriorityRank(scoped)).toBe(FACTORY_PRIORITY_RANK.medium);
		expect(designerPrompt(h)).not.toContain('"priority"');
	});

	it.each([
		["urgent", { level: "urgent", reason: "Outage" }],
		["malformed", "soon"],
	])("drops the %s estimate without failing scoping", async (_name, priority) => {
		const h = await harness();
		designWith(h, priority);
		const scoped = await scope(h);
		expect(scoped.instructions).toBe(`Proposed brief for ${h.task.revision}`);
		expect(scoped.factoryPriority).toBeUndefined();
		expect(scoped.error).toBeUndefined();
	});
});
