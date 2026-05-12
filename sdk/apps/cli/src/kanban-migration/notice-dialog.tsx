// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { palette } from "../tui/palette";
import type { CliMigrationNotice } from "./notice";

export function MigrationNoticeContent(
	props: ChoiceContext<boolean> & {
		notice: CliMigrationNotice;
	},
) {
	const { dialogId, notice, resolve } = props;

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			resolve(true);
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>{notice.title}</text>
			<box flexDirection="column">
				<text selectable>
					We rebuilt the CLI from the ground up using the new Cline SDK. Learn
					more:{" "}
					<a href="https://github.com/cline/cline">
						<span fg={palette.act}>https://github.com/cline/cline</span>
					</a>
				</text>
				<text selectable>
					Running{" "}
					<span fg="#98c379" bg="#1f2937">
						{" cline "}
					</span>{" "}
					now opens the terminal UI. To open Kanban, use /quit and run{" "}
					<span fg="#98c379" bg="#1f2937">
						{" cline kanban "}
					</span>{" "}
					on your terminal
				</text>
			</box>
			<text fg={palette.muted}>Press Esc to close</text>
		</box>
	);
}
