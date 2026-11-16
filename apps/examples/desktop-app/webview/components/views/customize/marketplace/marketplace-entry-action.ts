import type { EntryActionState } from "@/lib/use-marketplace-directory";

/** Whether an install or uninstall of this entry is in flight. */
export function isEntryActionBusy(
	state: EntryActionState | undefined,
): boolean {
	return state?.status === "installing" || state?.status === "uninstalling";
}

/** The install button's label, including progress and the wait for installed status. */
export function entryActionLabel(
	state: EntryActionState | undefined,
	installed: boolean,
	ready: boolean,
): string {
	if (state?.status === "installing") return "Installing…";
	if (state?.status === "uninstalling") return "Uninstalling…";
	if (!ready) return "Checking…";
	return installed ? "Uninstall" : "Install";
}

/** The status a card shows after a failed install or uninstall. */
export function entryFailureStatus(
	state: EntryActionState | undefined,
): "install-failed" | "uninstall-failed" | undefined {
	if (state?.status !== "failed") return undefined;
	return state.operation === "install" ? "install-failed" : "uninstall-failed";
}
