import * as vscode from "vscode"
import type { StateManager } from "../../core/storage/StateManager"
import type { QuantrelAuthService } from "./QuantrelAuthService"

/**
 * Manages Quantrel status bar items
 */
export class QuantrelStatusBar {
	private authStatusBar: vscode.StatusBarItem
	private modelStatusBar: vscode.StatusBarItem
	private stateManager: StateManager
	private authService: QuantrelAuthService

	constructor(stateManager: StateManager, authService: QuantrelAuthService) {
		this.stateManager = stateManager
		this.authService = authService

		// Create status bar items
		this.authStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.authStatusBar.command = "quantrel.login"

		this.modelStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
		this.modelStatusBar.command = "quantrel.selectModel"

		this.update()
	}

	/**
	 * Update status bar items based on current state
	 */
	update(): void {
		const isAuthenticated = this.authService.isAuthenticated()
		const userEmail = this.stateManager.getGlobalSettingsKey("quantrelUserEmail")
		const selectedModelName = this.stateManager.getGlobalSettingsKey("quantrelSelectedModelName")

		// Update auth status
		if (isAuthenticated && userEmail) {
			this.authStatusBar.text = `$(account) ${userEmail}`
			this.authStatusBar.tooltip = "Logged in to Quantrel\nClick to logout"
			this.authStatusBar.command = "quantrel.logout"
			this.authStatusBar.show()
		} else {
			this.authStatusBar.text = "$(account) Login to Quantrel"
			this.authStatusBar.tooltip = "Click to login to Quantrel"
			this.authStatusBar.command = "quantrel.login"
			this.authStatusBar.show()
		}

		// Update model status
		if (isAuthenticated && selectedModelName) {
			this.modelStatusBar.text = `$(symbol-class) ${selectedModelName}`
			this.modelStatusBar.tooltip = "Selected Quantrel model\nClick to change"
			this.modelStatusBar.show()
		} else if (isAuthenticated) {
			this.modelStatusBar.text = "$(symbol-class) Select Model"
			this.modelStatusBar.tooltip = "Click to select a Quantrel model"
			this.modelStatusBar.show()
		} else {
			this.modelStatusBar.hide()
		}
	}

	/**
	 * Dispose status bar items
	 */
	dispose(): void {
		this.authStatusBar.dispose()
		this.modelStatusBar.dispose()
	}
}
