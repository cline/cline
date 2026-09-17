import { mkdir } from "node:fs/promises";
import { resolveAgentSchedulesDir } from "@cline/shared/storage";

/**
 * Ensure the home workspace for agent-created schedules exists and return its
 * path. Agent-created schedules are user-level routines: they anchor (and
 * their unattended sessions run) in `~/.cline/schedules/` instead of
 * inheriting whichever chat workspace happened to create them, so they
 * survive chat cleanup and stay in one predictable scope.
 */
export async function ensureAgentSchedulesWorkspace(): Promise<string> {
	const schedulesHome = resolveAgentSchedulesDir();
	await mkdir(schedulesHome, { recursive: true, mode: 0o700 });
	return schedulesHome;
}
