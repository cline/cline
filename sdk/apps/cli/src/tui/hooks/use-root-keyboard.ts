import { useKeyboard } from "@opentui/react";
import type { Dispatch, SetStateAction } from "react";
import { useRef } from "react";
import { useSession } from "../contexts/session-context";
import type { AppView } from "../types";
import type { AutocompleteOption, useAutocomplete } from "./use-autocomplete";
import type { useInputHistory } from "./use-input-history";

export function useRootKeyboard(input: {
	isDialogOpen: boolean;
	appView: AppView;
	autocomplete: ReturnType<typeof useAutocomplete>;
	inputHistory: ReturnType<typeof useInputHistory>;
	inputValueRef: { current: string };
	selectRef: { current: (option: AutocompleteOption) => void };
	submitRef: { current: (delivery?: "queue" | "steer") => void };
	syncInputFromTextarea: () => void;
	setInputKey: Dispatch<SetStateAction<number>>;
	setInputValue: Dispatch<SetStateAction<string>>;
	onAbort: () => boolean;
	onExit: () => void;
	onToggleMode: () => void;
	onClearConversation: () => Promise<void>;
	onRestoreCheckpoint: () => Promise<void>;
}) {
	const session = useSession();
	const lastEscapeRef = useRef(0);

	useKeyboard((key) => {
		if (session.isExitRequested) return;

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
			if (session.isRunning) {
				if (!session.abortRequested && input.onAbort()) {
					session.setAbortRequested(true);
				} else {
					input.onExit();
				}
			} else if (!input.isDialogOpen && input.inputValueRef.current) {
				input.setInputKey((k) => k + 1);
				input.setInputValue("");
			} else {
				input.onExit();
			}
			return;
		}

		if (input.isDialogOpen) return;
		if (input.appView === "onboarding") return;

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

		if (key.name === "up" && !session.isRunning) {
			if (
				input.inputHistory.navigateHistory("up", input.inputValueRef.current)
			) {
				key.preventDefault();
			}
			return;
		}
		if (key.name === "down" && !session.isRunning) {
			if (
				input.inputHistory.navigateHistory("down", input.inputValueRef.current)
			) {
				key.preventDefault();
			}
			return;
		}

		if (key.name === "escape") {
			if (session.isRunning) {
				if (!session.abortRequested && input.onAbort()) {
					session.setAbortRequested(true);
				}
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
			if (!session.isRunning && !input.inputValueRef.current) {
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
