import {
	createBankStore,
	createMemoryBankFs,
	type BankStore,
} from "@cline/drive";
import type { BankSnapshot } from "@cline/shared";

const WORKSPACE = "/hub-drive-bank";

export type DriveBankSession = {
	store: BankStore;
	refresh: () => Promise<BankSnapshot>;
};

export function createDriveBankSession(): DriveBankSession {
	const fs = createMemoryBankFs();
	const store = createBankStore(fs, WORKSPACE);
	return {
		store,
		refresh: () => store.getSnapshot(),
	};
}

export async function seedDemoBank(
	session: DriveBankSession,
): Promise<BankSnapshot> {
	const existing = await session.store.getSnapshot();
	if (existing.activePlanId) {
		return existing;
	}
	await session.store.createTask({
		id: "t-parse",
		title: "Fix parser",
		body: "Make the failing parser test green.",
	});
	await session.store.createTask({
		id: "t-tests",
		title: "Rerun tests",
		body: "Confirm the suite is green.",
	});
	await session.store.createPlan({
		id: "p-active",
		title: "Current work",
		taskIds: ["t-parse", "t-tests"],
	});
	return session.refresh();
}

export async function listPlanTasks(
	session: DriveBankSession,
	planId: string,
): Promise<Array<{ id: string; title: string }>> {
	const plan = await session.store.getPlan(planId);
	if (!plan) {
		return [];
	}
	const tasks: Array<{ id: string; title: string }> = [];
	for (const taskId of plan.taskIds) {
		const task = await session.store.getTask(taskId);
		if (task && task.status !== "done") {
			tasks.push({ id: task.id, title: task.title });
		}
	}
	return tasks;
}
