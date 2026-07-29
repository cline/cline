import type { TeamRuntimeState } from "@cline/shared";
import { postToHost } from "../vscode";
import type { StatusTeamsSource } from "./status-teams-source";

/**
 * Live hub adapter: requests `status_tasks_snapshot` and resolves when the
 * matching `status_tasks_snapshot_result` message arrives.
 */
export class HubStatusTeamsSource implements StatusTeamsSource {
	loadTeams(): Promise<TeamRuntimeState[]> {
		return new Promise((resolve) => {
			const requestId = `status-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}`;

			function onMessage(event: MessageEvent) {
				const message = event.data as { type: string } & Record<string, unknown>;
				if (message.type !== "status_tasks_snapshot_result") return;
				if (message.requestId !== requestId) return;
				window.removeEventListener("message", onMessage);
				resolve(
					Array.isArray(message.teams)
						? (message.teams as TeamRuntimeState[])
						: [],
				);
			}

			window.addEventListener("message", onMessage);
			postToHost({ type: "status_tasks_snapshot", requestId });
		});
	}
}
