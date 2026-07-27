// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useRef, useState } from "react";
import { palette } from "../../palette";

export function AskQuestionContent(
	props: ChoiceContext<string | null> & {
		question: string;
		options: string[];
	},
) {
	const { resolve, dialogId, question, options } = props;
	const [selected, setSelected] = useState(0);
	const [inputKey, setInputKey] = useState(0);
	const customRef = useRef("");
	const selectedRef = useRef(0);

	const typing = selected === options.length;
	const totalOptions = options.length + 1;

	useDialogKeyboard((key) => {
		const isTyping = selectedRef.current === options.length;
		if (key.name === "escape") {
			if (isTyping && customRef.current) {
				customRef.current = "";
				setInputKey((k) => k + 1);
				return;
			}
			resolve(null);
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			if (isTyping) {
				if (customRef.current.trim()) {
					resolve(customRef.current.trim());
				}
				return;
			}
			resolve(options[selectedRef.current] ?? "");
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelected((s) => {
				const next = s <= 0 ? totalOptions - 1 : s - 1;
				selectedRef.current = next;
				return next;
			});
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setSelected((s) => {
				const next = s >= totalOptions - 1 ? 0 : s + 1;
				selectedRef.current = next;
				return next;
			});
			return;
		}
		if (!isTyping && key.name >= "1" && key.name <= "9") {
			const num = Number.parseInt(key.name, 10);
			if (num >= 1 && num <= options.length) {
				resolve(options[num - 1] ?? "");
			}
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text selectable>{question}</text>

			<box flexDirection="column">
				{options.map((opt, i) => (
					<box
						key={opt}
						paddingX={1}
						flexDirection="row"
						gap={1}
						backgroundColor={
							!typing && i === selected ? palette.selection : undefined
						}
						onMouseDown={() => resolve(opt)}
					>
						<text
							fg={!typing && i === selected ? palette.textOnSelection : "gray"}
							flexShrink={0}
						>
							{!typing && i === selected ? "\u276f" : " "}
						</text>
						<text
							fg={
								!typing && i === selected ? palette.textOnSelection : undefined
							}
						>
							{opt}
						</text>
					</box>
				))}
				<box
					paddingX={1}
					flexDirection="row"
					gap={1}
					backgroundColor={typing ? palette.selection : undefined}
				>
					<text
						fg={
							typing
								? palette.textOnSelection
								: selected === options.length
									? palette.selection
									: "gray"
						}
						flexShrink={0}
					>
						{selected === options.length ? "\u276f" : " "}
					</text>
					{typing ? (
						<input
							key={inputKey}
							onInput={(v: string) => {
								customRef.current = v;
							}}
							placeholder="Type a response..."
							flexGrow={1}
							focused
						/>
					) : (
						<text fg="gray">
							<em>Type a response...</em>
						</text>
					)}
				</box>
			</box>

			<text fg="gray">
				<em>
					{typing
						? "Enter to submit, Esc to go back"
						: `↑/↓ navigate, Enter to select, 1-${options.length} to pick`}
				</em>
			</text>
		</box>
	);
}
