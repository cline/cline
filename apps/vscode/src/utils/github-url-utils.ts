/**
 * github-url-utils.ts
 *
 * Portable utility functions for creating and opening GitHub issue URLs
 * with proper URL encoding that bypasses VS Code's URI handling issues.
 *
 * This utility addresses a longstanding issue in VS Code's URI handling:
 * https://github.com/microsoft/vscode/issues/85930
 *
 * The issue causes URLs with special characters in query parameters to be incorrectly
 * encoded when opened through VS Code's standard APIs (vscode.Uri.parse followed by
 * vscode.env.openExternal). This particularly affects GitHub issue URLs with pre-filled
 * fields containing special characters.
 */

import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"

/**
 * Opens a URL only through the policy-enforcing host bridge.
 *
 * Historical shell-command and clipboard fallbacks were removed: they bypassed
 * the corporate navigation setting and could disclose prefilled issue content.
 *
 * @param url The URL to open
 * @returns A promise that resolves when an attempt to open the URL has completed
 */
export async function openUrlInBrowser(url: string): Promise<void> {
	try {
		await openExternal(url)
	} catch (error) {
		Logger.warn("External URL navigation was blocked or failed", error)
		throw error
	}
}
