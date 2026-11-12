import { AlertDialog } from "@cline/ui";
import type { UnsavedChangesGuard } from "@/lib/unsaved-changes";

/** The one confirmation shown before an editor's unsaved changes are dropped. */
export function DiscardChangesDialog({
	guard,
	description = "Your changes have not been saved.",
}: {
	guard: UnsavedChangesGuard;
	description?: string;
}) {
	return (
		<AlertDialog
			open={guard.isConfirming}
			onOpenChange={(open) => {
				if (!open) guard.cancel();
			}}
			title="Discard unsaved changes?"
			description={description}
			cancelLabel="Keep editing"
			confirmLabel="Discard"
			confirmTone="destructive"
			onConfirm={guard.confirm}
		/>
	);
}
