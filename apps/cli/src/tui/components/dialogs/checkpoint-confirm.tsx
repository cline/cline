// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useRef, useState } from "react";
import { palette } from "../../palette";

export type CheckpointRestoreMode = "chat-only" | "chat-and-workspace";

const OPTIONS: Array<{
	value: CheckpointRestoreMode;
	label: string;
	detail: string;
}> = [
	{
		value: "chat-only",
		label: "Restore chat only",
		detail: "Rewind conversation, keep current files",
	},
	{
		value: "chat-and-workspace",
		label: "Restore chat and workspace",
		detail: "Rewind conversation and reset files",
	},
];

export function CheckpointConfirmContent(
	props: ChoiceContext<CheckpointRestoreMode> & {
		messagePreview: string;
	},
) {
	const { resolve, dismiss, dialogId, messagePreview } = props;
	const [selected, setSelected] = useState(0);
	const selectedRef = useRef(0);
	const selectedMode = OPTIONS[selected]?.value;

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const option = OPTIONS[selectedRef.current];
			if (option) {
				resolve(option.value);
			}
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelected((s) => {
				const next = s <= 0 ? OPTIONS.length - 1 : s - 1;
				selectedRef.current = next;
				return next;
			});
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setSelected((s) => {
				const next = s >= OPTIONS.length - 1 ? 0 : s + 1;
				selectedRef.current = next;
				return next;
			});
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text>
				Restore to: {'"'}
				{messagePreview}
				{'"'}
			</text>

			<box flexDirection="column">
				{OPTIONS.map((opt, i) => {
					const isSel = i === selected;
					return (
						<box
							key={opt.value}
							paddingX={1}
							flexDirection="row"
							gap={1}
							backgroundColor={isSel ? palette.selection : undefined}
						>
							<text
								fg={isSel ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{isSel ? "❯" : " "}
							</text>
							<box flexDirection="column">
								<text fg={isSel ? palette.textOnSelection : undefined}>
									{opt.label}
								</text>
								<text fg={isSel ? palette.textOnSelection : "gray"}>
									{opt.detail}
								</text>
							</box>
						</box>
					);
				})}
			</box>

			{selectedMode === "chat-and-workspace" && (
				<text fg="yellow">
					This runs git reset --hard and git clean -fd in the workspace.
				</text>
			)}

			<text fg="gray">
				<em>{"↑/↓ navigate, Enter to confirm, Esc to cancel"}</em>
			</text>
		</box>
	);
}
