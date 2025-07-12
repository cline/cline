import * as vscode from "vscode"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { Metadata } from "@/shared/proto/common"

/**
 * Shows an error message dialog to the user.
 * @param message The error message to display
 * @param items Optional array of items to show as buttons
 * @returns The selected item if any, or undefined
 */
export async function showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
	try {
		const response = await getHostBridgeProvider().windowClient.showErrorMessage({
			metadata: Metadata.create(),
			message,
			items,
		})
		return response.selectedItem
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to show error message: ${errorMessage}`)
	}
}

/**
 * Shows an information message dialog to the user.
 * @param message The information message to display
 * @param items Optional array of items to show as buttons
 * @returns The selected item if any, or undefined
 */
export async function showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> {
	try {
		const response = await getHostBridgeProvider().windowClient.showInformationMessage({
			metadata: Metadata.create(),
			message,
			items,
		})
		return response.selectedItem
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to show information message: ${errorMessage}`)
	}
}

/**
 * Shows a warning message dialog to the user.
 * @param message The warning message to display
 * @param items Optional array of items to show as buttons
 * @returns The selected item if any, or undefined
 */
export async function showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
	try {
		const response = await getHostBridgeProvider().windowClient.showWarningMessage({
			metadata: Metadata.create(),
			message,
			items,
		})
		return response.selectedItem
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to show warning message: ${errorMessage}`)
	}
}

/**
 * Direct VSCode API fallback for error messages.
 */
export async function showErrorMessageVSCode(message: string, ...items: string[]): Promise<string | undefined> {
	if (items && items.length > 0) {
		return await vscode.window.showErrorMessage(message, ...items)
	} else {
		await vscode.window.showErrorMessage(message)
		return undefined
	}
}

/**
 * Direct VSCode API fallback for information messages.
 */
export async function showInformationMessageVSCode(message: string, ...items: string[]): Promise<string | undefined> {
	if (items && items.length > 0) {
		return await vscode.window.showInformationMessage(message, ...items)
	} else {
		await vscode.window.showInformationMessage(message)
		return undefined
	}
}

/**
 * Direct VSCode API fallback for warning messages.
 */
export async function showWarningMessageVSCode(message: string, ...items: string[]): Promise<string | undefined> {
	if (items && items.length > 0) {
		return await vscode.window.showWarningMessage(message, ...items)
	} else {
		await vscode.window.showWarningMessage(message)
		return undefined
	}
}

/**
 * Shows an input box to the user.
 * @param options Input box options
 * @returns The user input or undefined if cancelled
 */
export async function showInputBox(options?: vscode.InputBoxOptions): Promise<string | undefined> {
	try {
		const response = await getHostBridgeProvider().windowClient.showInputBox({
			metadata: Metadata.create(),
			prompt: options?.prompt,
			placeholder: options?.placeHolder,
			value: options?.value,
			password: options?.password,
		})
		return response.value
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to show input box: ${errorMessage}`)
	}
}

/**
 * Shows a save dialog to the user.
 * @param options Save dialog options
 * @returns The selected file URI or undefined if cancelled
 */
export async function showSaveDialog(options?: vscode.SaveDialogOptions): Promise<vscode.Uri | undefined> {
	try {
		const filterMap: Record<string, any> = {}
		if (options?.filters) {
			for (const [key, value] of Object.entries(options.filters)) {
				filterMap[key] = { extensions: value }
			}
		}

		const response = await getHostBridgeProvider().windowClient.showSaveDialog({
			metadata: Metadata.create(),
			defaultUri: options?.defaultUri?.fsPath,
			filters: { filterMap },
			saveLabel: options?.saveLabel,
		})
		return response.path ? vscode.Uri.file(response.path) : undefined
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to show save dialog: ${errorMessage}`)
	}
}
