export const unknown = "Unknown"

const platforms = {
	windows: /win32/,
	mac: /darwin/,
	linux: /linux/,
}

export const detectOS = (platform: string) => {
	let detectedOs = unknown
	if (platform.match(platforms.windows)) {
		detectedOs = "windows"
	} else if (platform.match(platforms.mac)) {
		detectedOs = "mac"
	} else if (platform.match(platforms.linux)) {
		detectedOs = "linux"
	}
	return detectedOs
}

/**
 * Label for the modifier that "Meta" in shortcut configs resolves to: Cmd on macOS, Alt elsewhere.
 * The Win/Super key is reserved by the OS and rarely reaches the webview, and Ctrl+Shift+A is
 * VS Code's own "Open Agents Window" shortcut.
 */
export const detectMetaKeyChar = (platform: string) => {
	return platform.match(platforms.mac) ? "CMD" : "Alt"
}

const userAgent = navigator?.userAgent || ""

const isChrome = userAgent.indexOf("Chrome") >= 0

export const isSafari = !isChrome && userAgent.indexOf("Safari") >= 0

declare const __NODE_PLATFORM__: string

/**
 * Gets the current platform: 'windows', 'mac', or 'linux'
 * Defaults to 'linux' if platform cannot be determined
 */
export function getCurrentPlatform() {
	// Fallback to linux if platform is not available
	switch (__NODE_PLATFORM__) {
		case "win32":
			return "windows"
		case "darwin":
			return "mac"
		default:
			return "linux"
	}
}

/**
 * Checks if the platform is macOS or Linux
 * @returns true if platform is darwin (macOS) or linux
 */
export const isMacOSOrLinux = (): boolean => {
	return getCurrentPlatform() !== "windows" // Non-Windows
}
