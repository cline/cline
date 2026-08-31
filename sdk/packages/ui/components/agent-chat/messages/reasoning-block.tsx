"use client";

import { ThinkingBlock } from "../index.js";
import type { ChatMarkdownComponent } from "./chat-message.js";

/** The shared ThinkingBlock with the host's Markdown pipeline as its body. */
export function ReasoningBlock({
	content,
	durationMilliseconds,
	markdown: Markdown,
	redacted,
	streaming = false,
}: {
	content: string;
	durationMilliseconds?: number;
	/** Host-owned Markdown renderer (link/image policy stays with the host). */
	markdown: ChatMarkdownComponent;
	redacted: boolean;
	streaming?: boolean;
}) {
	const displayContent = content || (redacted ? "[redacted]" : "");
	if (!displayContent) {
		return null;
	}

	return (
		<ThinkingBlock
			className="my-0"
			durationMilliseconds={durationMilliseconds}
			isStreaming={streaming}
			redacted={redacted}
		>
			<Markdown
				classNames="text-cline-ui-sm"
				content={displayContent}
				streaming={streaming}
			/>
		</ThinkingBlock>
	);
}
