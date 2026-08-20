// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useDialogPalette } from "../../hooks/use-theme";
import { resolveHubUpdateRequiredKeyAction } from "./hub-update-required-helpers";

export interface HubUpdateRequiredDetails {
	hubCoreVersion?: string;
}

export function HubUpdateRequiredContent(
	props: ChoiceContext<boolean> & HubUpdateRequiredDetails,
) {
	const { dialogId, dismiss, hubCoreVersion, resolve } = props;
	const palette = useDialogPalette();

	useDialogKeyboard((key) => {
		const action = resolveHubUpdateRequiredKeyAction(key);
		if (action === "ignore") return;
		if (action === "update") {
			resolve(true);
			return;
		}
		dismiss();
	}, dialogId);

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
