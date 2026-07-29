import type { BankSnapshot } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDriveBankSession,
	hydrateLocalBankFromHubSnapshot,
	mutateBankCreateTask,
	mutateBankEditPlanTasks,
	planTasksFromSnapshot,
	seedBankForJoin,
	seedDemoBank,
} from "./bankSession";

const sampleSnapshot: BankSnapshot = {
	activePlanId: "p-active",
	openTaskIds: ["t-parse", "t-tests"],
	nowTaskId: "t-parse",
	nextTaskId: "t-tests",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
};

function stubWindowMessageBus() {
	const listeners = new Set<(event: MessageEvent) => void>();
	vi.stubGlobal("window", {
		addEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") {
				listeners.add(listener as (event: MessageEvent) => void);
			}
		},
		removeEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			listeners.delete(listener as (event: MessageEvent) => void);
		},
	});
	return {
		dispatch(data: unknown) {
			const event = { data } as MessageEvent;
			for (const listener of [...listeners]) {
				listener(event);
			}
		},
	};
}

describe("bankSession hub seed helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("planTasksFromSnapshot projects open task titles", () => {
		expect(planTasksFromSnapshot(sampleSnapshot)).toEqual([
			{ id: "t-parse", title: "Fix parser" },
			{ id: "t-tests", title: "Rerun tests" },
		]);
	});

	it("hydrateLocalBankFromHubSnapshot creates plan + tasks once", async () => {
		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-parse", "t-tests"]);
		const task = await session.store.getTask("t-parse");
		expect(task?.title).toBe("Fix parser");

		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const again = await session.store.getPlan("p-active");
		expect(again?.taskIds).toEqual(["t-parse", "t-tests"]);
	});

	it("hydrateLocalBankFromHubSnapshot syncs plan taskIds when plan exists", async () => {
		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		await hydrateLocalBankFromHubSnapshot(session, {
			...sampleSnapshot,
			openTaskIds: ["t-tests", "t-parse", "t-extra"],
			nowTaskId: "t-tests",
			nextTaskId: "t-parse",
			nowTitle: "Rerun tests",
			nextTitle: "Fix parser",
		});
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-tests", "t-parse", "t-extra"]);
		expect(await session.store.getTask("t-extra")).toMatchObject({
			id: "t-extra",
			title: "t-extra",
		});
	});

	it("seedBankForJoin falls back to memory when workspaceRoot is empty", async () => {
		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "  ");
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.activePlanId).toBe("p-active");
	});

	it("seedBankForJoin uses hub snapshot when drive_bank_snapshot arrives", async () => {
		const bus = stubWindowMessageBus();

		const postSpy = vi
			.spyOn(await import("../vscode"), "postToHost")
			.mockImplementation((message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					bus.dispatch({
						type: "drive_bank_snapshot",
						requestId,
						snapshot: sampleSnapshot,
					});
				});
			});

		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "/tmp/workspace");
		expect(result.fromHub).toBe(true);
		expect(result.snapshot).toEqual(sampleSnapshot);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_seed",
				workspaceRoot: "/tmp/workspace",
			}),
		);
		const plan = await session.store.getPlan("p-active");
		expect(plan).not.toBeNull();
	});

	it("seedBankForJoin falls back after hub error reply", async () => {
		const bus = stubWindowMessageBus();

		vi.spyOn(await import("../vscode"), "postToHost").mockImplementation(
			(message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					bus.dispatch({
						type: "drive_bank_error",
						requestId,
						text: "Hub is not connected.",
					});
				});
			},
		);

		const session = createDriveBankSession();
		const result = await seedBankForJoin(session, "/tmp/workspace");
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.activePlanId).toBe("p-active");
	});

	it("seedDemoBank is idempotent", async () => {
		const session = createDriveBankSession();
		const first = await seedDemoBank(session);
		const second = await seedDemoBank(session);
		expect(second).toEqual(first);
	});
});

describe("bankSession hub mutation helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("mutateBankCreateTask uses local store when workspaceRoot is empty", async () => {
		const session = createDriveBankSession();
		await seedDemoBank(session);
		const result = await mutateBankCreateTask(session, undefined, {
			id: "t-local",
			title: "Local task",
			planId: "p-active",
		});
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.openTaskIds).toContain("t-local");
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toContain("t-local");
	});

	it("mutateBankCreateTask posts hub create_task and hydrates", async () => {
		const bus = stubWindowMessageBus();
		const hubSnapshot: BankSnapshot = {
			...sampleSnapshot,
			openTaskIds: ["t-parse", "t-tests", "t-hub"],
		};

		const postSpy = vi
			.spyOn(await import("../vscode"), "postToHost")
			.mockImplementation((message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					bus.dispatch({
						type: "drive_bank_snapshot",
						requestId,
						snapshot: hubSnapshot,
					});
				});
			});

		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankCreateTask(session, "/tmp/workspace", {
			id: "t-hub",
			title: "Hub task",
			body: "",
			planId: "p-active",
		});
		expect(result.fromHub).toBe(true);
		expect(result.snapshot).toEqual(hubSnapshot);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_create_task",
				workspaceRoot: "/tmp/workspace",
				id: "t-hub",
				title: "Hub task",
				planId: "p-active",
			}),
		);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-parse", "t-tests", "t-hub"]);
	});

	it("mutateBankEditPlanTasks posts hub edit and hydrates", async () => {
		const bus = stubWindowMessageBus();
		const hubSnapshot: BankSnapshot = {
			...sampleSnapshot,
			openTaskIds: ["t-tests", "t-parse"],
			nowTaskId: "t-tests",
			nextTaskId: "t-parse",
			nowTitle: "Rerun tests",
			nextTitle: "Fix parser",
		};

		const postSpy = vi
			.spyOn(await import("../vscode"), "postToHost")
			.mockImplementation((message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					bus.dispatch({
						type: "drive_bank_snapshot",
						requestId,
						snapshot: hubSnapshot,
					});
				});
			});

		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankEditPlanTasks(session, "/tmp/workspace", {
			planId: "p-active",
			taskIds: ["t-tests", "t-parse"],
		});
		expect(result.fromHub).toBe(true);
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_bank_edit_plan_tasks",
				workspaceRoot: "/tmp/workspace",
				planId: "p-active",
				taskIds: ["t-tests", "t-parse"],
			}),
		);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-tests", "t-parse"]);
	});

	it("mutateBankEditPlanTasks does not mutate local after hub error", async () => {
		const bus = stubWindowMessageBus();
		vi.spyOn(await import("../vscode"), "postToHost").mockImplementation(
			(message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					bus.dispatch({
						type: "drive_bank_error",
						requestId,
						text: "disk full",
					});
				});
			},
		);

		const session = createDriveBankSession();
		await hydrateLocalBankFromHubSnapshot(session, sampleSnapshot);
		const result = await mutateBankEditPlanTasks(session, "/tmp/workspace", {
			planId: "p-active",
			taskIds: ["t-tests"],
		});
		expect(result.fromHub).toBe(false);
		expect(result.snapshot.openTaskIds).toEqual(["t-parse", "t-tests"]);
		const plan = await session.store.getPlan("p-active");
		expect(plan?.taskIds).toEqual(["t-parse", "t-tests"]);
	});
});
