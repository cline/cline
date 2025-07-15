import * as path from "path"
import * as os from "os"

/**
 * Platform detection utility for selecting appropriate binary paths
 */
export interface PlatformInfo {
	platform: string
	arch: string
	binaryName: string
}

/**
 * Detects the current platform and architecture
 */
export function getPlatformInfo(): PlatformInfo {
	const platform = os.platform()
	const arch = os.arch()

	// Map Node.js arch values to our binary directory names
	const archMap: { [key: string]: string } = {
		x64: "x64",
		arm64: "arm64",
		aarch64: "aarch64",
	}

	let platformDir: string
	let binaryName: string

	switch (platform) {
		case "darwin":
			platformDir = `darwin-${archMap[arch] || arch}`
			binaryName = "rg"
			break
		case "linux":
			platformDir = `linux-${archMap[arch] || arch}`
			binaryName = "rg"
			break
		case "win32":
			platformDir = `win32-${archMap[arch] || arch}`
			binaryName = "rg.exe"
			break
		default:
			throw new Error(`Unsupported platform: ${platform}`)
	}

	return {
		platform: platformDir,
		arch: archMap[arch] || arch,
		binaryName,
	}
}

/**
 * Gets the path to the ripgrep binary based on platform and binary install path
 */
export function getRipgrepBinaryPathForPlatform(binaryInstallPath: string): string {
	const platformInfo = getPlatformInfo()
	return path.join(binaryInstallPath, platformInfo.binaryName)
}
