// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useMemo, useState } from "react";
import { useDialogPalette } from "../tui/hooks/use-theme";
import {
	type DialogDismissKey,
	isAnyKeyDismiss,
} from "../tui/utils/dialog-keys";
import { getCliSubscriptionUrl } from "../utils/cline-pass-errors";
import open from "../utils/open";
import type { CliMigrationNotice } from "./notice";

/**
 * Enter opens the subscription page; any other (unmodified) key dismisses the
 * dialog; modifier-held keys are ignored.
 *
 * The dialog used to be dismissible only with Esc, but Esc is the least
 * reliable key across terminals (it arrives as a bare `\x1b` that needs
 * timeout disambiguation, and Windows console input layers are known to
 * swallow it), which left users stuck behind the promo with no way out.
 * Modifier-held keys are ignored so that holding Cmd/Ctrl to click the
 * subscription link never dismisses the dialog mid-click.
 */
export function resolveMigrationNoticeKeyAction(
	key: DialogDismissKey,
): "open" | "dismiss" | "ignore" {
	if (!isAnyKeyDismiss(key)) return "ignore";
	return key.name === "return" || key.name === "enter" ? "open" : "dismiss";
}

export function MigrationNoticeContent(
	props: ChoiceContext<boolean> & {
		notice: CliMigrationNotice;
	},
) {
	const { dialogId, notice, resolve } = props;
	const palette = useDialogPalette();
	const subscriptionUrl = useMemo(() => getCliSubscriptionUrl(), []);
	const [status, setStatus] = useState<string | undefined>();

	const openSubscriptionPage = useCallback(() => {
		setStatus("Opening ClinePass in your browser...");
		void open(subscriptionUrl, { wait: false })
			.then(() => {
				setStatus("Opened ClinePass in your browser.");
			})
			.catch(() => {
				setStatus(
					"Could not open the browser automatically. Use the URL below.",
				);
			});
	}, [subscriptionUrl]);

	useDialogKeyboard((key) => {
		const action = resolveMigrationNoticeKeyAction(key);
		if (action === "ignore") return;
		if (action === "open") {
			openSubscriptionPage();
			return;
		}
		resolve(true);
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>{notice.title}</text>
			<box flexDirection="column">
				<text selectable>
					ClinePass is a $9.99/month subscription plan to get access to the
					latest open-weight coding models with enough quota for day-to-day
					work, at a much lower cost than paying API costs directly.
				</text>
			</box>
			<box flexDirection="row">
				<text fg={palette.act} selectable>
					<a href={subscriptionUrl}>{subscriptionUrl}</a>
				</text>
			</box>
			<box flexDirection="row">
				<box paddingX={1} backgroundColor={palette.act}>
					<text fg={palette.textOnSelection}>Open ClinePass</text>
				</box>
			</box>
			{status && <text fg={palette.muted}>{status}</text>}
			<text fg={palette.muted}>
				Press Enter to open, any other key to close
			</text>
		</box>
	);
}
