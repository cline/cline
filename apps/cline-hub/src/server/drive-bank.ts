import type { BankSnapshot, HubCommandName } from "@cline/shared";
import { parseBankSnapshot } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

function asBankSnapshot(value: unknown): BankSnapshot | undefined {
	try {
		return parseBankSnapshot(value);
	} catch {
		return undefined;
	}
}

export type DriveBankWebviewFrame = {
	type:
		| "drive_bank_get"
		| "drive_bank_seed"
		| "drive_bank_create_task"
		| "drive_bank_edit_plan_tasks";
	workspaceRoot: string;
	requestId?: string;
	id?: string;
	title?: string;
	body?: string;
	planId?: string;
	taskIds?: string[];
	[key: string]: unknown;
};

/**
 * Bridges Chat Drive bank seed/get/mutations to hub `drive_bank_*` durable ops.
 */
export async function handleDriveBankWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveBankWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;

	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "drive_bank_error",
			text: "Hub is not connected.",
			code: "hub_disconnected",
			requestId,
		});
		return;
	}

	const workspaceRoot =
		typeof frame.workspaceRoot === "string" ? frame.workspaceRoot.trim() : "";
	if (!workspaceRoot) {
		ctx.send(peer, {
			type: "drive_bank_error",
			text: "workspaceRoot is required.",
			code: "invalid_payload",
			requestId,
		});
		return;
	}

	const command = frame.type as HubCommandName;
	const payload: Record<string, unknown> = { workspaceRoot };
	if (typeof frame.id === "string") {
		payload.id = frame.id;
	}
	if (typeof frame.title === "string") {
		payload.title = frame.title;
	}
	if (typeof frame.body === "string") {
		payload.body = frame.body;
	}
	if (typeof frame.planId === "string") {
		payload.planId = frame.planId;
	}
	if (Array.isArray(frame.taskIds)) {
		payload.taskIds = frame.taskIds;
	}

	try {
		const reply = await ctx.uiClient.command(command, payload);
		if (!reply.ok) {
			ctx.send(peer, {
				type: "drive_bank_error",
				text: reply.error?.message ?? "Drive bank command failed.",
				code: reply.error?.code,
				requestId,
			});
			return;
		}
		const snapshot = asBankSnapshot(reply.payload?.snapshot);
		if (!snapshot) {
			ctx.send(peer, {
				type: "drive_bank_error",
				text: "Drive bank reply missing snapshot.",
				code: "invalid_reply",
				requestId,
			});
			return;
		}
		ctx.send(peer, {
			type: "drive_bank_snapshot",
			snapshot,
			requestId,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "drive_bank_error",
			text: error instanceof Error ? error.message : String(error),
			code: "drive_bank_command_failed",
			requestId,
		});
	}
}
