import * as vscode from "vscode"

/**
 * Reveals the Cline sidebar webview.
 *
 * Two things make this less trivial than calling `WebviewView.show()`:
 *
 * 1. `WebviewView.show(preserveFocus)` takes *preserveFocus*, not *takeFocus*:
 *    passing `true` explicitly means "do NOT move keyboard focus to the view".
 *    So the flag we forward is `preserveEditorFocus` as-is.
 *
 * 2. The `WebviewView` only exists once VS Code has resolved the view at least
 *    once. If the user has never opened the sidebar in this window - or hid the
 *    Cline item from the Activity Bar, which is the usual reason someone reaches
 *    for the Command Palette in the first place - there is no view to `show()`.
 *    In that case we fall back to the `<viewId>.focus` command that VS Code
 *    registers for every contributed view; it opens the containing view
 *    container (re-revealing it in the Activity Bar) and resolves the view.
 *    That command accepts `{ preserveFocus }` with the same polarity as
 *    `WebviewView.show()`.
 *
 * @param webviewView The resolved sidebar webview view, if VS Code has created it yet.
 * @param viewId The contributed view id to fall back to (see `ExtensionRegistryInfo.views.Sidebar`).
 * @param preserveEditorFocus When true, reveal the sidebar without stealing keyboard focus from the editor.
 */
export async function revealClineSidebar(
	webviewView: vscode.WebviewView | undefined,
	viewId: string,
	preserveEditorFocus: boolean,
): Promise<void> {
	if (webviewView) {
		webviewView.show(preserveEditorFocus)
		return
	}

	await vscode.commands.executeCommand(`${viewId}.focus`, { preserveFocus: preserveEditorFocus })
}
