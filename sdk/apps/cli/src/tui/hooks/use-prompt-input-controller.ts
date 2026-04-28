import { useCallback, useRef, useState } from "react";
import type { SlashCommandRegistry } from "../commands/slash-command-registry";
import { expandUserCommandPrompt } from "../commands/slash-command-registry";
import type { TextareaHandle } from "../components/input-bar";
import { useSession } from "../contexts/session-context";
import type { AppView, TuiProps } from "../types";
import type { AutocompleteOption, useAutocomplete } from "./use-autocomplete";
import { extractSlashQuery } from "./use-autocomplete";
import { useInputHistory } from "./use-input-history";

interface PastedImage {
	marker: string;
	dataUrl: string;
}

export function usePromptInputController(input: {
	autocomplete: ReturnType<typeof useAutocomplete>;
	slashCommandRegistry: SlashCommandRegistry;
	handleSlashCommand: (command: string) => boolean | Promise<boolean>;
	onSubmit: TuiProps["onSubmit"];
	initialPrompt?: string;
	configVerbose: boolean;
	refreshRepoStatus: () => void;
	setAppView: (view: AppView) => void;
	turnErrorReportedRef: { current: boolean };
}) {
	const {
		autocomplete,
		slashCommandRegistry,
		handleSlashCommand,
		onSubmit,
		initialPrompt,
		configVerbose,
		refreshRepoStatus,
		setAppView,
		turnErrorReportedRef,
	} = input;
	const session = useSession();
	const [inputKey, setInputKey] = useState(0);
	const [inputValue, setInputValue] = useState(initialPrompt ?? "");
	const textareaRef = useRef<TextareaHandle | null>(null);
	const inputValueRef = useRef("");
	const pastedImagesRef = useRef<PastedImage[]>([]);
	const localCommandInFlightRef = useRef(false);
	inputValueRef.current = inputValue;

	const inputHistory = useInputHistory(textareaRef);

	const refocusTextarea = useCallback(() => {
		setInputKey((k) => k + 1);
	}, []);

	const clearPastedImages = useCallback(() => {
		pastedImagesRef.current = [];
	}, []);

	const handleImagePaste = useCallback((dataUrl: string) => {
		const marker = `[Image ${pastedImagesRef.current.length + 1}]`;
		pastedImagesRef.current = [...pastedImagesRef.current, { marker, dataUrl }];
		return marker;
	}, []);

	const runSlashCommand = useCallback(
		async (cmd: string): Promise<boolean> => {
			if (localCommandInFlightRef.current) return false;
			localCommandInFlightRef.current = true;
			try {
				return await Promise.resolve(handleSlashCommand(cmd));
			} finally {
				localCommandInFlightRef.current = false;
			}
		},
		[handleSlashCommand],
	);

	const selectAutocompleteOption = useCallback(
		async (option: AutocompleteOption) => {
			const ta = textareaRef.current;
			if (!ta) return;

			if (option.onSelect) {
				ta.setText("");
				ta.cursorOffset = 0;
				autocomplete.close();
				setInputValue("");
				clearPastedImages();
				option.onSelect();
				return;
			}

			if (autocomplete.mode === "/") {
				const cmd = option.commandName ?? option.display.slice(1);
				if (await runSlashCommand(cmd)) {
					ta.setText("");
					ta.cursorOffset = 0;
					autocomplete.close();
					setInputValue("");
					clearPastedImages();
					return;
				}
				const text = inputValueRef.current;
				const offset = ta.cursorOffset;
				const before = text.slice(0, offset);
				const slash = extractSlashQuery(before);
				if (slash.inSlashMode) {
					const newText =
						text.slice(0, slash.slashIndex) + option.value + text.slice(offset);
					ta.setText(newText);
					ta.cursorOffset = slash.slashIndex + option.value.length;
				}
			} else if (autocomplete.mode === "@") {
				const text = inputValueRef.current;
				const offset = ta.cursorOffset;
				const before = text.slice(0, offset);
				const atIdx = before.lastIndexOf("@");
				if (atIdx >= 0) {
					const newText =
						text.slice(0, atIdx) + option.value + text.slice(offset);
					ta.setText(newText);
					ta.cursorOffset = atIdx + option.value.length;
				}
			}
			autocomplete.close();
			setInputValue(ta.plainText);
		},
		[autocomplete, clearPastedImages, runSlashCommand],
	);

	const selectRef = useRef(selectAutocompleteOption);
	selectRef.current = selectAutocompleteOption;

	const submitPrompt = useCallback(
		async (delivery?: "queue" | "steer") => {
			if (localCommandInFlightRef.current) return;

			const prompt = inputValueRef.current.trim();
			if (!prompt) return;

			if (!delivery && prompt.startsWith("/")) {
				const parts = prompt.split(/\s+/);
				const cmd = (parts[0] ?? "").slice(1);
				if (await runSlashCommand(cmd)) {
					setInputKey((k) => k + 1);
					setInputValue("");
					clearPastedImages();
					return;
				}
			}

			const activeUserImages = pastedImagesRef.current
				.filter((image) => prompt.includes(image.marker))
				.map((image) => image.dataUrl);
			const promptForSubmit = expandUserCommandPrompt(
				prompt,
				slashCommandRegistry,
			);

			session.setHasSubmitted(true);
			setAppView("chat");
			if (!delivery) {
				session.setIsRunning(true);
				session.setIsStreaming(true);
				session.setAbortRequested(false);
				turnErrorReportedRef.current = false;
				session.appendEntry({
					kind: "user_submitted",
					text: promptForSubmit,
				});
			}
			setInputKey((k) => k + 1);
			setInputValue("");
			clearPastedImages();
			if (!delivery) {
				inputHistory.recordHistoryEntry(promptForSubmit);
			}

			const startedAt = performance.now();
			try {
				const result = await onSubmit(
					promptForSubmit,
					session.uiMode,
					delivery,
					activeUserImages.length > 0
						? { userImages: activeUserImages }
						: undefined,
				);
				if (result.commandOutput) {
					session.appendEntry({
						kind: "status",
						text: result.commandOutput,
					});
				}
				if (result.queued) return;
				const tokens = result.usage.inputTokens + result.usage.outputTokens;
				session.setLastTotalTokens(tokens);
				if (typeof result.usage.totalCost === "number") {
					session.setLastTotalCost(result.usage.totalCost);
				}
				if (!result.commandOutput && configVerbose) {
					const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
					session.appendEntry({
						kind: "done",
						tokens,
						cost:
							typeof result.usage.totalCost === "number"
								? result.usage.totalCost
								: 0,
						elapsed,
						iterations: result.iterations,
					});
				}
			} catch (error) {
				if (!turnErrorReportedRef.current) {
					session.appendEntry({
						kind: "error",
						text: error instanceof Error ? error.message : String(error),
					});
				}
			} finally {
				if (!delivery) {
					session.closeInlineStream();
					session.setIsRunning(false);
					session.setIsStreaming(false);
					refreshRepoStatus();
				}
			}
		},
		[
			clearPastedImages,
			configVerbose,
			inputHistory,
			onSubmit,
			refreshRepoStatus,
			runSlashCommand,
			session,
			setAppView,
			slashCommandRegistry,
			turnErrorReportedRef,
		],
	);

	const submitRef = useRef(submitPrompt);
	submitRef.current = submitPrompt;

	const submitInitialPrompt = useCallback(() => {
		const prompt = initialPrompt?.trim();
		if (!prompt) return;
		inputValueRef.current = prompt;
		setInputValue(prompt);
		submitRef.current();
	}, [initialPrompt]);

	const handleSubmit = useCallback(() => {
		if (autocomplete.mode) {
			const opts = autocomplete.getFilteredOptions();
			if (opts.length > 0) {
				selectRef.current(
					opts[Math.min(autocomplete.selected, opts.length - 1)] ?? opts[0],
				);
				return;
			}
		}
		submitRef.current(session.isRunning ? "queue" : undefined);
	}, [autocomplete, session.isRunning]);

	const handleContentChange = useCallback(
		(text: string) => {
			setInputValue(text);
			if (!text.trim()) {
				clearPastedImages();
			}
			autocomplete.updateAutocomplete(text);
			if (inputHistory.shouldResetHistoryIndex(text)) {
				inputHistory.resetHistoryIndex();
			}
		},
		[autocomplete, clearPastedImages, inputHistory],
	);

	const syncInputFromTextarea = useCallback(() => {
		queueMicrotask(() => {
			const text = textareaRef.current?.plainText ?? "";
			if (text === inputValueRef.current) return;
			setInputValue(text);
			autocomplete.updateAutocomplete(text);
			if (inputHistory.shouldResetHistoryIndex(text)) {
				inputHistory.resetHistoryIndex();
			}
		});
	}, [autocomplete, inputHistory]);

	return {
		inputKey,
		inputValue,
		inputValueRef,
		textareaRef,
		inputHistory,
		selectRef,
		submitRef,
		setInputKey,
		setInputValue,
		refocusTextarea,
		submitInitialPrompt,
		selectAutocompleteOption,
		handleImagePaste,
		handleSubmit,
		handleContentChange,
		syncInputFromTextarea,
	};
}
