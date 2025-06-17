import * as vscode from "vscode"
import { Package } from "../shared/package"
import { ClineProvider } from "../core/webview/ClineProvider"

/**
 * Focus the active panel (either tab or sidebar)
 * @param tabPanel - The tab panel reference
 * @param sidebarPanel - The sidebar panel reference
 * @returns Promise that resolves when focus is complete
 */
export async function focusPanel(
	tabPanel: vscode.WebviewPanel | undefined,
	sidebarPanel: vscode.WebviewView | undefined,
): Promise<void> {
	const panel = tabPanel || sidebarPanel

	if (!panel) {
		// If no panel is open, open the sidebar
		await vscode.commands.executeCommand(`workbench.view.extension.${Package.name}-ActivityBar`)
	} else if (panel === tabPanel && !panel.active) {
		// For tab panels, use reveal to focus
		panel.reveal(vscode.ViewColumn.Active, false)
	} else if (panel === sidebarPanel) {
		// For sidebar panels, focus the sidebar
		await vscode.commands.executeCommand(`${ClineProvider.sideBarId}.focus`)
	}
}
