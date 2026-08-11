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
