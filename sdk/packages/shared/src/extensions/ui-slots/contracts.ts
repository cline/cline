import type {
	PluginUiIcon,
	PluginUiInput,
	PluginUiSlot,
	PluginUiSurface,
	PluginUiTone,
} from "./constants";

// ── composer.suggestions state ─────────────────────────────────────────────

export interface ComposerSuggestionItem {
	/** Stable within a revision; echoed by item verbs. PLUGIN_UI_TOKEN. */
	id: string;
	/** The word, e.g. "Fix". Always shown. */
	label: string;
	tone: PluginUiTone;
	icon?: PluginUiIcon;
	/** What Use writes into the box and Send submits. May contain "\n"; never starts with "/". */
	prompt: string;
	/** The why line. Single line. */
	detail?: string;
	/** Plain label; `url` is http(s) only and opened by the host's own safe opener. */
	source?: { label: string; url?: string };
	/** false = Use only. Hosts hide Send and the plugin refuses a `send`. */
	sendable: boolean;
}

export type ComposerSuggestionsStatus =
	| "loading"
	| "ready"
	| "empty"
	| "exhausted"
	| "unavailable"
	| "hidden";

export type ComposerSuggestionsHiddenReason =
	| "superseded"
	| "user"
	| "disabled";

export interface ComposerSuggestionsState {
	status: ComposerSuggestionsStatus;
	/** Header word, e.g. "Next". */
	title: string;
	/** CLI host-local command name, e.g. "next" -> "/next". PLUGIN_UI_COMMAND. */
	command?: string;
	/** "after a command failed", "reading the last turn…". */
	cue?: { text: string; tone: PluginUiTone };
	/** One muted line: unavailable copy, or a degraded planner. Never internal error text. */
	note?: string;
	/**
	 * Kept only when status is "hidden". "superseded" lets hosts keep their "sent" line;
	 * "user" means hidden for this chat, which `show` undoes.
	 */
	hiddenReason?: ComposerSuggestionsHiddenReason;
	/** Opaque id of this set; echoed by verbs so a stale key sends nothing. PLUGIN_UI_TOKEN. Required in every status. */
	revision: string;
	items: ComposerSuggestionItem[];
	/** A new set is available ("more" on the last row, New set). */
	canRefresh: boolean;
}

// ── verbs (host -> plugin) ─────────────────────────────────────────────────

/** Presence, shared by every slot. Core records the viewer before forwarding. */
export type PluginUiPresenceAction =
	| { verb: "attach"; surface: PluginUiSurface }
	| { verb: "detach" };

type ItemRef = { revision: string; itemId: string };

export type ComposerSuggestionsAction =
	| PluginUiPresenceAction
	/** At least 400 ms visible while ready, once per (viewer, revision). */
	| { verb: "exposed"; revision: string; itemIds: string[] }
	| ({
			verb: "use" | "send";
			input: PluginUiInput;
			msSinceExposed?: number;
	  } & ItemRef)
	| ({ verb: "skip"; input: PluginUiInput; msSinceExposed?: number } & ItemRef)
	/** Desktop More menu only. */
	| ({ verb: "unskip"; input: PluginUiInput } & ItemRef)
	/** The host emptied a used box, or is rewinding a sent turn. */
	| ({ verb: "clear" | "undo" } & ItemRef)
	| {
			verb: "refresh";
			revision: string;
			input: PluginUiInput;
			cause: "more" | "new_set";
	  }
	| {
			verb: "hide";
			scope: "turn" | "chat";
			input: PluginUiInput;
			revision?: string;
	  }
	/** Undoes `hide { scope: "chat" }`. */
	| { verb: "show"; input: PluginUiInput }
	| {
			verb: "signal";
			name: "key_inert";
			reason: "not_exposed" | "unsendable" | "stale";
			revision?: string;
	  };

export interface PluginUiSlotContracts {
	"composer.suggestions": {
		state: ComposerSuggestionsState;
		action: ComposerSuggestionsAction;
	};
}
export type PluginUiState<S extends PluginUiSlot = PluginUiSlot> =
	PluginUiSlotContracts[S]["state"];
export type PluginUiAction<S extends PluginUiSlot = PluginUiSlot> =
	PluginUiSlotContracts[S]["action"];

// ── envelope and ordering ──────────────────────────────────────────────────

/** The only shape that leaves core. Same object on CoreSessionEvent, the hub event, and get/invoke replies. */
export interface PluginUiStateEnvelope<S extends PluginUiSlot = PluginUiSlot> {
	/** The only sessionId. Never nested in state, so session remappers rewrite one field. */
	sessionId: string;
	slot: S;
	/** Owner plugin, stamped by the host from the worker's descriptor. Never from the payload. */
	plugin: string;
	/** Minted when the session starts: max(Date.now(), this session id's last epoch + 1). */
	epoch: number;
	/** 1.. per (session, slot) within the epoch; stamped when the state is stored. */
	seq: number;
	/** Normalized. null = cleared (plugin cleared it, failed, or was disabled). */
	state: PluginUiState<S> | null;
}

export type PluginUiOrder = Pick<PluginUiStateEnvelope, "epoch" | "seq">;

// ── query and invoke ───────────────────────────────────────────────────────

/** Stamped by core or the hub, never taken from the action. */
export interface PluginUiViewer {
	/** Hub: the clientId of the registered connection that sent the call. In-process: "local" unless the caller passes its own id. */
	id: string;
	clientType?: string;
	/** Remembered from this viewer's last `attach`. */
	surface?: PluginUiSurface;
}

export interface PluginUiGetInput {
	sessionId: string;
}

export interface PluginUiInvokeInput<S extends PluginUiSlot = PluginUiSlot> {
	sessionId: string;
	slot: S;
	action: PluginUiAction<S>;
	/** In-process callers only; the hub ignores it and stamps the connection's clientId. */
	viewerId?: string;
}

export type PluginUiInvokeOutcome =
	| "ok"
	| "refused"
	| "rejected"
	| "unavailable"
	| "timeout";

export interface PluginUiInvokeResult<S extends PluginUiSlot = PluginUiSlot> {
	outcome: PluginUiInvokeOutcome;
	/** Present when outcome is "refused". */
	reason?: "stale" | "unsendable";
	/** The slot's current envelope after the action (pending pushes flushed first). Renderers apply it whatever the outcome. */
	state?: PluginUiStateEnvelope<S>;
	/** The session's current epoch, on every reply for a resident session whose chain is not closing, whatever the outcome. */
	epoch?: number;
}

// ── plugin-facing ──────────────────────────────────────────────────────────

export interface PluginUiActionContext {
	sessionId: string;
	viewer: PluginUiViewer;
	/** Viewers attached to this session after this action is applied (attach/detach included). */
	viewers: number;
}

export type PluginUiActionReply =
	| { outcome: "ok" }
	| { outcome: "refused"; reason?: "stale" | "unsendable" }
	| undefined
	// biome-ignore lint/suspicious/noConfusingVoidType: a handler with no return statement infers void
	| void;

export interface AgentExtensionUiSlot<S extends PluginUiSlot = PluginUiSlot> {
	slot: S;
	onAction: (
		action: PluginUiAction<S>,
		context: PluginUiActionContext,
	) => PluginUiActionReply | Promise<PluginUiActionReply>;
}

export interface PluginUiContext {
	/** The session's catalog: slot ids the host that started it renders, as this core knows them. Never empty. */
	readonly slots: readonly string[];
	/** Fire-and-forget. Never throws; invalid or unregistered updates are dropped and logged. */
	update<S extends PluginUiSlot>(slot: S, state: PluginUiState<S> | null): void;
}
