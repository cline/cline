import {
	sendHubCommand,
	type HubEndpointOverrides,
} from "@cline/core";
import type {
	StatusSummary,
	StatusUpdate,
	TeamRuntimeState,
} from "@cline/shared";
import {
	ensureCliHubServer,
	parseHubEndpointOverride,
} from "../../utils/hub-runtime";
import type { StatusSnapshot, StatusSnapshotSource } from "./status-snapshot-source";

async function statusCommand(
	endpoint: HubEndpointOverrides,
	command: "status.board" | "status.summary" | "status.tasks_snapshot",
	payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const reply = await sendHubCommand(endpoint, {
		clientId: "cline-tui-status",
		command,
		payload,
	});
	if (!reply.ok) {
		throw new Error(reply.error?.message ?? `hub command failed: ${command}`);
	}
	return (reply.payload ?? {}) as Record<string, unknown>;
}

export function createHubStatusSnapshotSource(options?: {
	address?: string;
}): StatusSnapshotSource {
	return {
		async load(): Promise<StatusSnapshot> {
			const endpoint = parseHubEndpointOverride(options?.address);
			await ensureCliHubServer(process.cwd(), endpoint);
			const [board, summary, tasks] = await Promise.all([
				statusCommand(endpoint, "status.board", {
					limit: 50,
					includeHistoryCount: true,
				}),
				statusCommand(endpoint, "status.summary"),
				statusCommand(endpoint, "status.tasks_snapshot"),
			]);
			return {
				updates: Array.isArray(board.updates)
					? (board.updates as StatusUpdate[])
					: [],
				summary: (summary.summary as StatusSummary | undefined) ?? null,
				teams: Array.isArray(tasks.teams)
					? (tasks.teams as TeamRuntimeState[])
					: [],
			};
		},
	};
}
