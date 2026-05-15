import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { shouldShowCliUsageCost } from "../../utils/usage-cost-display";
import type { SlashCommandRegistry } from "../commands/slash-command-registry";
import {
	expandUserCommandPrompt,
	resolveSlashCommand,
} from "../commands/slash-command-registry";
import type { TextareaHandle } from "../components/input-bar";
import { useSession } from "../contexts/session-context";
import type { AppView, TuiProps } from "../types";
import {
	createUniquePastedTextSnippetMarker,
	expandPastedTextSnippets,
	type PastedTextSnippet,
} from "../utils/pasted-snippets";
import {
	insertSelectedSkillCommand,
	type LocalSlashCommandInvocation,
	removeLocalSlashCommandInvocation,
} from "../utils/skill-command-input";
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
	handleSlashCommand: (
		command: string,
		invocation?: LocalSlashCommandInvocation,
	) => boolean | Promise<boolean>;
	onSubmit: TuiProps["onSubmit"];
	initialPrompt?: string;
	providerId: string;
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
		providerId,
		configVerbose,
		refreshRepoStatus,
		setAppView,
		turnErrorReportedRef,
	} = input;
	const session = useSession();
	const [inputKey, setInputKey] = useState(0);
	const [inputValue, setInputValue] = useState(initialPrompt ?? "");
	const [pendingCursorOffset, setPendingCursorOffset] = useState<number | null>(
		null,
	);
	const textareaRef = useRef<TextareaHandle | null>(null);
	const inputValueRef = useRef("");
	const pastedImagesRef = useRef<PastedImage[]>([]);
	const pastedTextSnippetsRef = useRef<PastedTextSnippet[]>([]);
	const localCommandInFlightRef = useRef(false);
	inputValueRef.current = inputValue;

	const inputHistory = useInputHistory(textareaRef);

	const focusTextarea = useCallback(() => {
		textareaRef.current?.focus();
	}, []);

	const refocusTextarea = useCallback(() => {
		setInputKey((k) => k + 1);
	}, []);

	useLayoutEffect(() => {
		if (pendingCursorOffset === null) return;
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.cursorOffset = pendingCursorOffset;
		textarea.focus();
		setPendingCursorOffset(null);
	}, [pendingCursorOffset]);

	const populateInput = useCallback((value: string) => {
		inputValueRef.current = value;
		setInputValue(value);
		setInputKey((k) => k + 1);
		setPendingCursorOffset(value.length);
	}, []);

	const applyInputText = useCallback((value: string, cursorOffset: number) => {
		inputValueRef.current = value;
		setInputValue(value);
		setInputKey((k) => k + 1);
		setPendingCursorOffset(cursorOffset);
	}, []);

	const insertSkillCommand = useCallback(
		(commandName: string, invocation?: LocalSlashCommandInvocation) => {
			const text =
				invocation?.text ??
				textareaRef.current?.plainText ??
				inputValueRef.current;
			const cursorOffset =
				invocation?.cursorOffset ??
				textareaRef.current?.cursorOffset ??
				text.length;
			const next = insertSelectedSkillCommand({
				text,
				cursorOffset,
				commandName,
				replaceRange: invocation?.replaceRange,
			});
			applyInputText(next.text, next.cursorOffset);
		},
		[applyInputText],
	);

	const removeLocalCommandInvocation = useCallback(
		(invocation: LocalSlashCommandInvocation) => {
			const next = removeLocalSlashCommandInvocation(invocation);
			applyInputText(next.text, next.cursorOffset);
		},
		[applyInputText],
	);

	const clearPastedImages = useCallback(() => {
		pastedImagesRef.current = [];
	}, []);

	const clearPastedTextSnippets = useCallback(() => {
		pastedTextSnippetsRef.current = [];
	}, []);

	const clearPasteAttachments = useCallback(() => {
		clearPastedImages();
		clearPastedTextSnippets();
	}, [clearPastedImages, clearPastedTextSnippets]);

	const handleImagePaste = useCallback((dataUrl: string) => {
		const marker = `[Image ${pastedImagesRef.current.length + 1}]`;
		pastedImagesRef.current = [...pastedImagesRef.current, { marker, dataUrl }];
		return marker;
	}, []);

	const handleLargeTextPaste = useCallback((text: string) => {
		const marker = createUniquePastedTextSnippetMarker(
			text,
			pastedTextSnippetsRef.current.map((snippet) => snippet.marker),
		);
		pastedTextSnippetsRef.current = [
			...pastedTextSnippetsRef.current,
			{ marker, text },
		];
		return marker;
	}, []);

	const prunePastedTextSnippets = useCallback((text: string) => {
		pastedTextSnippetsRef.current = pastedTextSnippetsRef.current.filter(
			(snippet) => text.includes(snippet.marker),
		);
	}, []);

	const runSlashCommand = useCallback(
		async (
			cmd: string,
			invocation?: LocalSlashCommandInvocation,
		): Promise<boolean> => {
			if (localCommandInFlightRef.current) return false;
			localCommandInFlightRef.current = true;
			try {
				return await Promise.resolve(handleSlashCommand(cmd, invocation));
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
				clearPasteAttachments();
				option.onSelect();
				return;
			}

			if (autocomplete.mode === "/") {
				const cmd = option.commandName ?? option.display.slice(1);
				const text = inputValueRef.current;
				const offset = ta.cursorOffset;
				const before = text.slice(0, offset);
				const slash = extractSlashQuery(before);
				if (option.commandExecution === "local") {
					const invocation: LocalSlashCommandInvocation = {
						text,
						cursorOffset: offset,
						replaceRange: slash.inSlashMode
							? { start: slash.slashIndex, end: offset }
							: undefined,
					};
					if (!option.commandPreserveInput) {
						ta.setText("");
						ta.cursorOffset = 0;
						setInputValue("");
						clearPasteAttachments();
					}
					if (await runSlashCommand(cmd, invocation)) {
						autocomplete.close();
						return;
					}
				}
				if (slash.inSlashMode) {
					const newText =
						text.slice(0, slash.slashIndex) + option.value + text.slice(offset);
					ta.setText(newText);
					if (option.commandExecution === "user-command") {
						ta.extmarks.create({
							start: slash.slashIndex,
							end: slash.slashIndex + option.value.trimEnd().length,
							virtual: true,
						});
					}
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
		[autocomplete, clearPasteAttachments, runSlashCommand],
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
				const command = resolveSlashCommand(slashCommandRegistry, cmd);
				let invocation: LocalSlashCommandInvocation | undefined;
				if (command?.execution === "local") {
					const text = inputValueRef.current;
					const commandToken = parts[0] ?? "";
					const tokenStart = text.length - text.trimStart().length;
					const tokenEnd = tokenStart + commandToken.length;
					invocation = {
						text,
						cursorOffset: textareaRef.current?.cursorOffset ?? tokenEnd,
						replaceRange:
							text.slice(tokenStart, tokenEnd) === commandToken
								? { start: tokenStart, end: tokenEnd }
								: undefined,
					};
					if (!command.preserveInput) {
						setInputKey((k) => k + 1);
						setInputValue("");
						clearPasteAttachments();
					}
				}
				if (await runSlashCommand(cmd, invocation)) {
					return;
				}
			}

			const activePastedTextSnippets = pastedTextSnippetsRef.current.filter(
				(snippet) => prompt.includes(snippet.marker),
			);
			const expandedPrompt = expandPastedTextSnippets(
				prompt,
				activePastedTextSnippets,
			);
			const activeUserImages = pastedImagesRef.current
				.filter((image) => prompt.includes(image.marker))
				.map((image) => image.dataUrl);
			const promptForSubmit = expandUserCommandPrompt(
				expandedPrompt,
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
					text: prompt,
				});
			}
			setInputKey((k) => k + 1);
			setInputValue("");
			clearPasteAttachments();
			if (!delivery) {
				inputHistory.recordHistoryEntry(prompt);
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
				if (typeof result.currentContextSize === "number") {
					session.setLastTotalTokens(result.currentContextSize);
				}
				if (typeof result.usage.totalCost === "number") {
					session.setLastTotalCost(result.usage.totalCost);
				}
				if (!result.commandOutput && configVerbose) {
					const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
					const showUsageCost = shouldShowCliUsageCost(providerId);
					session.appendEntry({
						kind: "done",
						tokens: result.currentContextSize ?? session.lastTotalTokens,
						cost:
							showUsageCost && typeof result.usage.totalCost === "number"
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
			clearPasteAttachments,
			configVerbose,
			inputHistory,
			onSubmit,
			providerId,
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
				clearPasteAttachments();
			} else {
				prunePastedTextSnippets(text);
			}
			autocomplete.updateAutocomplete(text);
			if (inputHistory.shouldResetHistoryIndex(text)) {
				inputHistory.resetHistoryIndex();
			}
		},
		[
			autocomplete,
			clearPasteAttachments,
			inputHistory,
			prunePastedTextSnippets,
		],
	);

	const syncInputFromTextarea = useCallback(() => {
		queueMicrotask(() => {
			const text = textareaRef.current?.plainText ?? "";
			if (text === inputValueRef.current) return;
			setInputValue(text);
			if (!text.trim()) {
				clearPasteAttachments();
			} else {
				prunePastedTextSnippets(text);
			}
			autocomplete.updateAutocomplete(text);
			if (inputHistory.shouldResetHistoryIndex(text)) {
				inputHistory.resetHistoryIndex();
			}
		});
	}, [
		autocomplete,
		clearPasteAttachments,
		inputHistory,
		prunePastedTextSnippets,
	]);

	const getCurrentInputText = useCallback(() => {
		return textareaRef.current?.plainText ?? inputValueRef.current;
	}, []);

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
		populateInput,
		insertSkillCommand,
		removeLocalCommandInvocation,
		focusTextarea,
		refocusTextarea,
		submitInitialPrompt,
		selectAutocompleteOption,
		handleImagePaste,
		handleLargeTextPaste,
		handleSubmit,
		handleContentChange,
		syncInputFromTextarea,
		getCurrentInputText,
	};
}
