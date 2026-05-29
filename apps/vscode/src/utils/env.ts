import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

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
 *
 * When CLINE_CAPTURE_BROWSER is set (debug harness mode), the URL is captured
 * to a file and/or posted to the debug harness instead of opening a real browser.
 * This enables automated OAuth flow testing.
 *
 * @param url The URL to open
 * @returns Promise that resolves when the operation is complete
 */
export async function openExternal(url: string): Promise<void> {
	// Debug harness mode: capture URL instead of opening browser
	if (process.env.CLINE_CAPTURE_BROWSER === "1" || process.env.CLINE_CAPTURE_BROWSER === "true") {
		await captureBrowserUrl(url)
		return
	}

	Logger.log("Opening browser:", url)
	try {
		await HostProvider.env.openExternal(StringRequest.create({ value: url }))
	} catch (error) {
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

/**
 * Captures a browser URL for the debug harness instead of opening it.
 * Writes the URL to a JSONL file and optionally POSTs it to the debug harness server.
 */
async function captureBrowserUrl(url: string): Promise<void> {
	const entry = { timestamp: Date.now(), url }
	Logger.log(`[CaptureBrowser] Captured URL: ${url}`)

	// Write to JSONL file in CLINE_DIR/data/
	try {
		const fs = await import("node:fs")
		const path = await import("node:path")
		const os = await import("node:os")
		const clineDir = process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
		const dataDir = path.join(clineDir, "data")
		fs.mkdirSync(dataDir, { recursive: true })
		const captureFile = path.join(dataDir, "debug-captured-urls.jsonl")
		fs.appendFileSync(captureFile, JSON.stringify(entry) + "\n")
	} catch (e) {
		Logger.error(`[CaptureBrowser] Failed to write captured URL to file:`, e)
	}

	// POST to debug harness server if configured
	const harnessPort = process.env.CLINE_DEBUG_HARNESS_PORT
	if (harnessPort) {
		try {
			const http = await import("node:http")
			const body = JSON.stringify(entry)
			const req = http.request({
				hostname: "127.0.0.1",
				port: Number(harnessPort),
				path: "/captured-url",
				method: "POST",
				headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
			})
			req.on("error", () => {}) // Fire-and-forget, don't block
			req.write(body)
			req.end()
		} catch (e) {
			Logger.error(`[CaptureBrowser] Failed to POST captured URL to harness:`, e)
		}
	}
}
