"use client";

import {
	type ComposerSuggestionItem,
	type PluginUiInput,
	SUGGESTION_BREAKPOINTS,
	type SuggestionsView,
} from "@cline/shared/browser";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	ComposerSuggestionsController,
	SuggestionComposer,
} from "@/hooks/use-composer-suggestions";
import {
	runSuggestionVerb,
	useSuggestionTrayKeys,
} from "@/hooks/use-suggestion-tray-keys";
import {
	type HeaderView,
	headerLabel,
	SuggestionTrayHeader,
} from "./suggestion-tray-header";
import { suggestionVerbAriaKeys } from "./suggestion-tray-keycaps";
import { SuggestionTrayLegend } from "./suggestion-tray-legend";
import { SuggestionTrayRows } from "./suggestion-tray-rows";
import type { SuggestionTrayDispatch } from "./suggestion-tray-shared";
import {
	SuggestionTrayCollapsed,
	SuggestionTrayLine,
	SuggestionTrayOff,
	SuggestionTraySkeleton,
	SuggestionTrayStale,
	SuggestionTrayUsed,
	SuggestionTrayWorking,
	SuggestionTrayYielded,
} from "./suggestion-tray-states";

export type SuggestionTrayProps = {
	suggestions: ComposerSuggestionsController;
	draft: string;
	setDraft: (value: string) => void;
	composerInputRef: RefObject<HTMLTextAreaElement | null>;
	/** The slash or @ menu is open over the message box; the tray steps aside. */
	composerMenuOpen: boolean;
};

/** The width a tray reads before it is measured, or while it is not laid out: full density. */
const UNMEASURED_WIDTH = SUGGESTION_BREAKPOINTS.desktop.narrowBelow;
/** How long a new set's entrance runs (suggestion-tray.css). */
const ENTRANCE_MS = 240;
const TRAY_LABEL = "Suggestions";
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

const suggestionCount = (count: number) =>
	`${count} ${count === 1 ? "suggestion" : "suggestions"}`;

function hasHeader(view: SuggestionsView): view is HeaderView {
	return (
		view.mode === "ready" ||
		view.mode === "loading" ||
		view.mode === "line" ||
		view.mode === "collapsed"
	);
}

function useTrayWidth(ref: RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState<number>(UNMEASURED_WIDTH);
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			const measured = entry?.contentRect.width ?? 0;
			setWidth(measured > 0 ? measured : UNMEASURED_WIDTH);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}

type TrayCover = {
	/** The pane is not `inert` under Settings or onboarding, and the window is visible. */
	onScreen: boolean;
	/** A dialog is open over the page. */
	dialogOpen: boolean;
};

/**
 * Watches what can cover the tray. Settings and onboarding mark the pane
 * `inert` and dialogs mount elsewhere in the page, and neither re-renders
 * the memoized composer, so the tray observes the document itself.
 */
function useTrayCover(ref: RefObject<HTMLElement | null>): TrayCover {
	const [cover, setCover] = useState<TrayCover>({
		onScreen: true,
		dialogOpen: false,
	});
	useEffect(() => {
		const measure = () => {
			const onScreen =
				document.visibilityState !== "hidden" &&
				ref.current?.closest("[inert]") == null;
			const dialogOpen = document.querySelector(DIALOG_SELECTOR) !== null;
			setCover((current) =>
				current.onScreen === onScreen && current.dialogOpen === dialogOpen
					? current
					: { onScreen, dialogOpen },
			);
		};
		measure();
		const observer = new MutationObserver(measure);
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["inert"],
		});
		document.addEventListener("visibilitychange", measure);
		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", measure);
		};
	}, [ref]);
	return cover;
}

/** The chords the message box answers to while the tray offers them, for `aria-keyshortcuts`. */
function composerKeyShortcuts(view: SuggestionsView): string | undefined {
	if (view.mode === "sent") {
		return view.canUndo ? suggestionVerbAriaKeys("undo") : undefined;
	}
	if (view.mode !== "ready" || !view.keysEnabled) return undefined;
	return [
		suggestionVerbAriaKeys("use"),
		suggestionVerbAriaKeys("send"),
		suggestionVerbAriaKeys("skip"),
		...(view.canRefresh ? [suggestionVerbAriaKeys("refresh")] : []),
		"ArrowUp",
		"ArrowDown",
	].join(" ");
}

/**
 * The composer.suggestions slot above the message box: a key row acting on
 * the highlighted suggestion, a 20 px header, the highlighted card and up to
 * two rows, tucked 10 px under the message box. Presentational: the view
 * comes from the shared view model through the controller, which owns the
 * data, the exposure clock and every verb; this component owns the DOM, the
 * keys and the announcements.
 */
export function SuggestionTray({
	suggestions,
	draft,
	setDraft,
	composerInputRef,
	composerMenuOpen,
}: SuggestionTrayProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const width = useTrayWidth(rootRef);
	const { onScreen, dialogOpen } = useTrayCover(rootRef);
	const view = suggestions.view({
		draft,
		width,
		menuOpen: composerMenuOpen,
		dialogOpen,
	});

	const suggestionsRef = useRef(suggestions);
	suggestionsRef.current = suggestions;
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const setDraftRef = useRef(setDraft);
	setDraftRef.current = setDraft;
	const factsRef = useRef({ width, menuOpen: composerMenuOpen, dialogOpen });
	factsRef.current = { width, menuOpen: composerMenuOpen, dialogOpen };
	const movedByKeyRef = useRef(false);

	const composer = useMemo<SuggestionComposer>(
		() => ({
			draft: () => draftRef.current,
			setDraft: (value) => {
				draftRef.current = value;
				setDraftRef.current(value);
			},
			focus: () => {
				const input = composerInputRef.current;
				if (!input) return;
				input.focus();
				setTimeout(() => {
					const end = input.value.length;
					input.setSelectionRange(end, end);
				}, 0);
			},
		}),
		[composerInputRef],
	);

	const viewAt = useCallback(
		(at: number) =>
			suggestionsRef.current.view(
				{ draft: draftRef.current, ...factsRef.current },
				at,
			),
		[],
	);

	const dispatch = useCallback<SuggestionTrayDispatch>(
		(verb, input) =>
			runSuggestionVerb(verb, viewAt(Date.now()), input, {
				controller: suggestionsRef.current,
				composer,
			}),
		[composer, viewAt],
	);

	const fillComposer = useCallback(
		(item: ComposerSuggestionItem, input: PluginUiInput) => {
			const current = viewAt(Date.now());
			if (current.mode !== "ready" || !current.keysEnabled) return;
			suggestionsRef.current.use(item, input, composer);
		},
		[composer, viewAt],
	);

	const clear = useCallback(() => {
		suggestionsRef.current.clear("pointer", composer);
	}, [composer]);

	const moveByKey = useCallback((delta: 1 | -1) => {
		movedByKeyRef.current = true;
		suggestionsRef.current.move(delta);
	}, []);

	useSuggestionTrayKeys({
		controller: suggestions,
		composer,
		composerInputRef,
		listRef,
		viewAt,
		move: moveByKey,
	});

	const { reportView, draftCleared } = suggestions;
	useEffect(() => {
		reportView(view, onScreen);
	});

	const usedSet = suggestions.local.used !== undefined;
	const hadDraftRef = useRef(draft.trim() !== "");
	useEffect(() => {
		const hasDraft = draft.trim() !== "";
		if (hadDraftRef.current && !hasDraft && usedSet) draftCleared();
		hadDraftRef.current = hasDraft;
	}, [draft, draftCleared, usedSet]);

	const keyShortcuts = composerKeyShortcuts(view);
	useEffect(() => {
		const input = composerInputRef.current;
		if (!input || !keyShortcuts) return;
		input.setAttribute("aria-keyshortcuts", keyShortcuts);
		return () => input.removeAttribute("aria-keyshortcuts");
	}, [composerInputRef, keyShortcuts]);

	const revision = suggestions.local.envelope?.state?.revision;
	const readyRevision = view.mode === "ready" ? revision : undefined;
	const [announcement, setAnnouncement] = useState("");
	const announcedRevisionRef = useRef<string | undefined>(undefined);
	const setAnnouncementText =
		view.mode === "ready"
			? `${suggestionCount(view.position.count)}${view.cue ? ` ${view.cue.text}` : ""}`
			: undefined;
	useEffect(() => {
		if (!readyRevision || !setAnnouncementText) return;
		if (announcedRevisionRef.current === readyRevision) return;
		announcedRevisionRef.current = readyRevision;
		setAnnouncement(setAnnouncementText);
	}, [readyRevision, setAnnouncementText]);

	const highlightedText =
		view.mode === "ready"
			? `${view.highlighted.label}: ${view.highlighted.prompt}, ${view.position.index + 1} of ${view.position.count}`
			: undefined;
	useEffect(() => {
		if (!movedByKeyRef.current || !highlightedText) return;
		movedByKeyRef.current = false;
		setAnnouncement(highlightedText);
	}, [highlightedText]);

	const [settledRevision, setSettledRevision] = useState<string>();
	const fresh =
		readyRevision !== undefined && readyRevision !== settledRevision;
	useEffect(() => {
		if (!fresh || !readyRevision) return;
		const timer = setTimeout(
			() => setSettledRevision(readyRevision),
			ENTRANCE_MS,
		);
		return () => clearTimeout(timer);
	}, [fresh, readyRevision]);

	const part = { suggestions, dispatch };
	let body: ReactNode;
	switch (view.mode) {
		case "hidden":
			body = null;
			break;
		case "ready":
			body = (
				<SuggestionTrayRows
					{...part}
					fillComposer={fillComposer}
					fresh={fresh}
					listRef={listRef}
					view={view}
				/>
			);
			break;
		case "loading":
			body = <SuggestionTraySkeleton rows={view.rows} />;
			break;
		case "line":
			body = <SuggestionTrayLine {...part} view={view} />;
			break;
		case "collapsed":
			body = <SuggestionTrayCollapsed {...part} view={view} />;
			break;
		case "working":
		case "sent":
			body = <SuggestionTrayWorking {...part} view={view} />;
			break;
		case "stale":
			body = <SuggestionTrayStale />;
			break;
		case "used":
			body = <SuggestionTrayUsed {...part} onClear={clear} view={view} />;
			break;
		case "yielded":
			body = <SuggestionTrayYielded {...part} view={view} />;
			break;
		case "off":
			body = <SuggestionTrayOff {...part} view={view} />;
			break;
	}

	return (
		<div
			className="@container flex flex-col"
			data-testid="suggestion-tray-root"
			ref={rootRef}
		>
			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>
			{view.mode === "hidden" ? null : (
				<section
					aria-label={hasHeader(view) ? headerLabel(view) : TRAY_LABEL}
					className="flex flex-col"
					data-testid="suggestion-tray"
				>
					{view.mode === "ready" || view.mode === "loading" ? (
						<SuggestionTrayLegend {...part} view={view} />
					) : null}
					<div
						className="mx-2 -mb-2.5 flex flex-col gap-0.5 rounded-t-xl border border-b-0 border-border bg-card px-1.5 pt-1 pb-3.5 text-xs"
						data-testid="suggestion-tray-card"
					>
						{hasHeader(view) ? (
							<SuggestionTrayHeader {...part} view={view} />
						) : null}
						{body}
					</div>
				</section>
			)}
		</div>
	);
}
