import fs from "fs/promises"
import os from "os"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir } from "@/utils/path"

/**
 * All valid hook types that can be created and executed by Cline.
 * These hooks correspond to specific lifecycle events in the task execution process.
 */
export const VALID_HOOK_TYPES = [
	"TaskStart",
	"TaskResume",
	"TaskCancel",
	"TaskComplete",
	"PreToolUse",
	"PostToolUse",
	"UserPromptSubmit",
	"PreCompact",
] as const

/**
 * Type representing a valid hook name
 */
export type HookType = (typeof VALID_HOOK_TYPES)[number]

/**
 * Validates if a given hook name is a valid hook type.
 *
 * @param hookName - The hook name to validate
 * @returns True if the hook name is valid, false otherwise
 */
export function isValidHookType(hookName: string): hookName is HookType {
	return VALID_HOOK_TYPES.includes(hookName as HookType)
}

/**
 * Resolves the hooks directory path for either global or workspace hooks.
 * Handles both single and multi-root workspaces.
 *
 * @param isGlobal - Whether to resolve the global hooks directory
 * @param workspaceName - For multi-root workspaces, the name of the specific workspace
 * @param globalHooksDirOverride - Optional override for global hooks directory (for testing)
 * @returns The absolute path to the hooks directory
 * @throws Error if the specified workspace cannot be found
 */
export async function resolveHooksDirectory(
	isGlobal: boolean,
	workspaceName?: string,
	globalHooksDirOverride?: string,
): Promise<string> {
	if (isGlobal) {
		return globalHooksDirOverride || path.join(os.homedir(), "Documents", "Cline", "Hooks")
	}

	// For workspace hooks, find the correct workspace
	if (workspaceName) {
		// Multi-root workspace: find the workspace with this name
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const targetWorkspace = workspacePaths.paths.find((p) => path.basename(p) === workspaceName)
		if (!targetWorkspace) {
			throw new Error(`Workspace "${workspaceName}" not found`)
		}
		return path.join(targetWorkspace, ".clinerules", "hooks")
	}

	// Single workspace: use getCwd
	const cwd = await getCwd(getDesktopDir())
	return path.join(cwd, ".clinerules", "hooks")
}

/**
 * Resolves the active hook file path for a given hook name.
 *
 * Platform-specific filename rules are intentionally strict:
 *
 * On Windows, only PowerShell-native naming is supported:
 * - <HookName>.ps1
 *
 * Why: Windows hooks execute via PowerShell (`powershell -File ...`).
 * PowerShell cannot execute bash-style extensionless hook files as-is.
 *
 * On Unix-like platforms (Linux/macOS), only canonical extensionless names are considered:
 * - <HookName>
 *
 * Why: Unix hooks are discovered/executed as native executable files
 * (bash scripts, binaries, etc.) using executable-bit semantics.
 * `.ps1` files are not part of the supported Unix hook contract.
 *
 * @param hooksDir Directory containing hook files
 * @param hookName Hook type/name to resolve
 * @returns Resolved absolute file path if present, otherwise undefined
 */
export async function resolveExistingHookPath(hooksDir: string, hookName: string): Promise<string | undefined> {
	const candidates = process.platform === "win32" ? [path.join(hooksDir, `${hookName}.ps1`)] : [path.join(hooksDir, hookName)]

	for (const candidate of candidates) {
		if (await isRegularFile(candidate)) {
			return candidate
		}
	}

	return undefined
}

async function isRegularFile(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath)
		return stat.isFile()
	} catch {
		return false
	}
}
