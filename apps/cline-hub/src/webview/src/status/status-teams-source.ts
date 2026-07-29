import type { TeamRuntimeState } from "@cline/shared";

/** Port for loading dependency-map teams (live hub or demo adapter). */
export interface StatusTeamsSource {
	loadTeams(): Promise<TeamRuntimeState[]>;
}
