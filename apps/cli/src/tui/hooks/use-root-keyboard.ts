import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { Dispatch, SetStateAction } from "react";
import { useRef } from "react";
import type { TranscriptScrollHandle } from "../components/chat-message-list";
import { useSession } from "../contexts/session-context";
import type { AppView, QueuedPromptItem } from "../types";
import { shouldHandleInputHistory } from "./root-keyboard-routing";
import { matchTranscriptKeybind } from "./transcript-keybinds";
import type { AutocompleteOption, useAutocomplete } from "./use-autocomplete";
import type { useInputHistory } from "./use-input-history";
import { resolveQueuedPromptSelection } from "./use-queued-prompts";

type TranscriptKey = {
	name: string;
	ctrl: boolean;
	meta: boolean;
	shift: boolean;
	preventDefault: () => void;
};

export function handleTranscriptKeybind(
	key: TranscriptKey,
	transcriptScroll: TranscriptScrollHandle | null | undefined,
): boolean {
	const command = matchTranscriptKeybind(key);
	if (!command || !transcriptScroll) return false;

	key.preventDefault();
	transcriptScroll.runTranscriptCommand(command);
	return true;
}

export function useRootKeyboard(input: {
	isDialogOpen: boolean;
	appView: AppView;
	autocomplete: ReturnType<typeof useAutocomplete>;
	inputHistory: ReturnType<typeof useInputHistory>;
	transcriptScrollRef: { current: TranscriptScrollHandle | null };
	inputValueRef: { current: string };
	selectRef: { current: (option: AutocompleteOption) => void };
	submitRef: { current: (delivery?: "queue" | "steer") => void };
	queuedPromptSelection: {
		items: QueuedPromptItem[];
		selectedId: string | null;
		editingId: string | null;
		select: (id: string | null) => void;
		beginEdit: (id: string) => void;
		cancelEdit: () => void;
		promote: (id: string) => void;
	};
	syncInputFromTextarea: () => void;
	getCurrentInputText: () => string;
	setInputKey: Dispatch<SetStateAction<number>>;
	setInputValue: Dispatch<SetStateAction<string>>;
	onAbort: () => boolean;
	onExit: () => void;
	onToggleMode: () => void;
	onClearConversation: () => Promise<void>;
	onRestoreCheckpoint: () => Promise<void>;
	onOpenCommandPalette: () => Promise<void>;
	onCommandPaletteShortcut: (key: KeyEvent) => boolean;
}) {
	const session = useSession();
	const lastEscapeRef = useRef(0);

	useKeyboard((key) => {
		if (session.isExitRequested) return;

		const hasInputText = input.getCurrentInputText().trim().length > 0;

		const mayEditTextarea =
			!key.ctrl &&
			!key.meta &&
			(key.name.length === 1 ||
				key.name === "backspace" ||
				key.name === "delete" ||
				key.name === "space");
		if (
			!input.isDialogOpen &&
			input.appView !== "onboarding" &&
			mayEditTextarea
		) {
			input.syncInputFromTextarea();
		}

		if (key.ctrl && key.name === "c") {
			if (!input.isDialogOpen && hasInputText) {
				input.setInputKey((k) => k + 1);
				input.setInputValue("");
			} else {
				input.onExit();
			}
			return;
		}

		if (input.isDialogOpen) return;
		if (input.appView === "onboarding") return;

		if (handleTranscriptKeybind(key, input.transcriptScrollRef.current)) {
			if (input.autocomplete.mode) {
				input.autocomplete.close();
			}
			return;
		}

		if (input.autocomplete.mode) {
			const opts = input.autocomplete.getFilteredOptions();
			if (key.name === "escape") {
				input.autocomplete.close();
				return;
			}
			if (key.name === "up" || (key.ctrl && key.name === "p")) {
				let next =
					input.autocomplete.selected <= 0
						? opts.length - 1
						: input.autocomplete.selected - 1;
				if (opts[next]?.isHeader) next = next <= 0 ? opts.length - 1 : next - 1;
				input.autocomplete.setSelected(next);
				return;
			}
			if (key.name === "down" || (key.ctrl && key.name === "n")) {
				let next =
					input.autocomplete.selected >= opts.length - 1
						? 0
						: input.autocomplete.selected + 1;
				if (opts[next]?.isHeader) next = next >= opts.length - 1 ? 0 : next + 1;
				input.autocomplete.setSelected(next);
				return;
			}
			if (key.name === "tab" && opts.length > 0) {
				const selectedOption =
					opts[Math.min(input.autocomplete.selected, opts.length - 1)] ??
					opts[0];
				if (!selectedOption?.isHeader) {
					input.selectRef.current(selectedOption);
				}
				return;
			}
			return;
		}

		if (!session.isRunning && input.onCommandPaletteShortcut(key)) {
			return;
		}

		if (key.ctrl && key.name === "p" && !session.isRunning) {
			void input.onOpenCommandPalette();
			return;
		}

		const queuedSelection = input.queuedPromptSelection;
		const hasQueuedPrompts = queuedSelection.items.length > 0;
		const selectedQueuedPromptId = queuedSelection.selectedId;
		const canHandleInputHistory = shouldHandleInputHistory({
			isRunning: session.isRunning,
			hasQueuedPrompts,
		});

		if (queuedSelection.editingId && key.name !== "escape") {
			return;
		}

		if (hasQueuedPrompts && key.name === "up") {
			key.preventDefault();
			if (input.autocomplete.mode) {
				input.autocomplete.close();
			}
			queuedSelection.select(
				resolveQueuedPromptSelection({
					items: queuedSelection.items,
					selectedId: selectedQueuedPromptId,
					direction: "up",
				}),
			);
			return;
		}

		if (hasQueuedPrompts && selectedQueuedPromptId && key.name === "down") {
			key.preventDefault();
			queuedSelection.select(
				resolveQueuedPromptSelection({
					items: queuedSelection.items,
					selectedId: selectedQueuedPromptId,
					direction: "down",
				}),
			);
			return;
		}

		if (
			selectedQueuedPromptId &&
			!queuedSelection.editingId &&
			key.name === "tab" &&
			!key.shift
		) {
			key.preventDefault();
			queuedSelection.beginEdit(selectedQueuedPromptId);
			return;
		}

		if (
			selectedQueuedPromptId &&
			!queuedSelection.editingId &&
			(key.name === "enter" || key.name === "return")
		) {
			key.preventDefault();
			queuedSelection.promote(selectedQueuedPromptId);
			return;
		}

		if (key.name === "up" && canHandleInputHistory) {
			if (
				input.inputHistory.navigateHistory("up", input.inputValueRef.current)
			) {
				key.preventDefault();
			}
			return;
		}
		if (key.name === "down" && canHandleInputHistory) {
			if (
				input.inputHistory.navigateHistory("down", input.inputValueRef.current)
			) {
				key.preventDefault();
			}
			return;
		}

		if (key.name === "escape") {
			if (queuedSelection.editingId) {
				key.preventDefault();
				queuedSelection.cancelEdit();
			} else if (session.isRunning) {
				const abortStarted = input.onAbort();
				if (abortStarted) {
					session.setAbortRequested(true);
				}
			} else if (selectedQueuedPromptId) {
				queuedSelection.select(null);
				input.setInputKey((k) => k + 1);
			} else {
				const now = Date.now();
				if (now - lastEscapeRef.current < 300) {
					lastEscapeRef.current = 0;
					void input.onRestoreCheckpoint();
				} else {
					lastEscapeRef.current = now;
				}
			}
			return;
		}

		if (key.ctrl && key.name === "d") {
			if (!session.isRunning && !hasInputText) {
				input.onExit();
			}
			return;
		}

		if (key.name === "tab" && !key.shift) {
			input.onToggleMode();
			return;
		}

		if (key.shift && key.name === "tab") {
			session.toggleAutoApprove();
			return;
		}

		if (key.ctrl && key.name === "l") {
			if (session.isRunning) {
				session.clearEntries();
				return;
			}
			void input.onClearConversation();
			return;
		}

		if (key.ctrl && key.name === "s") {
			if (session.isRunning && input.inputValueRef.current.trim()) {
				input.submitRef.current("steer");
			}
			return;
		}
	});
}
