"use client";

import { AgentUxVerification } from "@cline/ui";
import type { ChatMessage, ChatMessageImage } from "@/lib/chat-schema";
import { normalizeDisplayValue, parseToolPayload } from "./tool-summaries";

export function UxVerificationMessage({
	message,
	isRunActive,
	onExpandImage,
}: {
	message: ChatMessage;
	isRunActive: boolean;
	onExpandImage?: (image: ChatMessageImage) => void;
}) {
	const payload = parseToolPayload(message.content);
	const pending = payload?.result == null && !payload?.isError;
	return (
		<AgentUxVerification
			output={normalizeDisplayValue(payload?.result)}
			state={
				payload?.isError || (pending && !isRunActive)
					? "error"
					: pending
						? "running"
						: "completed"
			}
			error={
				payload?.isError
					? "The UX verifier failed. Retry the checklist after resolving the tool error."
					: pending && !isRunActive
						? "Verification stopped before a report was returned."
						: undefined
			}
			onExpandScreenshot={
				onExpandImage
					? (check) => {
							if (check.screenshot?.data)
								onExpandImage({
									id: `${message.id}_${check.id}`,
									mediaType: check.screenshot.mediaType,
									data: check.screenshot.data,
								});
						}
					: undefined
			}
		/>
	);
}
