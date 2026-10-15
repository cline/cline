import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgendaTaskRecord } from "@cline/shared";
import { factoryTaskConfigSchema } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
} from "./agenda-task-manager";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0)) await dispose();
});
const pass = JSON.stringify({
	verdict: "pass",
	findings: [],
	summary: "Independent review passed",
});
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
		runSession: vi.fn(async () => ({ status: "completed" })),
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
								checks: task.factory?.checks,
							})
						: ((await options.review?.(
								Number(sessionId.split("-")[1]),
								task,
							)) ?? pass),
			}),
		),
	};
	const manager = new AgendaTaskManager({
		runtime,
		dbPath: join(root, "tasks.db"),
		globalSpecsDir: join(root, "specs"),
		watchFiles: false,
		automationEnabled: false,
	});
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
		maxIterations: 6,
		timeoutSeconds: 30,
		factory: factoryTaskConfigSchema.parse({
			maxRepairRounds: options.maxRepairRounds ?? 2,
			checks: [{ name: "Behavior", kind: "test", command: "true" }],
			agents: {
				designer: participant("designer-model", 3, 20),
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
	return { manager, runtime, task, current, approve };
}

describe("Factory design review", () => {
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

	it("collects both failed-plan judgments and blocks approval at the configured repair limit", async () => {
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
		await expect(h.approve()).rejects.toThrow("Complete plan review");
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

	it("aborts a reviewer whose session starts after cancellation without saving its result", async () => {
		const held = gate();
		const h = await harness({
			startReview: async (index) => {
				if (index === 2) await held.promise;
			},
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(() =>
			expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(2),
		);
		const partial = await h.current();
		await h.manager.cancelTask(
			h.task.taskId,
			{ kind: "user" },
			partial.revision,
		);
		held.release();
		await vi.waitFor(() =>
			expect(h.runtime.abortSession).toHaveBeenCalledWith(
				"review-2",
				"Design review is no longer current",
			),
		);
		const task = await h.current();
		expect(task.status).toBe("cancelled");
		expect(task.factoryDesignReview?.reviews).toHaveLength(1);
		expect(
			vi.mocked(h.runtime.runDesignSession).mock.calls.map(([id]) => id),
		).toEqual(["designer", "review-1"]);
	});

	it("discards reviewer output if the user edits the proposed brief while review is running", async () => {
		const held = gate();
		const h = await harness({
			review: async () => {
				await held.promise;
				return change;
			},
		});
		await h.manager.startFactoryDesign(h.task.taskId);
		await vi.waitFor(() =>
			expect(h.runtime.runDesignSession).toHaveBeenCalledTimes(2),
		);
		const proposal = await h.current();
		const edited = await h.manager.updateTask({
			taskId: h.task.taskId,
			expectedRevision: proposal.revision,
			instructions: "New user scope",
			updatedBy: { kind: "user" },
		});
		held.release();
		await new Promise<void>((resolve) => setImmediate(resolve));
		const task = await h.current();
		expect(task.revision).toBe(edited.revision);
		expect(task.instructions).toBe("New user scope");
		expect(task.factoryDesignReview).toBeUndefined();
		expect(h.runtime.startDesignReviewSession).toHaveBeenCalledTimes(1);
		await expect(h.approve()).rejects.toThrow("Complete plan review");
	});
});
