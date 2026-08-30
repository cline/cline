import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

const ALLOWED_EXTERNAL_URI_SCHEMES = new Set(["http", "https", "mailto"])

function isAllowedExternalUrl(url: string): boolean {
	try {
		// Use WHATWG URL for strict parsing; vscode.Uri not available here
		const parsed = new URL(url)
		// URL.protocol includes trailing ":", strip it
		const scheme = parsed.protocol.replace(/:$/, "").toLowerCase()
		return ALLOWED_EXTERNAL_URI_SCHEMES.has(scheme)
	} catch {
		return false
	}
}

function getUrlScheme(url: string): string {
	try {
		const parsed = new URL(url)
		return parsed.protocol.replace(/:$/, "")
	} catch {
		// Fallback to simple split for error reporting
		const colon = url.indexOf(":")
		return colon > 0 ? url.slice(0, colon) : ""
	}
}

/**
 * Writes text to the system clipboard
 * @param text The text to write to the clipboard
 * @returns Promise that resolves when the operation is complete
 * @throws Error if the operation fails
 */
export async function writeTextToClipboard(text: string): Promise<void> {
	try {
		await HostProvider.env.clipboardWriteText(StringRequest.create({ value: text }))
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to write to clipboard: ${errorMessage}`)
	}
}

/**
 * Reads text from the system clipboard
 * @returns Promise that resolves to the clipboard text
 * @throws Error if the operation fails
 */
export async function readTextFromClipboard(): Promise<string> {
	try {
		const response = await HostProvider.env.clipboardReadText(EmptyRequest.create({}))
		return response.value
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to read from clipboard: ${errorMessage}`)
	}
}

/**
 * Opens an external URL in the default browser.
 * Uses the host bridge RPC first (VS Code's openExternal which handles remote environments).
 * Falls back to the `open` npm package if the host doesn't implement the RPC (e.g., JetBrains).
 * Centralizes scheme validation so blocked schemes never reach either opener.
 * @param url The URL to open
 * @returns Promise that resolves when the operation is complete
 */
export async function openExternal(url: string): Promise<void> {
	Logger.log("Opening browser:", url)
	// Central validation: reject before any launch attempt, including fallback
	if (!isAllowedExternalUrl(url)) {
		const scheme = getUrlScheme(url)
		throw new Error(`Unsupported external URI scheme: ${scheme || "(missing)"}`)
	}
	try {
		await HostProvider.env.openExternal(StringRequest.create({ value: url }))
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		// Do NOT fallback on policy rejection — only on genuine RPC unavailability
		if (message.includes("Unsupported external URI scheme")) {
			Logger.error(`Blocked external URL with disallowed scheme: ${url}`)
			throw error
		}
		// Fallback for hosts that don't implement openExternal (e.g., JetBrains plugin)
		Logger.warn(`Host openExternal RPC failed, falling back to 'open' package: ${error}`)
		try {
			const open = (await import("open")).default
			await open(url)
		} catch (fallbackError) {
			Logger.error(`Fallback 'open' also failed: ${fallbackError}`)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to open URL: ${url}`,
			})
		}
	}
}
