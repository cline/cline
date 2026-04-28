import { useCallback, useRef, useState } from "react";
import {
	appendInputHistory,
	loadInputHistory,
	prependInputHistoryEntry,
} from "../../utils/input-history";
import type { TextareaHandle } from "../components/input-bar";

export function useInputHistory(
	textareaRef: React.MutableRefObject<TextareaHandle | null>,
) {
	const [history, setHistory] = useState<string[]>(() => loadInputHistory());
	const historyRef = useRef(history);
	const indexRef = useRef(-1);
	const savedInputRef = useRef("");
	const pendingHistoryTextRef = useRef<string | null>(null);
	historyRef.current = history;

	const navigateHistory = useCallback(
		(direction: "up" | "down", currentInput: string) => {
			const ta = textareaRef.current;
			const entries = historyRef.current;
			if (!ta || entries.length === 0) return false;

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
			ta.cursorOffset = text.length;
			return true;
		},
		[textareaRef],
	);

	const resetHistoryIndex = useCallback(() => {
		indexRef.current = -1;
	}, []);

	const recordHistoryEntry = useCallback(
		(prompt: string) => {
			appendInputHistory(prompt);
			setHistory((current) => prependInputHistoryEntry(current, prompt));
			resetHistoryIndex();
		},
		[resetHistoryIndex],
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
