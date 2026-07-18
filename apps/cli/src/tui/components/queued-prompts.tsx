import "opentui-spinner/react";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { useSession } from "../contexts/session-context";
import { palette } from "../palette";
import type { QueuedPromptItem } from "../types";
import { truncateToWidth } from "../utils/responsive-layout";

function attachmentLabel(count: number, compact: boolean): string {
	if (count <= 0) return "";
	if (compact) return count === 1 ? "1 file" : `${count} files`;
	return count === 1 ? "1 attachment" : `${count} attachments`;
}

export function QueuedPrompts(props: {
	items: QueuedPromptItem[];
	selectedId: string | null;
	editingId: string | null;
	onEditConfirm: (id: string, prompt: string) => void;
}) {
	const session = useSession();
	const { width } = useTerminalDimensions();
	if (props.items.length === 0) return null;

	const selected = props.selectedId
		? props.items.find((item) => item.id === props.selectedId)
		: undefined;
	const selectedIsEditing = selected?.id === props.editingId;
	const escapeHint = session.isRunning ? "Esc cancels turn" : "Esc back";
	const hint = selected
		? selectedIsEditing
			? "Enter confirm, Esc cancel"
			: selected.steer
				? session.isRunning
					? "Waiting. ↑/↓ navigate, Tab edit, Esc cancels turn"
					: `Steered next. ↑/↓ navigate, Tab edit, ${escapeHint}`
				: `↑/↓ navigate, Enter steer, Tab edit, ${escapeHint}`
		: "↑ steer or edit messages";
	const rowContentWidth = Math.max(1, width - 8);
	const visibleHint = truncateToWidth(hint, Math.max(1, width - 4));

	return (
		<box
			flexDirection="column"
			border
			borderStyle="rounded"
			borderColor={selected ? palette.selection : "gray"}
			paddingX={1}
		>
			<text fg="gray">
				<em>Queued messages:</em>
			</text>
			{props.items.map((item) => {
				const isSelected = item.id === props.selectedId;
				const isEditing = item.id === props.editingId;
				return (
					<QueuedPromptRow
						key={item.id}
						item={item}
						selected={isSelected}
						editing={isEditing}
						availableWidth={rowContentWidth}
						onEditConfirm={(prompt) => props.onEditConfirm(item.id, prompt)}
					/>
				);
			})}
			<text fg="gray">
				<em>{visibleHint}</em>
			</text>
		</box>
	);
}

function QueuedPromptRow(props: {
	item: QueuedPromptItem;
	selected: boolean;
	editing: boolean;
	availableWidth: number;
	onEditConfirm: (prompt: string) => void;
}) {
	const { item, selected, editing, availableWidth } = props;
	const [editValue, setEditValue] = useState(item.prompt);
	const compact = availableWidth < 36;
	const attachment = attachmentLabel(item.attachmentCount, compact);
	const showAttachment =
		!editing && Boolean(attachment) && availableWidth >= 18;
	const promptWidth = Math.max(
		1,
		availableWidth - (showAttachment ? attachment.length + 1 : 0),
	);

	useEffect(() => {
		if (editing) {
			setEditValue(item.prompt);
		}
	}, [editing, item.prompt]);

	return (
		<box
			paddingX={1}
			flexDirection="row"
			gap={1}
			backgroundColor={selected ? palette.selection : undefined}
			overflow="hidden"
			height={1}
		>
			{item.steer && !editing ? (
				<spinner
					name="dots"
					color={selected ? palette.textOnSelection : "gray"}
				/>
			) : (
				<text fg={selected ? palette.textOnSelection : "gray"} flexShrink={0}>
					{selected ? "❯" : " "}
				</text>
			)}
			{editing ? (
				<input
					value={editValue}
					onInput={setEditValue}
					onSubmit={() => props.onEditConfirm(editValue)}
					placeholder="Edit message..."
					backgroundColor={palette.selection}
					focusedBackgroundColor={palette.selection}
					textColor={palette.textOnSelection}
					cursorColor={palette.textOnSelection}
					placeholderColor={palette.textOnSelection}
					focused
					flexGrow={1}
				/>
			) : (
				<text
					fg={selected ? palette.textOnSelection : undefined}
					width={promptWidth}
					flexShrink={0}
					overflow="hidden"
					wrapMode="none"
				>
					{truncateToWidth(item.prompt, promptWidth)}
				</text>
			)}
			{showAttachment && (
				<text fg={selected ? palette.textOnSelection : "gray"} flexShrink={0}>
					{attachment}
				</text>
			)}
		</box>
	);
}
