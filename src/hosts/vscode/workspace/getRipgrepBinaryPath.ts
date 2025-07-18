import * as vscode from "vscode"
import * as path from "path"
import { fileExistsAtPath } from "@utils/fs"
import { getRipgrepBinaryPathForPlatform as getPlatformBinaryPath } from "@utils/platform"
import { getBinaryInstallPath, isSetup } from "@hosts/host-providers"
import { EmptyRequest, String } from "@shared/proto/common"

const isWindows = /^win/.test(process.platform)
const binName = isWindows ? "rg.exe" : "rg"

/**
 * Host bridge method to get the ripgrep binary path
 * Handles both VSCode and standalone environments
 */
export async function getRipgrepBinaryPath(_request: EmptyRequest): Promise<String> {
	let rgPath: string | undefined

	// If running in non VS Code environment, use bundled binary
	if (isSetup) {
		try {
			const binaryPath = getBinaryInstallPath()
			if (binaryPath) {
				const bundledPath = getPlatformBinaryPath(binaryPath)
				if (await fileExistsAtPath(bundledPath)) {
					rgPath = bundledPath
				}
			}
		} catch (error) {
			console.warn("Failed to get bundled ripgrep binary:", error)
		}
	}

	// VS Code flow - fallback if bundled binary not found
	if (!rgPath) {
		const vscodeAppRoot = vscode.env.appRoot
		if (vscodeAppRoot) {
			const checkPath = async (pkgFolder: string) => {
				const fullPath = path.join(vscodeAppRoot, pkgFolder, binName)
				return (await fileExistsAtPath(fullPath)) ? fullPath : undefined
			}

			rgPath =
				(await checkPath("node_modules/@vscode/ripgrep/bin/")) ||
				(await checkPath("node_modules/vscode-ripgrep/bin")) ||
				(await checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")) ||
				(await checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/"))
		}
	}

	if (!rgPath) {
		throw new Error("Could not find ripgrep binary")
	}

	return String.create({ value: rgPath })
}
