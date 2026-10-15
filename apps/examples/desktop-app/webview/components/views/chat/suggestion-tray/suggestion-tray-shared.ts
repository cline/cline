import type { PluginUiInput, SuggestionsView } from "@cline/shared/browser";
import type { ComposerSuggestionsController } from "@/hooks/use-composer-suggestions";
import type { SuggestionVerb } from "./suggestion-tray-keycaps";

/**
 * Runs a verb on the highlighted suggestion exactly as its key does: the same
 * guards, the view re-derived at the moment of the press. False when the verb
 * is not the tray's to take now. Stable across renders.
 */
export type SuggestionTrayDispatch = (
	verb: SuggestionVerb,
	input: PluginUiInput,
) => boolean;

/** The props every tray part receives: it reads the view and acts only through `dispatch` or the controller. */
export type SuggestionTrayPartProps<
	V extends SuggestionsView = SuggestionsView,
> = {
	suggestions: ComposerSuggestionsController;
	dispatch: SuggestionTrayDispatch;
	view: V;
};

export type ReadySuggestionsView = Extract<SuggestionsView, { mode: "ready" }>;

/** The listbox options' id prefix; the option for item `id` is `${OPTION_ID_PREFIX}${id}`. */
export const OPTION_ID_PREFIX = "suggestion-tray-option-";

/** New set's words, on the header's ↻ and the More menu; the key row's button reads New set. */
export const REFRESH_LABEL = "Suggest different ones";

/** A 28 px row on the tray's grid: the 32 px tile column, then the text. */
export const ROW_GRID =
	"grid h-7 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-2 pr-2 pl-[7px]";

/** The same row with a trailing control: a source link, Clear, Undo or Show. */
export const ROW_GRID_WITH_END =
	"grid h-7 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 pr-2 pl-[7px]";

/** A row's trailing text button: 20 px, 12 px at normal weight, muted until hovered. */
export const TEXT_BUTTON_CLASSES =
	"h-5 px-1.5 font-normal text-muted-foreground";
