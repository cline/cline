import os from "node:os"

// Determine platform and architecture at runtime once.
const _platform = os.platform()

export enum PLATFORM_OS {
	MacOS = "darwin",
	Linux = "linux",
	Win32 = "win32",
}

export function getPlatformOS(): PLATFORM_OS {
	switch (_platform) {
		case "darwin":
			return PLATFORM_OS.MacOS
		case "win32":
			return PLATFORM_OS.Win32
		default:
			return PLATFORM_OS.Linux
	}
}
