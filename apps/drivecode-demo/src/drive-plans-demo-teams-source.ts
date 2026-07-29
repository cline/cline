import type { TeamRuntimeState } from "@cline/shared";
import { PLAN_DEPENDENCY_DEMO_TEAMS } from "./plan-tasks-fixture";

/**
 * Demo StatusTeamsSource for the hub dependency map.
 * Does not read env or query — wire via composition-root bootstrap helpers.
 */
export class DrivePlansDemoTeamsSource {
	loadTeams(): Promise<TeamRuntimeState[]> {
		return Promise.resolve(PLAN_DEPENDENCY_DEMO_TEAMS);
	}
}
