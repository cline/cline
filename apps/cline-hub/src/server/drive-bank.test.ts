import { describe, expect, it, vi } from "vitest";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";
import { handleDriveBankWebviewCommand } from "./drive-bank";

function peer(): BrowserPeer {
	return { id: "peer-1" } as unknown as BrowserPeer;
}

function ctx(overrides?: {
	uiClient?: HubContext["uiClient"];
	send?: HubContext["send"];
}): { context: HubContext; sent: unknown[] } {
	const sent: unknown[] = [];
	const context = {
		uiClient: overrides?.uiClient,
		send:
			overrides?.send ??
			((_peer: BrowserPeer, message: unknown) => {
				sent.push(message);
			}),
	} as unknown as HubContext;
	return { context, sent };
}

const sampleSnapshot = {
	activePlanId: "p-active",
	openTaskIds: ["t-parse", "t-tests"],
	nowTaskId: "t-parse",
	nextTaskId: "t-tests",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
};

describe("handleDriveBankWebviewCommand", () => {
	it("errors when hub is disconnected", async () => {
		const { context, sent } = ctx({ uiClient: undefined });
		await handleDriveBankWebviewCommand(context, peer(), {
			type: "drive_bank_seed",
			workspaceRoot: "/tmp/ws",
			requestId: "req-1",
		});
		expect(sent).toEqual([
			{
				type: "drive_bank_error",
				text: "Hub is not connected.",
				code: "hub_disconnected",
				requestId: "req-1",
			},
		]);
	});

	it("errors when workspaceRoot is empty", async () => {
		const { context, sent } = ctx({
			uiClient: { command: vi.fn() } as unknown as HubContext["uiClient"],
		});
		await handleDriveBankWebviewCommand(context, peer(), {
			type: "drive_bank_get",
			workspaceRoot: "  ",
			requestId: "req-2",
		});
		expect(sent[0]).toMatchObject({
			type: "drive_bank_error",
			code: "invalid_payload",
			requestId: "req-2",
		});
	});

	it("forwards drive_bank_seed and returns snapshot", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: { snapshot: sampleSnapshot },
		});
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveBankWebviewCommand(context, peer(), {
			type: "drive_bank_seed",
			workspaceRoot: "/tmp/ws",
			requestId: "req-3",
		});
		expect(command).toHaveBeenCalledWith("drive_bank_seed", {
			workspaceRoot: "/tmp/ws",
		});
		expect(sent).toEqual([
			{
				type: "drive_bank_snapshot",
				snapshot: sampleSnapshot,
				requestId: "req-3",
			},
		]);
	});

	it("maps hub command failure to drive_bank_error", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: false,
			error: { message: "disk full", code: "io_error" },
		});
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveBankWebviewCommand(context, peer(), {
			type: "drive_bank_get",
			workspaceRoot: "/tmp/ws",
			requestId: "req-4",
		});
		expect(sent).toEqual([
			{
				type: "drive_bank_error",
				text: "disk full",
				code: "io_error",
				requestId: "req-4",
			},
		]);
	});

	it("forwards drive_bank_create_task payload fields", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: { snapshot: sampleSnapshot },
		});
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveBankWebviewCommand(context, peer(), {
			type: "drive_bank_create_task",
			workspaceRoot: "/tmp/ws",
			requestId: "req-5",
			id: "t-new",
			title: "New task",
			body: "details",
			planId: "p-active",
		});
		expect(command).toHaveBeenCalledWith("drive_bank_create_task", {
			workspaceRoot: "/tmp/ws",
			id: "t-new",
			title: "New task",
			body: "details",
			planId: "p-active",
		});
		expect(sent[0]).toMatchObject({
			type: "drive_bank_snapshot",
			requestId: "req-5",
		});
	});

	it("forwards drive_bank_edit_plan_tasks payload fields", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: {
				snapshot: {
					...sampleSnapshot,
					openTaskIds: ["t-tests", "t-parse"],
				},
			},
		});
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveBankWebviewCommand(context, peer(), {
			type: "drive_bank_edit_plan_tasks",
			workspaceRoot: "/tmp/ws",
			requestId: "req-6",
			planId: "p-active",
			taskIds: ["t-tests", "t-parse"],
		});
		expect(command).toHaveBeenCalledWith("drive_bank_edit_plan_tasks", {
			workspaceRoot: "/tmp/ws",
			planId: "p-active",
			taskIds: ["t-tests", "t-parse"],
		});
		expect(sent[0]).toMatchObject({
			type: "drive_bank_snapshot",
			requestId: "req-6",
		});
	});
});
