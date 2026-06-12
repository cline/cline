/**
 * Resolve a local filesystem path into a webview-loadable URI.
 *
 * The map panel host (VscodeMapPanelProvider) authorizes the file's directory
 * via localResourceRoots and returns `asWebviewUri(...)`. Used for layer source
 * files and for site-visit photos that live outside the workspace.
 */
import { PLATFORM_CONFIG } from "../../config/platform.config"

export function newUiRequestId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function resolveFileUri(filePath: string, timeoutMs = 30_000): Promise<{ uri: string; name: string }> {
	const requestId = newUiRequestId("resolve")
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			reject(new Error("Timed out resolving file"))
		}, timeoutMs)
		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-resolve-file-uri-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			if (data.ok && typeof data.uri === "string") {
				resolve({ uri: data.uri, name: data.name ?? filePath.split("/").pop() ?? "file" })
			} else {
				reject(new Error(data.error ?? "Could not resolve file"))
			}
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-resolve-file-uri", requestId, path: filePath })
	})
}

/** Open a native multi-select image picker; resolves to chosen absolute paths. */
export function pickImages(timeoutMs = 120_000): Promise<string[]> {
	const requestId = newUiRequestId("pickimg")
	return new Promise((resolve) => {
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			resolve([])
		}, timeoutMs)
		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-pick-images-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			resolve(Array.isArray(data.paths) ? data.paths.filter((p: unknown): p is string => typeof p === "string") : [])
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-pick-images", requestId })
	})
}
