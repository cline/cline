import type { Config } from "../../../utils/types";
import type { DialogDismissKey } from "../../utils/dialog-keys";

/**
 * Enter starts the update-and-restart flow; Esc dismisses (the mismatch toast
 * reminds the user to update manually). Other keys are ignored so the dialog
 * is not lost to a stray keystroke mid-task.
 */
export function resolveHubUpdateRequiredKeyAction(
	key: DialogDismissKey,
): "update" | "dismiss" | "ignore" {
	if (key.name === "return" || key.name === "enter") return "update";
	if (key.name === "escape") return "dismiss";
	return "ignore";
}

/**
 * Human phrase for the live work an outdated Hub is serving, used by the
 * "Hub update required" dialog. Falls back to an unquantified phrase when the
 * Hub could not answer the activity query.
 */
export function describeOutdatedHubSessions(counts: {
	activeSessionCount?: number;
	participantClientCount?: number;
}): string {
	const sessions = counts.activeSessionCount;
	if (typeof sessions !== "number" || sessions <= 0) {
		return "active sessions from other Cline clients";
	}
	const sessionsPhrase = `${sessions} active session${sessions === 1 ? "" : "s"}`;
	const clients = counts.participantClientCount;
	if (typeof clients !== "number" || clients <= 0) {
		return sessionsPhrase;
	}
	return `${sessionsPhrase} from ${clients} connected Cline client${clients === 1 ? "" : "s"}`;
}

/**
 * Yolo and sandbox sessions force the local backend and never attach to the
 * shared managed Hub (see the forceLocalBackend condition in the interactive
 * session runtime), so a build mismatch on that Hub is another installation's
 * concern and must not interrupt these sessions with an update dialog.
 */
export function shouldWatchManagedHubBuild(
	config: Pick<Config, "mode" | "sandbox">,
): boolean {
	return config.mode !== "yolo" && config.sandbox !== true;
}
