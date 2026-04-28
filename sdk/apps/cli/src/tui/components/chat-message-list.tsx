import "opentui-spinner/react";
import type { AgentMode } from "@clinebot/core";
import { getModeAccent } from "../palette";
import type { ChatEntry } from "../types";
import { ChatEntryView } from "./chat-entry";

export function ChatMessageList(props: {
	entries: ChatEntry[];
	isStreaming?: boolean;
	uiMode?: AgentMode;
}) {
	return (
		<scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
			<box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
				{props.entries.map((entry, i) => {
					const key = `${i}:${entry.kind}`;
					return (
						<ChatEntryView
							key={key}
							entry={entry}
							accent={getModeAccent(props.uiMode ?? "act")}
						/>
					);
				})}
				{props.isStreaming && (
					<box flexDirection="row" gap={1}>
						<spinner name="dots" color={getModeAccent(props.uiMode ?? "act")} />
						<text fg="gray">Thinking... (esc to cancel)</text>
					</box>
				)}
			</box>
		</scrollbox>
	);
}
