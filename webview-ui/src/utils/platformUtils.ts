export interface NavigatorUAData {
	platform: string
	brands: { brand: string; version: string }[]
}

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

export const detectMetaKeyChar = (platform: string) => {
	if (platform.match(platforms.mac)) {
		return "CMD"
	} else if (platform.match(platforms.windows)) {
		return "Win"
	} else if (platform.match(platforms.linux)) {
		return "Alt"
	} else {
		return "CMD"
	}
}

const userAgent = navigator?.userAgent || ""

export const isChrome = userAgent.indexOf("Chrome") >= 0

export const isSafari = !isChrome && userAgent.indexOf("Safari") >= 0

/**
 * Gets the current platform: 'windows', 'mac', or 'linux'
 * Defaults to 'linux' if platform cannot be determined
 */
export function getCurrentPlatform() {
	// Fallback to linux if platform is not available
	switch (process?.platform) {
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
