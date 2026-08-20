import { useCallback, useState } from "react";
import type { PendingPromptSnapshot } from "../../runtime/session-events";
import type { QueuedPromptItem } from "../types";

export function monitorPromptLabel(
	origin: NonNullable<PendingPromptSnapshot["prompts"][number]["origin"]>,
): string {
	if (origin.kind !== "monitor" || origin.updates.length === 0) {
		return "Monitor update";
	}
	const names = [...new Set(origin.updates.map((update) => update.name))];
	const lineCount = origin.updates.reduce(
		(total, update) => total + update.lines.length,
		0,
	);
	return `Monitor update from ${names.join(", ")} (${lineCount} line${
		lineCount === 1 ? "" : "s"
	})`;
}

export function toQueuedPromptItems(
	event: PendingPromptSnapshot,
): QueuedPromptItem[] {
	return event.prompts.map((entry, index) => ({
		id: entry.id || `${entry.delivery}:${index}:${entry.prompt}`,
		prompt: entry.prompt,
		steer: entry.delivery === "steer",
		attachmentCount: entry.attachmentCount,
		displayLabel: entry.origin ? monitorPromptLabel(entry.origin) : undefined,
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
