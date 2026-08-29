import { useCallback, useRef, useState } from "react";
import type { TextareaHandle } from "../components/input-bar";
import type { InputHistoryStore } from "../types";

const MAX_HISTORY = 20;

/** Newest-first list with the new entry moved to the front, deduplicated. */
export function prependInputHistoryEntry(
	entries: string[],
	prompt: string,
): string[] {
	const trimmed = prompt.trim();
	if (!trimmed) {
		return entries;
	}
	const next = [trimmed, ...entries.filter((entry) => entry !== trimmed)];
	return next.slice(0, MAX_HISTORY);
}

type HistoryDirection = "up" | "down";
type HistoryNavigationAction = "navigate" | "move-to-boundary" | "ignore";

export interface HistoryNavigationPosition {
	direction: HistoryDirection;
	cursorOffset: number;
	textLength: number;
	visualRow: number;
	height: number;
	virtualLineCount: number;
}

export function getHistoryNavigationAction(
	position: HistoryNavigationPosition,
): HistoryNavigationAction {
	if (position.direction === "up") {
		if (position.cursorOffset <= 0) return "navigate";
		return position.visualRow === 0 ? "move-to-boundary" : "ignore";
	}

	if (position.cursorOffset >= position.textLength) return "navigate";

	const visibleLineCount = Math.max(
		1,
		Math.min(position.height, Math.max(1, position.virtualLineCount)),
	);
	const bottomVisualRow = visibleLineCount - 1;
	return position.visualRow >= bottomVisualRow ? "move-to-boundary" : "ignore";
}

export function useInputHistory(
	textareaRef: React.MutableRefObject<TextareaHandle | null>,
	store?: InputHistoryStore,
) {
	const [history, setHistory] = useState<string[]>(() => {
		try {
			return store?.load() ?? [];
		} catch {
			return [];
		}
	});
	const historyRef = useRef(history);
	const indexRef = useRef(-1);
	const savedInputRef = useRef("");
	const pendingHistoryTextRef = useRef<string | null>(null);
	historyRef.current = history;

	const navigateHistory = useCallback(
		(direction: HistoryDirection, currentInput: string) => {
			const ta = textareaRef.current;
			const entries = historyRef.current;
			if (!ta) return false;

			const action = getHistoryNavigationAction({
				direction,
				cursorOffset: ta.cursorOffset,
				textLength: ta.plainText.length,
				visualRow: ta.visualCursor.visualRow,
				height: ta.height,
				virtualLineCount: ta.virtualLineCount,
			});

			if (action === "ignore") return false;

			if (action === "move-to-boundary") {
				ta.cursorOffset = direction === "up" ? 0 : ta.plainText.length;
				return true;
			}

			if (entries.length === 0) return false;

			if (indexRef.current === -1) {
				if (direction === "down") return false;
				savedInputRef.current = currentInput;
			}

			if (direction === "up") {
				if (indexRef.current < entries.length - 1) {
					indexRef.current++;
				} else {
					return false;
				}
			} else {
				if (indexRef.current > -1) {
					indexRef.current--;
				} else {
					return false;
				}
			}

			const text =
				indexRef.current === -1
					? savedInputRef.current
					: (entries[indexRef.current] ?? "");

			pendingHistoryTextRef.current = text;
			ta.setText(text);
			ta.cursorOffset = direction === "up" ? 0 : text.length;
			return true;
		},
		[textareaRef],
	);

	const resetHistoryIndex = useCallback(() => {
		indexRef.current = -1;
	}, []);

	const recordHistoryEntry = useCallback(
		(prompt: string) => {
			try {
				store?.append(prompt);
			} catch {
				// Persisting history is best-effort.
			}
			setHistory((current) => prependInputHistoryEntry(current, prompt));
			resetHistoryIndex();
		},
		[resetHistoryIndex, store],
	);

	const shouldResetHistoryIndex = useCallback((text: string) => {
		if (pendingHistoryTextRef.current === text) {
			pendingHistoryTextRef.current = null;
			return false;
		}
		return true;
	}, []);

	return {
		navigateHistory,
		recordHistoryEntry,
		resetHistoryIndex,
		shouldResetHistoryIndex,
	};
}
