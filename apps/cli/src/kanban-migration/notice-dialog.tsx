// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useCallback, useState } from "react";
import { useDialogPalette } from "../tui/hooks/use-theme";
import {
	type DialogDismissKey,
	isAnyKeyDismiss,
} from "../tui/utils/dialog-keys";
import open from "../utils/open";
import type { CliMigrationNotice } from "./notice";

/**
 * Enter opens the notice's page; any other (unmodified) key dismisses the
 * dialog; modifier-held keys are ignored.
 *
 * The dialog used to be dismissible only with Esc, but Esc is the least
 * reliable key across terminals (it arrives as a bare `\x1b` that needs
 * timeout disambiguation, and Windows console input layers are known to
 * swallow it), which left users stuck behind the promo with no way out.
 * Modifier-held keys are ignored so that holding Cmd/Ctrl to click the
 * link never dismisses the dialog mid-click.
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
	const [status, setStatus] = useState<string | undefined>();

	const openNoticePage = useCallback(() => {
		setStatus("Opening in your browser...");
		void open(notice.url, { wait: false })
			.then(() => {
				setStatus("Opened in your browser.");
			})
			.catch(() => {
				setStatus(
					"Could not open the browser automatically. Use the URL below.",
				);
			});
	}, [notice.url]);

	useDialogKeyboard((key) => {
		const action = resolveMigrationNoticeKeyAction(key);
		if (action === "ignore") return;
		if (action === "open") {
			openNoticePage();
			return;
		}
		resolve(true);
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>{notice.title}</text>
			<box flexDirection="column">
				{notice.body.split("\n").map((line) => (
					<text key={line} selectable>
						{line}
					</text>
				))}
			</box>
			<box flexDirection="row">
				<text fg={palette.act} selectable>
					<a href={notice.url}>{notice.url}</a>
				</text>
			</box>
			<box flexDirection="row">
				<box paddingX={1} backgroundColor={palette.act}>
					<text fg={palette.textOnSelection}>{notice.openLabel}</text>
				</box>
			</box>
			{status && <text fg={palette.muted}>{status}</text>}
			<text fg={palette.muted}>
				Press Enter to open, any other key to close
			</text>
		</box>
	);
}
