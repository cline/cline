/**
 * Minimal key shape for dialog dismissal decisions. Structurally compatible
 * with OpenTUI's `KeyEvent` so handlers can pass the event through directly.
 */
export interface DialogDismissKey {
	name: string;
	ctrl?: boolean;
	meta?: boolean;
	super?: boolean;
	hyper?: boolean;
}

/**
 * Whether a key event should count as an intentional "any key" dismissal.
 *
 * Dialogs that close on any key must still ignore modifier-held events:
 * users open the URLs we render by holding Cmd/Ctrl and clicking the
 * hyperlink, and that modifier keystroke must not tear the dialog out from
 * under the click. Bare modifier presses (empty name) are ignored too.
 *
 * Shift and Option are intentionally not treated as blocking — they only
 * produce ordinary typed characters, not the link-opening chord (Cmd-click
 * on macOS, Ctrl-click elsewhere).
 */
export function isAnyKeyDismiss(key: DialogDismissKey): boolean {
	if (!key.name) return false;
	return !(key.ctrl || key.meta || key.super || key.hyper);
}
