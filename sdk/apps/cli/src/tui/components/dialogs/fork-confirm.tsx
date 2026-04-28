import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";

export function ForkConfirmContent(ctx: ChoiceContext<boolean>) {
	useDialogKeyboard((key) => {
		if (key.name === "return" || key.name === "y") {
			ctx.resolve(true);
		} else if (key.name === "escape" || key.name === "n") {
			ctx.dismiss();
		}
	}, ctx.dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<text>Create a new session from the current conversation?</text>
			<text fg="gray" marginTop={1}>
				<em>Y/Enter to confirm, N/Esc to cancel</em>
			</text>
		</box>
	);
}
