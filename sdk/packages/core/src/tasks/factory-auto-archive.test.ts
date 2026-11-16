import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgendaTaskRecord,
	FactoryAutoArchiveSettings,
	FactoryRunState,
} from "@cline/shared";
import { factoryTaskConfigSchema } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaTaskManager } from "./agenda-task-manager";
import { createFactoryStatusTool } from "./factory-tool";
import { SqliteAgendaTaskStore } from "./store/sqlite-task-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERSON = { kind: "user", id: "desktop" } as const;
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0)) await dispose();
	vi.useRealTimers();
});

function harness(
	settings: FactoryAutoArchiveSettings = {
		archiveOnPullRequestClose: true,
		archiveAfterDays: 7,
	},
) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "cline-auto-archive-")));
	const workspaceRoot = join(root, "repo");
	mkdirSync(workspaceRoot);
	const dbPath = join(root, "tasks.db");
	const manager = new AgendaTaskManager({
		runtime: {
			startSession: vi.fn(async () => ({ sessionId: "unused" })),
			runSession: vi.fn(async () => ({ status: "completed" as const })),
			abortSession: vi.fn(async () => {}),
		},
		dbPath,
		globalSpecsDir: join(root, "specs"),
		watchFiles: false,
		automationEnabled: false,
		factoryStorageDir: join(root, "factory"),
		resolveFactoryAutoArchive: async () => settings,
	});
	const store = new SqliteAgendaTaskStore({ dbPath });
	disposals.push(async () => {
		store.close();
		await manager.dispose();
		rmSync(root, { recursive: true, force: true });
	});
	/** A delivered card with a draft PR, as the workflow records it. */
	const delivered = async (state: Partial<FactoryRunState> = {}) => {
		const task = await manager.createTask({
			title: "Add CSV export",
			type: "follow-up",
			instructions: "Brief",
			scope: "workspace",
			workspaceRoot,
			expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
			createdBy: PERSON,
			queueFactoryDesign: false,
			factory: factoryTaskConfigSchema.parse({ publishPullRequest: true }),
		});
		const run = store.createRun({
			taskId: task.taskId,
			taskRevision: task.revision,
			status: "completed",
			factory: {
				phase: "ready",
				repairRound: 0,
				sessions: [],
				workspace: {
					path: join(root, "factory", task.taskId),
					branch: `factory/${task.taskId}`,
					baseBranch: "main",
					baseCommit: "base",
				},
				pullRequestUrl: "https://github.com/o/r/pull/41",
				...state,
			},
		});
		store.updateRun(run.runId, { completedAt: new Date().toISOString() });
		store.dequeueFactory(task.taskId);
		return store.updateTaskState(task.taskId, {
			status: "completed",
			lastRunId: run.runId,
			completedAt: new Date().toISOString(),
		}) as AgendaTaskRecord;
	};
	const merged = (at = new Date().toISOString()) =>
		delivered({
			pullRequestOutcome: { state: "merged", headChanged: false, at },
		});
	/** One maintenance pass of auto-archiving. */
	const pass = () =>
		(
			manager as unknown as { autoArchiveFactoryCards(): Promise<void> }
		).autoArchiveFactoryCards();
	const get = (taskId: string) => store.getTask(taskId) as AgendaTaskRecord;
	const later = (days: number) =>
		vi.setSystemTime(new Date(Date.now() + days * DAY_MS));
	return { manager, store, workspaceRoot, delivered, merged, pass, get, later };
}

describe("archiving finished work automatically", () => {
	it("archives a delivered card whose pull request merged, as Factory and with the reason", async () => {
		const h = harness();
		const card = await h.merged();
		const closed = await h.delivered({
			pullRequestOutcome: {
				state: "closed",
				headChanged: false,
				at: new Date().toISOString(),
			},
		});
		await h.pass();
		const archived = h.get(card.taskId);
		const workspaceRoot = h.workspaceRoot;
		expect(archived.archivedAt).toBeDefined();
		expect(archived.updatedBy).toEqual({
			kind: "system",
			id: "factory_auto_archive",
		});
		expect(archived.factoryArchive).toEqual({ reason: "pr_merged" });
		expect(h.get(closed.taskId).factoryArchive).toEqual({
			reason: "pr_closed",
		});
		// The status tool says why.
		const status = await createFactoryStatusTool({
			manager: h.manager,
			resolveSessionDefaults: async () => ({ sessionId: "s", workspaceRoot }),
		} as never).execute(
			{ task_id: archived.taskId } as never,
			{
				agentId: "a",
				conversationId: "c",
				iteration: 1,
				sessionId: "s",
			} as never,
		);
		expect(JSON.stringify(status)).toContain(
			"Archived automatically: pull request merged",
		);
	});

	it("archives a delivered card after the quiet days, but not one a person touched since", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const h = harness();
		const quiet = await h.delivered();
		const touched = await h.delivered();
		h.later(6);
		await h.manager.recordFactoryAudit(
			touched.taskId,
			"The export misses a header",
		);
		h.later(2);
		await h.pass();
		expect(h.get(quiet.taskId).factoryArchive).toEqual({
			reason: "quiet",
			days: 7,
		});
		expect(h.get(touched.taskId).archivedAt).toBeUndefined();
	});

	it("never archives a delivered card that waits for the person's review", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const h = harness();
		const stamp = await h.delivered({
			humanReview: { required: true, reason: "sensitive paths" },
		});
		const quiet = await h.delivered();
		h.later(30);
		await h.pass();
		expect(h.get(quiet.taskId).archivedAt).toBeDefined();
		expect(h.get(stamp.taskId).archivedAt).toBeUndefined();
	});

	it("does not archive a restored card again for the same merge", async () => {
		const h = harness();
		const card = await h.merged();
		await h.pass();
		const archived = h.get(card.taskId);
		const restored = await h.manager.restoreTask(
			card.taskId,
			PERSON,
			archived.revision,
		);
		expect(restored.archivedAt).toBeUndefined();
		expect(restored.factoryArchive?.reason).toBeUndefined();
		expect(restored.factoryArchive?.restoredAt).toBeDefined();
		await h.pass();
		expect(h.get(card.taskId).archivedAt).toBeUndefined();
	});

	it("archives nothing when both settings are off", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const h = harness({
			archiveOnPullRequestClose: false,
			archiveAfterDays: null,
		});
		const card = await h.merged();
		h.later(30);
		await h.pass();
		expect(h.get(card.taskId).archivedAt).toBeUndefined();
	});
});
