// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useMemo, useRef, useState } from "react";
import { palette } from "../../palette";

export interface CheckpointPickerItem {
	runCount: number;
	text: string;
	fullText: string;
	createdAt: number;
}

export interface CheckpointPickerResult {
	runCount: number;
	messagePreview: string;
	fullText: string;
}

function formatRelativeTime(timestamp: number): string {
	const diffMs = Date.now() - timestamp;
	const diffMins = Math.floor(diffMs / 60_000);
	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays}d ago`;
}

const MAX_VISIBLE = 10;

export function CheckpointPickerContent(
	props: ChoiceContext<CheckpointPickerResult> & {
		items: CheckpointPickerItem[];
	},
) {
	const { resolve, dismiss, dialogId, items } = props;
	const lastIndex = Math.max(0, items.length - 1);
	const [selected, setSelected] = useState(lastIndex);
	const selectedRef = useRef(lastIndex);

	const safeSelected = Math.min(selected, Math.max(0, items.length - 1));
	selectedRef.current = safeSelected;

	const window = useMemo(() => {
		if (items.length <= MAX_VISIBLE) {
			return { visible: items, startIndex: 0 };
		}
		const half = Math.floor(MAX_VISIBLE / 2);
		let start = Math.max(0, safeSelected - half);
		const end = Math.min(items.length, start + MAX_VISIBLE);
		if (end - start < MAX_VISIBLE) start = Math.max(0, end - MAX_VISIBLE);
		return { visible: items.slice(start, end), startIndex: start };
	}, [items, safeSelected]);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const item = items[selectedRef.current];
			if (item) {
				resolve({
					runCount: item.runCount,
					messagePreview: item.text,
					fullText: item.fullText,
				});
			}
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelected((s) => {
				const next = s <= 0 ? items.length - 1 : s - 1;
				selectedRef.current = next;
				return next;
			});
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setSelected((s) => {
				const next = s >= items.length - 1 ? 0 : s + 1;
				selectedRef.current = next;
				return next;
			});
		}
	}, dialogId);

	if (items.length === 0) {
		return (
			<box flexDirection="column" paddingX={1} gap={1}>
				<text>Restore to Checkpoint</text>
				<text fg="gray">No checkpoints available</text>
				<text fg="gray">
					<em>Esc to close</em>
				</text>
			</box>
		);
	}

	const aboveCount = window.startIndex;
	const belowCount = items.length - window.startIndex - window.visible.length;

	return (
		<box flexDirection="column" paddingX={1}>
			<text>Restore to Checkpoint</text>

			<box flexDirection="column" marginTop={1}>
				{aboveCount > 0 && (
					<text fg="gray">
						{"▲ "}
						{aboveCount} more
					</text>
				)}

				{window.visible.map((item, i) => {
					const absIdx = window.startIndex + i;
					const isSel = absIdx === safeSelected;
					const time = formatRelativeTime(item.createdAt);

					return (
						<box
							key={item.runCount}
							paddingX={1}
							flexDirection="row"
							gap={1}
							backgroundColor={isSel ? palette.selection : undefined}
							overflow="hidden"
							height={1}
						>
							<text
								fg={isSel ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{isSel ? "❯" : " "}
							</text>
							<text fg={isSel ? palette.textOnSelection : undefined}>
								{item.text}
							</text>
							<text
								fg={isSel ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{"  "}
								{time}
							</text>
						</box>
					);
				})}

				{belowCount > 0 && (
					<text fg="gray">
						{"▼ "}
						{belowCount} more
					</text>
				)}
			</box>

			<text fg="gray" marginTop={1}>
				<em>{"↑/↓ navigate, Enter to select, Esc to cancel"}</em>
			</text>
		</box>
	);
}
