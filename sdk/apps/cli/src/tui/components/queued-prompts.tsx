import type { QueuedPromptItem } from "../types";

export function QueuedPrompts(props: { items: QueuedPromptItem[] }) {
	if (props.items.length === 0) return null;

	return (
		<box
			flexDirection="column"
			border
			borderStyle="rounded"
			borderColor="gray"
			paddingX={1}
		>
			<text fg="gray">
				<em>Queued for upcoming turns:</em>
			</text>
			{props.items.map((item) => (
				<box key={item.id} flexDirection="row" gap={1}>
					{item.steer ? (
						<text fg="yellow">[steer]</text>
					) : (
						<text fg="gray">[queued]</text>
					)}
					<text>
						{item.prompt.length > 60
							? `${item.prompt.slice(0, 60)}...`
							: item.prompt}
					</text>
				</box>
			))}
			<text fg="gray">
				<em>Ctrl+S to steer next turn</em>
			</text>
		</box>
	);
}
