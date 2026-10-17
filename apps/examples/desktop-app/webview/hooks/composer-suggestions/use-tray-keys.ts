"use client";

import type { PluginUiInput, SuggestionsView } from "@cline/shared/browser";
import { type RefObject, useEffect, useRef } from "react";
import {
	isMacPlatform,
	type SuggestionVerb,
	suggestionDigitVerb,
} from "@/components/views/chat/suggestion-tray/keycaps";
import type {
	ComposerSuggestionsController,
	SuggestionComposer,
} from "./types";

export type SuggestionTrayKeysOptions = {
	controller: ComposerSuggestionsController;
	composer: SuggestionComposer;
	composerInputRef: RefObject<HTMLTextAreaElement | null>;
	listRef: RefObject<HTMLElement | null>;
	/** The view as of `now`, from the composer's facts at the moment of the key. */
	viewAt: (now: number) => SuggestionsView;
	/** Moves the highlight; the tray announces a move made by key. */
	move: (delta: 1 | -1) => void;
};

const OPEN_OVERLAY_SELECTOR =
	'[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]';

/**
 * A pane under Settings (or onboarding) is `inert`, and an open dialog or
 * menu owns the keyboard; the tray's keys stand down for both.
 */
function keysAvailable(composerInput: HTMLTextAreaElement): boolean {
	return (
		composerInput.closest("[inert]") === null &&
		composerInput.getAttribute("aria-expanded") !== "true" &&
		document.querySelector(OPEN_OVERLAY_SELECTOR) === null
	);
}

function isOtherTextField(
	target: EventTarget | null,
	composerInput: HTMLTextAreaElement,
	list: HTMLElement | null,
): boolean {
	return (
		target instanceof HTMLElement &&
		target !== composerInput &&
		list?.contains(target) !== true &&
		(target.isContentEditable ||
			target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA")
	);
}

/**
 * Runs a verb on the highlighted suggestion exactly as its key does. False
 * when the verb is not the tray's to take now, so a key stays the page's.
 */
export function runSuggestionVerb(
	verb: SuggestionVerb,
	view: SuggestionsView,
	input: PluginUiInput,
	{
		controller,
		composer,
	}: Pick<SuggestionTrayKeysOptions, "controller" | "composer">,
): boolean {
	if (verb === "undo") {
		if (view.mode !== "sent" || !view.canUndo) return false;
		void controller.undoSent(composer);
		return true;
	}
	if (view.mode !== "ready" || !view.keysEnabled) return false;
	switch (verb) {
		case "use":
			controller.use(view.highlighted, input, composer);
			return true;
		case "send":
			void controller.send(view, input);
			return true;
		case "skip":
			controller.skip(view, view.highlighted, input);
			return true;
		case "refresh":
			if (!view.canRefresh) return false;
			controller.refresh(input);
			return true;
	}
}

/**
 * The suggestion tray's keys: ⌘1 Use, ⇧⌘1 Send, ⌘2 Skip, ⌥⌘2 New
 * set and ⌘3 Undo from anywhere but another text field; ↑ ↓ to move from the
 * empty composer or the list; Enter and ⇧Enter on the list; Esc clears an
 * unchanged used suggestion, or hides the list for this turn. A capture-phase
 * window listener, so the composer's own Esc and arrow handling never sees a
 * key the tray took.
 */
export function useSuggestionTrayKeys(
	options: SuggestionTrayKeysOptions,
): void {
	const latest = useRef(options);
	latest.current = options;

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.repeat || event.isComposing || event.keyCode === 229) return;
			const current = latest.current;
			const composerInput = current.composerInputRef.current;
			const list = current.listRef.current;
			if (!composerInput || !keysAvailable(composerInput)) return;
			const target = event.target;
			if (isOtherTextField(target, composerInput, list)) return;
			const inComposer = target === composerInput;
			const inList = target instanceof Node && list?.contains(target) === true;
			const modifier = isMacPlatform() ? event.metaKey : event.ctrlKey;
			const other = isMacPlatform() ? event.ctrlKey : event.metaKey;
			if (modifier && !other) {
				const verb = suggestionDigitVerb(
					event.code,
					event.shiftKey,
					event.altKey,
				);
				if (
					verb &&
					runSuggestionVerb(verb, current.viewAt(Date.now()), "key", current)
				) {
					event.preventDefault();
					event.stopPropagation();
				}
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (!inComposer && !inList) return;
			const view = current.viewAt(Date.now());
			if (
				(event.key === "ArrowUp" || event.key === "ArrowDown") &&
				!event.shiftKey
			) {
				if (view.mode !== "ready" || !view.keysEnabled) return;
				current.move(event.key === "ArrowUp" ? -1 : 1);
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			if (event.key === "Enter" && target === list) {
				const verb = event.shiftKey ? "send" : "use";
				if (!runSuggestionVerb(verb, view, "key", current)) return;
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			if (event.key !== "Escape") return;
			if (inList && view.mode === "ready") {
				current.controller.collapse("key");
				current.composer.focus();
			} else if (
				inComposer &&
				view.mode === "used" &&
				!view.edited &&
				!current.controller.busy
			) {
				current.controller.clear("key", current.composer);
			} else {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		}
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, []);
}
