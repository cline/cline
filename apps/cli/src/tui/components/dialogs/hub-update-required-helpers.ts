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
