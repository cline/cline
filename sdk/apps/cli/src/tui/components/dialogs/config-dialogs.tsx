import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { palette } from "../../palette";

export function ExtDetailContent(
	props: ChoiceContext<void> & {
		name: string;
		path: string;
		source: string;
		enabled?: boolean;
	},
) {
	useDialogKeyboard((key) => {
		if (key.name === "escape" || key.name === "return") {
			props.dismiss();
		}
	}, props.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg="cyan">
				<strong>{props.name}</strong>
			</text>
			<text
				fg={props.source === "workspace" ? palette.success : "gray"}
				marginTop={1}
			>
				{props.source}
			</text>
			<text fg="gray" marginTop={1}>
				{props.path}
			</text>
			{typeof props.enabled === "boolean" && (
				<text fg={props.enabled ? palette.success : "red"} marginTop={1}>
					{props.enabled ? "Enabled" : "Disabled"}
				</text>
			)}
			<text fg="gray" marginTop={1}>
				<em>Esc to go back</em>
			</text>
		</box>
	);
}
