// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import open from "open";
import { useCallback, useMemo, useState } from "react";
import { palette } from "../tui/palette";
import { getCliSubscriptionUrl } from "../utils/cline-pass-errors";
import type { CliMigrationNotice } from "./notice";

export function MigrationNoticeContent(
	props: ChoiceContext<boolean> & {
		notice: CliMigrationNotice;
	},
) {
	const { dialogId, notice, resolve } = props;
	const subscriptionUrl = useMemo(() => getCliSubscriptionUrl(), []);
	const [status, setStatus] = useState<string | undefined>();

	const openSubscriptionPage = useCallback(() => {
		setStatus("Opening Cline Pass in your browser...");
		void open(subscriptionUrl, { wait: false })
			.then(() => {
				setStatus("Opened Cline Pass in your browser.");
			})
			.catch(() => {
				setStatus(
					"Could not open the browser automatically. Use the URL below.",
				);
			});
	}, [subscriptionUrl]);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			resolve(true);
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			openSubscriptionPage();
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>{notice.title}</text>
			<box flexDirection="column">
				<text selectable>
					Cline Pass is a $9.99/month subscription plan to get access to the
					latest open-weight coding models with enough quota for day-to-day
					work, at a much lower cost than paying API costs directly.
				</text>
				<text selectable>Try it now with a limited-time promo for $1.99.</text>
			</box>
			<box flexDirection="row">
				<text fg={palette.act} selectable>
					<a href={subscriptionUrl}>{subscriptionUrl}</a>
				</text>
			</box>
			<box flexDirection="row">
				<box paddingX={1} backgroundColor={palette.act}>
					<text fg={palette.textOnSelection}>Open Cline Pass</text>
				</box>
			</box>
			{status && <text fg={palette.muted}>{status}</text>}
			<text fg={palette.muted}>Press Enter to open, Esc to close</text>
		</box>
	);
}
