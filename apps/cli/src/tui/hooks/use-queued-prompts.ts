import { useCallback, useState } from "react";
import type { PendingPromptSnapshot } from "../../runtime/session-events";
import type { QueuedPromptItem } from "../types";

export function toQueuedPromptItems(
	event: PendingPromptSnapshot,
): QueuedPromptItem[] {
	return event.prompts.map((entry, index) => ({
		id: entry.id || `${entry.delivery}:${index}:${entry.prompt}`,
		prompt: entry.prompt,
		steer: entry.delivery === "steer",
		attachmentCount: entry.attachmentCount,
	}));
}

export function resolveQueuedPromptSelection(input: {
	items: QueuedPromptItem[];
	selectedId: string | null;
	direction: "up" | "down";
}): string | null {
	if (input.items.length === 0) {
		return null;
	}

	const currentIndex = input.selectedId
		? input.items.findIndex((item) => item.id === input.selectedId)
		: -1;

	if (input.direction === "up") {
		if (currentIndex < 0) {
			return input.items[input.items.length - 1]?.id ?? null;
		}
		return input.items[Math.max(0, currentIndex - 1)]?.id ?? null;
	}

	if (currentIndex < 0) {
		return null;
	}
	const nextIndex = currentIndex + 1;
	return nextIndex >= input.items.length
		? null
		: (input.items[nextIndex]?.id ?? null);
}

export function useQueuedPrompts() {
	const [queuedPrompts, setQueuedPrompts] = useState<QueuedPromptItem[]>([]);

	const handlePendingPrompts = useCallback((event: PendingPromptSnapshot) => {
		setQueuedPrompts(toQueuedPromptItems(event));
	}, []);

	return { queuedPrompts, handlePendingPrompts };
}
