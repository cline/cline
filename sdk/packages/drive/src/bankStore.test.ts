import { describe, expect, it } from "vitest";
import { createMemoryBankFs } from "./bankFs.js";
import { archivedPlanPath, archivedTaskPath } from "./bankPaths.js";
import { createBankStore } from "./bankStore.js";

const ROOT = "/ws";

describe("bankStore", () => {
	it("creates plan+tasks and derives snapshot cursor", async () => {
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, ROOT);
		await store.createTask({
			id: "t1",
			title: "One",
			body: "do one",
		});
		await store.createTask({
			id: "t2",
			title: "Two",
			body: "do two",
		});
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1", "t2"],
		});
		const snap = await store.getSnapshot();
		expect(snap.activePlanId).toBe("p1");
		expect(snap.nowTaskId).toBe("t1");
		expect(snap.nextTaskId).toBe("t2");
		expect(snap.nowTitle).toBe("One");
	});

	it("completes a task into archive and advances cursor", async () => {
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, ROOT);
		await store.createTask({ id: "t1", title: "One", body: "a" });
		await store.createTask({ id: "t2", title: "Two", body: "b" });
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1", "t2"],
		});
		await store.completeTask("t1");
		expect(await fs.exists(archivedTaskPath(ROOT, "t1"))).toBe(true);
		expect(await fs.exists(`${ROOT}/.drive/bank/tasks/t1.md`)).toBe(
			false,
		);
		const snap = await store.getSnapshot();
		expect(snap.nowTaskId).toBe("t2");
	});

	it("archives the plan when the last open task completes", async () => {
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, ROOT);
		await store.createTask({ id: "t1", title: "One", body: "a" });
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1"],
		});
		await store.completeTask("t1");
		expect(await fs.exists(archivedPlanPath(ROOT, "p1"))).toBe(true);
		const snap = await store.getSnapshot();
		expect(snap.activePlanId).toBeNull();
	});

	it("is idempotent on re-complete", async () => {
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, ROOT);
		await store.createTask({ id: "t1", title: "One", body: "a" });
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1"],
		});
		await store.completeTask("t1");
		await store.completeTask("t1");
		expect(await fs.exists(archivedTaskPath(ROOT, "t1"))).toBe(true);
	});

	it("edits plan refs without rewriting archived task content", async () => {
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, ROOT);
		await store.createTask({ id: "t1", title: "One", body: "alpha" });
		await store.createTask({ id: "t2", title: "Two", body: "beta" });
		await store.createTask({ id: "t3", title: "Three", body: "gamma" });
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1", "t2"],
		});
		await store.completeTask("t1");
		const archivedBefore = await fs.read(archivedTaskPath(ROOT, "t1"));
		await store.editPlanTaskIds("p1", ["t2", "t3"]);
		const archivedAfter = await fs.read(archivedTaskPath(ROOT, "t1"));
		expect(archivedAfter).toBe(archivedBefore);
		const snap = await store.getSnapshot();
		expect(snap.openTaskIds).toEqual(["t2", "t3"]);
	});

	it("refuses to mutate archived plans", async () => {
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, ROOT);
		await store.createTask({ id: "t1", title: "One", body: "a" });
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1"],
		});
		await store.closeAndArchivePlan("p1");
		await expect(
			store.editPlanTaskIds("p1", ["t1"]),
		).rejects.toThrow(/read-only/);
	});

	it("records failure without archiving", async () => {
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, ROOT);
		await store.createTask({ id: "t1", title: "One", body: "a" });
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1"],
		});
		const failed = await store.recordTaskFailure("t1", "tests red");
		expect(failed.status).toBe("open");
		expect(failed.lastFailure).toBe("tests red");
		expect(await fs.exists(archivedTaskPath(ROOT, "t1"))).toBe(false);
	});
});
