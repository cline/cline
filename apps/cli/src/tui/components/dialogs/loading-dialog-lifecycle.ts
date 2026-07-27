import type { DialogActions, DialogId } from "@opentui-ui/dialog/react";

export type LoadingDialogActions = Pick<DialogActions, "show" | "close">;

export async function withShownDialog<T>(
	dialog: Pick<DialogActions, "close">,
	show: () => DialogId,
	run: () => Promise<T>,
): Promise<T> {
	const loadingDialogId = show();
	// Give OpenTUI a microtask to mount the loading dialog before work starts.
	await Promise.resolve();
	try {
		return await run();
	} finally {
		dialog.close(loadingDialogId);
	}
}
