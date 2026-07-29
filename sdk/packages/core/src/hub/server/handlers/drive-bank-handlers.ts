/**
 * Hub drive_bank_* durable task bank ops under .drive/bank/.
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { openWorkspaceBankStore } from "../../collaboration/workspaceBankStore";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(
	payload: Record<string, unknown> | undefined,
	key: string,
): string[] | undefined {
	const value = payload?.[key];
	if (!Array.isArray(value)) {
		return undefined;
	}
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string" || !item.trim()) {
			return undefined;
		}
		out.push(item.trim());
	}
	return out;
}

async function seedDemoIfEmpty(workspaceRoot: string) {
	const store = openWorkspaceBankStore(workspaceRoot);
	const existing = await store.getSnapshot();
	if (existing.activePlanId) {
		return existing;
	}
	await store.createTask({
		id: "t-parse",
		title: "Fix parser",
		body: "Make the failing parser test green.",
	});
	await store.createTask({
		id: "t-tests",
		title: "Rerun tests",
		body: "Confirm the suite is green.",
	});
	await store.createPlan({
		id: "p-active",
		title: "Current work",
		taskIds: ["t-parse", "t-tests"],
	});
	return store.getSnapshot();
}

export async function handleDriveBankCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const workspaceRoot =
		readString(envelope.payload, "workspaceRoot") ??
		readString(envelope.payload, "configParent");
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workspaceRoot or configParent is required",
		);
	}

	switch (envelope.command) {
		case "drive_bank_get": {
			const store = openWorkspaceBankStore(workspaceRoot);
			const snapshot = await store.getSnapshot();
			return okReply(envelope, { snapshot });
		}
		case "drive_bank_seed": {
			const snapshot = await seedDemoIfEmpty(workspaceRoot);
			return okReply(envelope, { snapshot });
		}
		case "drive_bank_create_task": {
			const id = readString(envelope.payload, "id");
			const title = readString(envelope.payload, "title");
			if (!id || !title) {
				return errorReply(
					envelope,
					"invalid_payload",
					"id and title are required",
				);
			}
			const bodyRaw = envelope.payload?.body;
			const body =
				typeof bodyRaw === "string" ? bodyRaw : "";
			const planId = readString(envelope.payload, "planId");
			try {
				const store = openWorkspaceBankStore(workspaceRoot);
				if (planId) {
					const plan = await store.getPlan(planId);
					if (!plan) {
						return errorReply(
							envelope,
							"not_found",
							`Plan not found: ${planId}`,
						);
					}
					await store.createTask({ id, title, body });
					await store.editPlanTaskIds(planId, [
						...plan.taskIds,
						id,
					]);
				} else {
					await store.createTask({ id, title, body });
				}
				const snapshot = await store.getSnapshot();
				return okReply(envelope, { snapshot });
			} catch (error) {
				return errorReply(
					envelope,
					"drive_bank_create_task_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		case "drive_bank_edit_plan_tasks": {
			const planId = readString(envelope.payload, "planId");
			const taskIds = readStringArray(envelope.payload, "taskIds");
			if (!planId || !taskIds) {
				return errorReply(
					envelope,
					"invalid_payload",
					"planId and taskIds (string[]) are required",
				);
			}
			try {
				const store = openWorkspaceBankStore(workspaceRoot);
				await store.editPlanTaskIds(planId, taskIds);
				const snapshot = await store.getSnapshot();
				return okReply(envelope, { snapshot });
			} catch (error) {
				return errorReply(
					envelope,
					"drive_bank_edit_plan_tasks_failed",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive bank command: ${envelope.command}`,
			);
	}
}
