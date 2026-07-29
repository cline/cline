import { PLAN_DEPENDENCY_DEMO_TEAMS } from "./plan-tasks-fixture";
import { STATUS_BOARD_DEMO_UPDATES } from "./status-board-demo";
import type { StatusSnapshot, StatusSnapshotSource } from "./status-snapshot-source";

/**
 * Demo StatusSnapshotSource: board rows + Drive plan dependency teams.
 * Does not read env or query — wire via composition-root bootstrap helpers.
 */
export class DrivePlansDemoStatusSnapshotSource implements StatusSnapshotSource {
	load(): Promise<StatusSnapshot> {
		return Promise.resolve({
			updates: STATUS_BOARD_DEMO_UPDATES,
			summary: null,
			teams: PLAN_DEPENDENCY_DEMO_TEAMS,
		});
	}
}
