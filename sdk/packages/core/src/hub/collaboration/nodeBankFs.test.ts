/**
 * Durable Node BankFs + workspace store round-trip.
 */

import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeBankFs } from "./nodeBankFs";
import { openWorkspaceBankStore } from "./workspaceBankStore";

describe("createNodeBankFs", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("reads, writes, lists, moves, and exists on disk", async () => {
		const root = await mkdtemp(join(tmpdir(), "node-bank-fs-"));
		dirs.push(root);
		const fs = createNodeBankFs();
		const file = join(root, ".drive", "bank", "tasks", "t1.md");
		const archive = join(
			root,
			".drive",
			"bank",
			"archive",
			"tasks",
			"t1.md",
		);

		expect(await fs.exists(file)).toBe(false);
		expect(await fs.read(file)).toBeNull();
		expect(await fs.list(join(root, ".drive", "bank", "tasks"))).toEqual([]);

		await fs.write(file, "hello");
		expect(await fs.read(file)).toBe("hello");
		expect(await fs.exists(file)).toBe(true);
		expect(await fs.list(join(root, ".drive", "bank", "tasks"))).toEqual([
			"t1.md",
		]);

		await fs.move(file, archive);
		expect(await fs.exists(file)).toBe(false);
		expect(await fs.exists(archive)).toBe(true);
		expect(await fs.read(archive)).toBe("hello");
		await access(archive);
	});
});

describe("openWorkspaceBankStore", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("persists createTask/createPlan across store restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "workspace-bank-"));
		dirs.push(root);

		const store1 = openWorkspaceBankStore(root);
		await store1.createTask({
			id: "t-parse",
			title: "Fix parser",
			body: "Make the failing parser test green.",
		});
		await store1.createTask({
			id: "t-tests",
			title: "Rerun tests",
			body: "Confirm the suite is green.",
		});
		await store1.createPlan({
			id: "p-active",
			title: "Current work",
			taskIds: ["t-parse", "t-tests"],
		});
		const snap1 = await store1.getSnapshot();
		expect(snap1.activePlanId).toBe("p-active");
		expect(snap1.nowTaskId).toBe("t-parse");
		expect(snap1.nextTaskId).toBe("t-tests");

		const store2 = openWorkspaceBankStore(root);
		const snap2 = await store2.getSnapshot();
		expect(snap2).toEqual(snap1);
		expect(await store2.getTask("t-parse")).toMatchObject({
			id: "t-parse",
			title: "Fix parser",
			status: "open",
		});
		expect(await store2.getPlan("p-active")).toMatchObject({
			id: "p-active",
			status: "active",
			taskIds: ["t-parse", "t-tests"],
		});
	});

	it("archives completed tasks under .drive/bank/archive on disk", async () => {
		const root = await mkdtemp(join(tmpdir(), "workspace-bank-archive-"));
		dirs.push(root);
		const store = openWorkspaceBankStore(root);
		await store.createTask({ id: "t1", title: "One", body: "a" });
		await store.createTask({ id: "t2", title: "Two", body: "b" });
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1", "t2"],
		});
		await store.completeTask("t1");

		const fs = createNodeBankFs();
		const archived = join(
			root,
			".drive",
			"bank",
			"archive",
			"tasks",
			"t1.md",
		);
		const active = join(root, ".drive", "bank", "tasks", "t1.md");
		expect(await fs.exists(archived)).toBe(true);
		expect(await fs.exists(active)).toBe(false);

		const restarted = openWorkspaceBankStore(root);
		const snap = await restarted.getSnapshot();
		expect(snap.nowTaskId).toBe("t2");
		expect(await restarted.getTask("t1")).toMatchObject({
			id: "t1",
			status: "done",
		});
	});
});
