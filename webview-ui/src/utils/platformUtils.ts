import { useExtensionState } from "@/context/ExtensionStateContext"

export interface NavigatorUAData {
	platform: string
	brands: { brand: string; version: string }[]
}

/**
 * Pure helper: checks whether a given platform string is macOS or Linux.
 *
 * This is intentionally *not* a React hook so it can be used safely from anywhere
 * (including non-React code and unit tests).
 */
export const isMacOSOrLinux = (platform?: string): boolean => {
	return platform === "darwin" || platform === "linux"
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
 * React hook to check whether the platform is macOS or Linux
 * @returns true if platform is darwin (macOS) or linux, false for Windows or unknown
 */
export const useIsMacOSOrLinux = (): boolean => {
	const { platform } = useExtensionState()
	// Be conservative: only return true when we *explicitly* know we're on macOS/Linux.
	// This avoids incorrectly enabling mac/linux-only UI during the initial hydration phase
	// where platform may still be "unknown".
	return isMacOSOrLinux(platform)
}
