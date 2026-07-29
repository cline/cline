import type {
	BankDriveEvent,
	BankSnapshot,
	DrivePlan,
	DriveTask,
} from "@cline/shared";
import type { BankFs } from "./bankFs.js";
import {
	archivedPlanPath,
	archivedTaskPath,
	planPath,
	taskPath,
} from "./bankPaths.js";
import {
	deserializeDrivePlan,
	deserializeDriveTask,
	serializeDrivePlan,
	serializeDriveTask,
} from "./bankSerialize.js";
import { deriveBankSnapshot } from "./bankSnapshot.js";
import {
	createDrivePlanActivatedEvent,
	createDriveTaskCompletedEvent,
	createDriveTaskOpenedEvent,
} from "./driveEvents.js";

export interface BankStore {
	createTask(input: {
		id: string;
		title: string;
		body: string;
	}): Promise<DriveTask>;
	createPlan(input: {
		id: string;
		title: string;
		taskIds: string[];
		activate?: boolean;
	}): Promise<DrivePlan>;
	activatePlan(planId: string): Promise<DrivePlan>;
	getSnapshot(): Promise<BankSnapshot>;
	getTask(taskId: string): Promise<DriveTask | null>;
	getPlan(planId: string): Promise<DrivePlan | null>;
	bindNowTask(): Promise<{ plan: DrivePlan; task: DriveTask } | null>;
	completeTask(taskId: string): Promise<void>;
	recordTaskFailure(taskId: string, note: string): Promise<DriveTask>;
	editPlanTaskIds(planId: string, taskIds: string[]): Promise<DrivePlan>;
	closeAndArchivePlan(planId: string): Promise<void>;
	listOpenTasksForActivePlan(): Promise<DriveTask[]>;
}

export function createBankStore(
	fs: BankFs,
	workspaceRoot: string,
	options?: {
		roomId?: string;
		onBankEvent?: (event: BankDriveEvent) => void;
	},
): BankStore {
	const root = workspaceRoot.replace(/[\\/]+$/, "");
	const roomId = options?.roomId ?? "bank";
	const emit = options?.onBankEvent;

	async function readTask(taskId: string): Promise<DriveTask | null> {
		const active = await fs.read(taskPath(root, taskId));
		if (active) {
			return deserializeDriveTask(active);
		}
		const archived = await fs.read(archivedTaskPath(root, taskId));
		if (archived) {
			return deserializeDriveTask(archived);
		}
		return null;
	}

	async function readPlan(planId: string): Promise<DrivePlan | null> {
		const active = await fs.read(planPath(root, planId));
		if (active) {
			return deserializeDrivePlan(active);
		}
		const archived = await fs.read(archivedPlanPath(root, planId));
		if (archived) {
			return deserializeDrivePlan(archived);
		}
		return null;
	}

	async function writeTask(task: DriveTask): Promise<void> {
		await fs.write(taskPath(root, task.id), serializeDriveTask(task));
	}

	async function writePlan(plan: DrivePlan): Promise<void> {
		await fs.write(planPath(root, plan.id), serializeDrivePlan(plan));
	}

	async function findActivePlan(): Promise<DrivePlan | null> {
		const names = await fs.list(`${root}/.drive/bank/plans`);
		for (const name of names) {
			if (!name.endsWith(".plan.md")) {
				continue;
			}
			const id = name.replace(/\.plan\.md$/, "");
			const plan = await readPlan(id);
			if (plan?.status === "active") {
				return plan;
			}
		}
		return null;
	}

	async function loadTasks(taskIds: string[]): Promise<Map<string, DriveTask>> {
		const map = new Map<string, DriveTask>();
		for (const taskId of taskIds) {
			const task = await readTask(taskId);
			if (task) {
				map.set(taskId, task);
			}
		}
		return map;
	}

	return {
		async createTask({ id, title, body }) {
			if (await fs.exists(taskPath(root, id))) {
				throw new Error(`Task already exists: ${id}`);
			}
			if (await fs.exists(archivedTaskPath(root, id))) {
				throw new Error(`Task id is archived (read-only): ${id}`);
			}
			const task: DriveTask = {
				id,
				title,
				body,
				status: "open",
			};
			await writeTask(task);
			emit?.(createDriveTaskOpenedEvent({ roomId, taskId: id, title }));
			return task;
		},

		async createPlan({ id, title, taskIds, activate = true }) {
			if (await fs.exists(planPath(root, id))) {
				throw new Error(`Plan already exists: ${id}`);
			}
			if (activate) {
				const existing = await findActivePlan();
				if (existing && existing.id !== id) {
					await writePlan({ ...existing, status: "draft" });
				}
			}
			const plan: DrivePlan = {
				id,
				title,
				taskIds: [...taskIds],
				status: activate ? "active" : "draft",
			};
			await writePlan(plan);
			return plan;
		},

		async activatePlan(planId) {
			const plan = await readPlan(planId);
			if (!plan) {
				throw new Error(`Plan not found: ${planId}`);
			}
			if (await fs.exists(archivedPlanPath(root, planId))) {
				if (!(await fs.exists(planPath(root, planId)))) {
					throw new Error(`Archived plan is read-only: ${planId}`);
				}
			}
			const current = await findActivePlan();
			if (current && current.id !== planId) {
				await writePlan({ ...current, status: "draft" });
			}
			const next = { ...plan, status: "active" as const };
			await writePlan(next);
			emit?.(
				createDrivePlanActivatedEvent({
					roomId,
					planId,
					title: next.title,
				}),
			);
			return next;
		},

		async getSnapshot() {
			const plan = await findActivePlan();
			if (!plan) {
				return deriveBankSnapshot(null, new Map());
			}
			const tasks = await loadTasks(plan.taskIds);
			return deriveBankSnapshot(plan, tasks);
		},

		getTask: readTask,
		getPlan: readPlan,

		async bindNowTask() {
			const plan = await findActivePlan();
			if (!plan) {
				return null;
			}
			const tasks = await loadTasks(plan.taskIds);
			const snapshot = deriveBankSnapshot(plan, tasks);
			if (!snapshot.nowTaskId) {
				return null;
			}
			const task = tasks.get(snapshot.nowTaskId);
			if (!task) {
				return null;
			}
			if (task.status === "open") {
				const bound: DriveTask = { ...task, status: "in_progress" };
				await writeTask(bound);
				return { plan, task: bound };
			}
			return { plan, task };
		},

		async completeTask(taskId) {
			const activePath = taskPath(root, taskId);
			const archivePath = archivedTaskPath(root, taskId);
			if (await fs.exists(archivePath)) {
				return;
			}
			const raw = await fs.read(activePath);
			if (!raw) {
				throw new Error(`Task not found: ${taskId}`);
			}
			const task = deserializeDriveTask(raw);
			const done: DriveTask = { ...task, status: "done" };
			await fs.write(activePath, serializeDriveTask(done));
			await fs.move(activePath, archivePath);
			emit?.(createDriveTaskCompletedEvent({ roomId, taskId }));

			const plan = await findActivePlan();
			if (plan) {
				const tasks = await loadTasks(plan.taskIds);
				const snapshot = deriveBankSnapshot(plan, tasks);
				if (snapshot.openTaskIds.length === 0) {
					await this.closeAndArchivePlan(plan.id);
				}
			}
		},

		async recordTaskFailure(taskId, note) {
			const task = await readTask(taskId);
			if (!task) {
				throw new Error(`Task not found: ${taskId}`);
			}
			if (await fs.exists(archivedTaskPath(root, taskId))) {
				if (!(await fs.exists(taskPath(root, taskId)))) {
					throw new Error(`Archived task is read-only: ${taskId}`);
				}
			}
			const next: DriveTask = {
				...task,
				status: "open",
				lastFailure: note,
			};
			await writeTask(next);
			return next;
		},

		async editPlanTaskIds(planId, taskIds) {
			const plan = await readPlan(planId);
			if (!plan) {
				throw new Error(`Plan not found: ${planId}`);
			}
			if (
				(await fs.exists(archivedPlanPath(root, planId))) &&
				!(await fs.exists(planPath(root, planId)))
			) {
				throw new Error(`Archived plan is read-only: ${planId}`);
			}
			for (const taskId of taskIds) {
				if (await fs.exists(archivedTaskPath(root, taskId))) {
					if (!(await fs.exists(taskPath(root, taskId)))) {
					}
				}
			}
			const next: DrivePlan = { ...plan, taskIds: [...taskIds] };
			await writePlan(next);
			return next;
		},

		async closeAndArchivePlan(planId) {
			const activePath = planPath(root, planId);
			const archivePath = archivedPlanPath(root, planId);
			if (await fs.exists(archivePath)) {
				return;
			}
			const raw = await fs.read(activePath);
			if (!raw) {
				throw new Error(`Plan not found: ${planId}`);
			}
			const plan = deserializeDrivePlan(raw);
			const closed: DrivePlan = { ...plan, status: "closed" };
			await fs.write(activePath, serializeDrivePlan(closed));
			await fs.move(activePath, archivePath);
		},

		async listOpenTasksForActivePlan() {
			const plan = await findActivePlan();
			if (!plan) {
				return [];
			}
			const tasks = await loadTasks(plan.taskIds);
			const snapshot = deriveBankSnapshot(plan, tasks);
			return snapshot.openTaskIds
				.map((id) => tasks.get(id))
				.filter((task): task is DriveTask => Boolean(task));
		},
	};
}
