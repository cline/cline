/** Cloud input deliberately never enters local slash/plugin/file expansion. */
export function classifyCloudInput(text: string): {
	command?: string;
	argument: string;
} {
	const match = /^\/([a-zA-Z0-9_.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
	return match
		? { command: match[1].toLowerCase(), argument: match[2]?.trim() ?? "" }
		: { argument: text };
}

import type {
	CliCloudRuntime,
	CloudRuntimeState,
} from "../../runtime/cloud/runtime";

/** Decisions are tied to the rendered target and server-owned IDs, never local approval policy. */
export async function dispatchCloudSessionCommand(
	runtime: Pick<
		CliCloudRuntime,
		| "getSnapshot"
		| "stop"
		| "respondApproval"
		| "removePendingPrompt"
		| "updatePendingPrompt"
	>,
	state: CloudRuntimeState,
	command: string,
	argument: string,
): Promise<boolean> {
	if (
		!["stop", "abort", "approve", "reject", "remove", "steer"].includes(command)
	)
		return false;
	if (!state.target || runtime.getSnapshot().target !== state.target)
		throw new Error("Cloud session changed. Choose the action again.");
	if (command === "stop" || command === "abort") {
		await runtime.stop();
		return true;
	}
	const index = /^\d+$/.test(argument) ? Number(argument) - 1 : -1;
	if (command === "approve" || command === "reject") {
		const approval = state.session?.approvals[index];
		if (!approval)
			throw new Error("Use the pending approval number shown above.");
		await runtime.respondApproval(approval.approvalId, command === "approve");
	} else {
		const item = state.session?.promptsInQueue[index];
		if (!item) throw new Error("Use a queued message number.");
		if (command === "remove") await runtime.removePendingPrompt(item.id);
		else await runtime.updatePendingPrompt(item.id, item.prompt, "steer");
	}
	return true;
}
