import { useCallback, useState } from "react";
import type { PendingPromptSnapshot } from "../../runtime/session-events";
import type { QueuedPromptItem } from "../types";

export function useQueuedPrompts() {
	const [queuedPrompts, setQueuedPrompts] = useState<QueuedPromptItem[]>([]);

	const handlePendingPrompts = useCallback((event: PendingPromptSnapshot) => {
		setQueuedPrompts(
			event.prompts.map((entry, index) => ({
				id: entry.id || `${entry.delivery}:${index}:${entry.prompt}`,
				prompt: entry.prompt,
				steer: entry.delivery === "steer",
			})),
		);
	}, []);

	return { queuedPrompts, handlePendingPrompts };
}
