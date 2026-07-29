import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openWorkspaceBankStore } from "../../collaboration/workspaceBankStore";
import type { HubTransportContext } from "./context";
import { handleDriveBankCommand } from "./drive-bank-handlers";

function command(
	name: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		requestId: "req_bank",
		clientId: "test",
		command: name,
		payload,
	};
}

function ctx(): HubTransportContext {
	return {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {} as HubTransportContext["sessionHost"],
		publish: () => {},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: "v1",
				event,
				payload,
			}) as unknown as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
}

describe("handleDriveBankCommand", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("requires workspaceRoot", async () => {
		const reply = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_get"),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
	});

	it("get returns empty snapshot then seed persists for get", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-bank-hub-"));
		dirs.push(root);

		const empty = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_get", { workspaceRoot: root }),
		);
		expect(empty.ok).toBe(true);
		expect(empty.payload?.snapshot).toMatchObject({
			activePlanId: null,
			nowTaskId: null,
		});

		const seeded = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_seed", { workspaceRoot: root }),
		);
		expect(seeded.ok).toBe(true);
		expect(seeded.payload?.snapshot).toMatchObject({
			activePlanId: "p-active",
			nowTaskId: "t-parse",
			nextTaskId: "t-tests",
		});

		const again = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_get", { workspaceRoot: root }),
		);
		expect(again.ok).toBe(true);
		expect(again.payload?.snapshot).toEqual(seeded.payload?.snapshot);

		const reseed = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_seed", { workspaceRoot: root }),
		);
		expect(reseed.payload?.snapshot).toEqual(seeded.payload?.snapshot);
	});

	it("create_task persists and optionally appends to plan", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-bank-create-"));
		dirs.push(root);

		await handleDriveBankCommand(
			ctx(),
			command("drive_bank_seed", { workspaceRoot: root }),
		);

		const created = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_create_task", {
				workspaceRoot: root,
				id: "t-new",
				title: "Ship docs",
				body: "Write the README.",
				planId: "p-active",
			}),
		);
		expect(created.ok).toBe(true);
		expect(created.payload?.snapshot).toMatchObject({
			activePlanId: "p-active",
			openTaskIds: ["t-parse", "t-tests", "t-new"],
			nowTaskId: "t-parse",
			nextTaskId: "t-tests",
		});

		const again = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_get", { workspaceRoot: root }),
		);
		expect(again.payload?.snapshot).toEqual(created.payload?.snapshot);

		const store = openWorkspaceBankStore(root);
		expect(await store.getTask("t-new")).toMatchObject({
			id: "t-new",
			title: "Ship docs",
			body: "Write the README.",
			status: "open",
		});
		expect(await store.getPlan("p-active")).toMatchObject({
			taskIds: ["t-parse", "t-tests", "t-new"],
		});
	});

	it("create_task without planId leaves plan unchanged", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-bank-create-solo-"));
		dirs.push(root);
		await handleDriveBankCommand(
			ctx(),
			command("drive_bank_seed", { workspaceRoot: root }),
		);
		const created = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_create_task", {
				workspaceRoot: root,
				id: "t-orphan",
				title: "Orphan",
			}),
		);
		expect(created.ok).toBe(true);
		expect(created.payload?.snapshot).toMatchObject({
			openTaskIds: ["t-parse", "t-tests"],
		});
	});

	it("edit_plan_tasks reorders and persists across reopen", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-bank-edit-"));
		dirs.push(root);
		await handleDriveBankCommand(
			ctx(),
			command("drive_bank_seed", { workspaceRoot: root }),
		);

		const edited = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_edit_plan_tasks", {
				workspaceRoot: root,
				planId: "p-active",
				taskIds: ["t-tests", "t-parse"],
			}),
		);
		expect(edited.ok).toBe(true);
		expect(edited.payload?.snapshot).toMatchObject({
			openTaskIds: ["t-tests", "t-parse"],
			nowTaskId: "t-tests",
			nextTaskId: "t-parse",
		});

		const again = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_get", { workspaceRoot: root }),
		);
		expect(again.payload?.snapshot).toEqual(edited.payload?.snapshot);
	});

	it("edit_plan_tasks rejects missing planId/taskIds", async () => {
		const root = await mkdtemp(join(tmpdir(), "drive-bank-edit-bad-"));
		dirs.push(root);
		const reply = await handleDriveBankCommand(
			ctx(),
			command("drive_bank_edit_plan_tasks", {
				workspaceRoot: root,
				planId: "p-active",
			}),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
	});
});
