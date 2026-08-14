// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { palette } from "../../palette";
import { resolveHubUpdateRequiredKeyAction } from "./hub-update-required-helpers";

export interface HubUpdateRequiredDetails {
	hubCoreVersion?: string;
	/**
	 * `outdated_hub` means this CLI is already the newer build and the Hub was
	 * left running because it is serving sessions. There is nothing to install,
	 * so the dialog only explains what to do.
	 */
	reason?: "unsupported_protocol" | "build_mismatch" | "outdated_hub";
}

export function HubUpdateRequiredContent(
	props: ChoiceContext<boolean> & HubUpdateRequiredDetails,
) {
	const { dialogId, dismiss, hubCoreVersion, reason, resolve } = props;
	const hubIsOutdated = reason === "outdated_hub";

	useDialogKeyboard((key) => {
		const action = resolveHubUpdateRequiredKeyAction(key);
		if (action === "ignore") return;
		if (action === "update" && !hubIsOutdated) {
			resolve(true);
			return;
		}
		dismiss();
	}, dialogId);

	if (hubIsOutdated) {
		return (
			<box flexDirection="column" paddingX={1} gap={1}>
				<text fg="yellow">Cline Hub is running an older build</text>
				<box flexDirection="column">
					<text selectable>
						This CLI is newer than the shared Cline Hub
						{hubCoreVersion ? ` (core ${hubCoreVersion})` : ""}, which was left
						running because it is still serving active sessions.
					</text>
					<text selectable>
						Your work is unaffected. The newer build takes over the next time
						Cline starts after those sessions end.
					</text>
				</box>
				<text fg={palette.muted}>Press Esc to dismiss</text>
			</box>
		);
	}

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg="yellow">Cline Hub was updated</text>
			<box flexDirection="column">
				<text selectable>
					Another Cline installation restarted the shared Cline Hub
					{hubCoreVersion ? ` (core ${hubCoreVersion})` : ""}, and it no longer
					matches this CLI.
				</text>
				<text selectable>
					Update and restart Cline so this CLI and the Hub run the same version
					again.
				</text>
			</box>
			<box flexDirection="row">
				<box paddingX={1} backgroundColor={palette.act}>
					<text fg={palette.textOnSelection}>Update and restart</text>
				</box>
			</box>
			<text fg={palette.muted}>
				Press Enter to update and restart, Esc to dismiss
			</text>
		</box>
	);
}
