/**
 * Composer Suggestions Plugin Example
 *
 * Fills the Cline-owned `composer.suggestions` slot: up to three suggested
 * prompts above the message box, which each host renders with its own
 * components. It publishes a set in `setup`, on its own verbs, and after
 * every run. Hosts that render no slot offer no slot API, and the plugin then
 * does nothing. It is also every host's end-to-end fixture for the slot.
 *
 * CLI usage:
 *   cline plugin install https://github.com/cline/cline/blob/main/sdk/examples/plugins/composer-suggestions.ts --cwd .
 */

import type { AgentPlugin } from "@cline/core";
import type {
	ComposerSuggestionItem,
	ComposerSuggestionsState,
	PluginUiContext,
} from "@cline/shared";

const ITEMS: ComposerSuggestionItem[] = [
	{
		id: "verify",
		label: "Verify",
		tone: "check",
		icon: "verify",
		prompt: "Run the whole test suite",
		detail: "Nothing ran this turn",
		sendable: true,
	},
	{
		id: "commit",
		label: "Commit",
		tone: "finish",
		icon: "commit",
		prompt: "Commit these changes",
		sendable: true,
	},
];

// One worker per (session, plugin), so module state is per session.
let ui: PluginUiContext | undefined;
let n = 1;
let skipped = new Set<string>();
const state = (): ComposerSuggestionsState => ({
	status: "ready",
	title: "Demo",
	command: "demo",
	revision: `r${n}`,
	canRefresh: true,
	cue: { text: "after the last turn", tone: "neutral" },
	items: ITEMS.filter((item) => !skipped.has(item.id)),
});

export default {
	name: "composer-suggestions-demo",
	manifest: { capabilities: ["hooks"] },
	hooks: {
		afterRun() {
			if (!ui) return; // no slots on this host
			n += 1;
			skipped = new Set();
			ui.update("composer.suggestions", state());
		},
	},
	setup(api, ctx) {
		const slotUi = ctx.ui;
		// No slots on this host: still a working plugin, just without a tray.
		if (
			!api.registerUiSlot ||
			!slotUi?.slots.includes("composer.suggestions")
		) {
			return;
		}
		ui = slotUi;
		api.registerUiSlot({
			slot: "composer.suggestions",
			onAction(action) {
				if (action.verb === "attach") {
					slotUi.update("composer.suggestions", state());
					return;
				}
				if (action.verb === "detach") return;
				const stale =
					"revision" in action &&
					action.revision &&
					action.revision !== `r${n}`;
				if (stale) return { outcome: "refused", reason: "stale" };
				if (action.verb === "skip") {
					skipped.add(action.itemId);
					n += 1;
					slotUi.update("composer.suggestions", state());
				}
				if (action.verb === "refresh") {
					skipped = new Set();
					n += 1;
					slotUi.update("composer.suggestions", state());
				}
				return { outcome: "ok" };
			},
		});
		// The setup-time state: what `get` and `onUiState` see before any attach.
		slotUi.update("composer.suggestions", state());
	},
} satisfies AgentPlugin;
