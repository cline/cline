"use client";

import { ThinkingBlock } from "@cline/ui/components/agent-chat";
import { MemoizedMarkdown } from "../../../ui/markdown";

/** The shared ThinkingBlock with the app's Markdown pipeline as its body. */
export function ReasoningBlock({
	content,
	durationMilliseconds,
	redacted,
	streaming = false,
}: {
	content: string;
	durationMilliseconds?: number;
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
			<MemoizedMarkdown
				classNames="text-sm"
				content={displayContent}
				streaming={streaming}
			/>
		</ThinkingBlock>
	);
}
