import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgendaTaskRecord } from "@cline/shared";
import { factoryTaskConfigSchema } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgendaTaskManager,
	type AgendaTaskRuntime,
} from "./agenda-task-manager";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0)) await dispose();
});
function harness(
	options: { review?: string; failures?: number; hold?: boolean } = {},
) {
	const root = mkdtempSync(join(tmpdir(), "cline-factory-workflow-"));
	const repo = join(root, "repo");
	execFileSync("git", ["init", "-b", "main", repo]);
	execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
	execFileSync("git", [
		"-C",
		repo,
		"config",
		"user.email",
		"test@example.invalid",
	]);
	writeFileSync(join(repo, "feature.txt"), "before\n");
	execFileSync("git", ["-C", repo, "add", "."]);
	execFileSync("git", ["-C", repo, "commit", "-m", "Initial"]);
	let sessionIndex = 0;
	const roles = new Map<string, string>();
	let builds = 0;
	let reviews = 0;
	let release: (() => void) | undefined;
	const runtime: AgendaTaskRuntime = {
		startSession: vi.fn(async (_task, _run, _client, config) => {
			const sessionId = `session_${++sessionIndex}`;
			roles.set(sessionId, config?.factoryRole ?? "builder");
			return { sessionId };
		}),
		runSession: vi.fn<AgendaTaskRuntime["runSession"]>(async (id, task) => {
			if (roles.get(id) === "reviewer") {
				reviews++;
				return {
					status: "completed",
					summary:
						options.review ??
						JSON.stringify({
							verdict: "pass",
							findings: [],
							summary: "Reviewed behavior and maintainability.",
						}),
				};
			}
			builds++;
			writeFileSync(
				join(task.cwd ?? "", "feature.txt"),
				builds <= (options.failures ?? 0) ? "wrong\n" : "after\n",
			);
			if (options.hold)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return { status: "completed", summary: "Implemented" };
		}),
		abortSession: vi.fn(async () => release?.()),
	};
	const manager = new AgendaTaskManager({
		runtime,
		dbPath: join(root, "tasks.db"),
		globalSpecsDir: join(root, "specs"),
		watchFiles: false,
		automationEnabled: false,
	});
	cleanup.push(async () => {
		await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	const create = async (maxRepairRounds = 2) =>
		manager.createTask({
			title: "Update feature",
			type: "follow-up",
			instructions: "Acceptance: feature.txt contains after.",
			scope: "workspace",
			workspaceRoot: repo,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			createdBy: { kind: "user" },
			factory: factoryTaskConfigSchema.parse({
				maxRepairRounds,
				checks: [
					{
						name: "Feature behavior",
						kind: "api",
						command: `node -e "if(require('fs').readFileSync('feature.txt','utf8').trim()!=='after')process.exit(1)"`,
					},
				],
			}),
		});
	const start = async (task: AgendaTaskRecord) => {
		await manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		return manager.runTask(
			task.taskId,
			{ kind: "user" },
			task.revision,
			"test",
		);
	};
	return {
		manager,
		create,
		start,
		runtime,
		repo,
		builds: () => builds,
		reviews: () => reviews,
	};
}

describe("feature workflow", () => {
	it("repairs a failed real check, reviews a fresh candidate, and retains the isolated workspace", async () => {
		const h = harness({ failures: 1 });
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe(
					"completed",
				),
			{ timeout: 15000 },
		);
		const state = h.manager.getTaskRuns(task.taskId)[0]?.factory;
		expect(state).toMatchObject({
			phase: "ready",
			repairRound: 1,
			checks: [{ status: "passed" }],
			review: { verdict: "pass" },
		});
		expect(state?.sessions.map((session) => session.role)).toEqual([
			"builder",
			"reviewer",
		]);
		expect(h.builds()).toBe(2);
		expect(h.reviews()).toBe(1);
		expect(readFileSync(join(h.repo, "feature.txt"), "utf8")).toBe("before\n");
		expect(state?.pullRequestUrl).toBeUndefined();
	});
	it("stops at the configured repair limit without turning failed checks into success", async () => {
		const h = harness({ failures: 10 });
		const task = await h.create(1);
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory).toMatchObject({
			phase: "blocked",
			repairRound: 1,
			checks: [{ status: "failed" }],
		});
		expect(h.builds()).toBe(2);
		expect(h.reviews()).toBe(0);
	});
	it("requires structured independent review and rejects an unstructured all-clear", async () => {
		const h = harness({ review: "Everything looks good!" });
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(
			async () =>
				expect((await h.manager.getTask(task.taskId))?.status).toBe("failed"),
			{ timeout: 15000 },
		);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory?.phase).toBe(
			"blocked",
		);
	});
	it("advances an explicitly approved queue while legacy automation stays disabled", async () => {
		const h = harness();
		const tasks = [await h.create(), await h.create()];
		for (const task of tasks)
			await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		await h.manager.startFactoryQueue(
			tasks.map((task) => ({
				taskId: task.taskId,
				expectedRevision: task.revision,
			})),
			{ kind: "user" },
			"test",
		);
		await vi.waitFor(
			async () => {
				for (const task of tasks)
					expect((await h.manager.getTask(task.taskId))?.status).toBe(
						"completed",
					);
			},
			{ timeout: 15000 },
		);
		expect(h.builds()).toBe(2);
	});
	it("cancels an active writer and prevents verification and reviewer stages", async () => {
		const h = harness({ hold: true });
		const task = await h.create();
		await h.start(task);
		await vi.waitFor(() => expect(h.builds()).toBe(1));
		await h.manager.cancelTask(task.taskId, { kind: "user" }, task.revision);
		expect((await h.manager.getTask(task.taskId))?.status).toBe("cancelled");
		expect(h.runtime.abortSession).toHaveBeenCalled();
		expect(h.reviews()).toBe(0);
		expect(h.manager.getTaskRuns(task.taskId)[0]?.factory?.checks).toEqual([]);
	});
	it("keeps design sessions singular across windows and persists the relationship", async () => {
		const h = harness();
		h.runtime.startDesignSession = vi.fn(async () => ({ sessionId: "design" }));
		const task = await h.create();
		expect(
			await Promise.all([
				h.manager.startFactoryDesign(task.taskId),
				h.manager.startFactoryDesign(task.taskId),
			]),
		).toEqual([{ sessionId: "design" }, { sessionId: "design" }]);
		expect(h.runtime.startDesignSession).toHaveBeenCalledTimes(1);
		expect((await h.manager.getTask(task.taskId))?.originSessionId).toBe(
			"design",
		);
	});
	it("rejects cloud execution explicitly and invalidates approval when checks change", async () => {
		const h = harness();
		const task = await h.create();
		await h.manager.approveTask(task.taskId, { kind: "user" }, task.revision);
		const updated = await h.manager.updateTask({
			taskId: task.taskId,
			expectedRevision: task.revision,
			factory: factoryTaskConfigSchema.parse({
				execution: "cloud",
				checks: [{ name: "Route", kind: "api", command: "true" }],
			}),
			updatedBy: { kind: "user" },
		});
		expect(updated.status).toBe("pending_approval");
		expect(updated.approvedRevision).toBeUndefined();
		await expect(
			h.manager.runTask(task.taskId, { kind: "user" }, updated.revision),
		).rejects.toThrow("Cloud factory execution is not available");
		expect(h.runtime.startSession).not.toHaveBeenCalled();
	});
});
