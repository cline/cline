import * as path from "path"
import os from "os"

/*
The Node.js 'path' module resolves and normalizes paths differently depending on the platform:
- On Windows, it uses backslashes (\) as the default path separator.
- On POSIX-compliant systems (Linux, macOS), it uses forward slashes (/) as the default path separator.

While modules like 'upath' can be used to normalize paths to use forward slashes consistently,
this can create inconsistencies when interfacing with other modules (like vscode.fs) that use
backslashes on Windows.

Our approach:
1. We present paths with forward slashes to the AI and user for consistency.
2. We use the 'arePathsEqual' function for safe path comparisons.
3. Internally, Node.js gracefully handles both backslashes and forward slashes.

This strategy ensures consistent path presentation while leveraging Node.js's built-in
path handling capabilities across different platforms.

Note: When interacting with the file system or VS Code APIs, we still use the native path module
to ensure correct behavior on all platforms. The toPosixPath and arePathsEqual functions are
primarily used for presentation and comparison purposes, not for actual file system operations.

Observations:
- Macos isn't so flexible with mixed separators, whereas windows can handle both. ("Node.js does automatically handle path separators on Windows, converting forward slashes to backslashes as needed. However, on macOS and other Unix-like systems, the path separator is always a forward slash (/), and backslashes are treated as regular characters.")
*/

/**
 * Converts a file path to use forward slashes regardless of platform.
 * This makes paths consistent when displaying to users or in output.
 *
 * @param p - The path to convert
 * @returns The path with forward slashes
 */
function toPosixPath(p: string) {
	// Extended-Length Paths in Windows start with "\\?\" to allow longer paths and bypass usual parsing. If detected, we return the path unmodified to maintain functionality, as altering these paths could break their special syntax.
	const isExtendedLengthPath = p.startsWith("\\\\?\\")

	if (isExtendedLengthPath) {
		return p
	}

	return p.replace(/\\/g, "/")
}

// Declaration merging allows us to add a new method to the String type
// You must import this file in your entry point (extension.ts) to have access at runtime
declare global {
	interface String {
		toPosix(): string
	}
}

String.prototype.toPosix = function (this: string): string {
	return toPosixPath(this)
}

/**
 * Compares two file paths for equality, regardless of platform-specific differences.
 * On Windows, the comparison is case-insensitive; on other platforms, it's case-sensitive.
 *
 * @param path1 - First path to compare
 * @param path2 - Second path to compare
 * @returns True if the paths are equivalent
 */
export function arePathsEqual(path1?: string, path2?: string): boolean {
	if (!path1 && !path2) {
		return true
	}
	if (!path1 || !path2) {
		return false
	}

	path1 = normalizePath(path1)
	path2 = normalizePath(path2)

	if (process.platform === "win32") {
		return path1.toLowerCase() === path2.toLowerCase()
	}
	return path1 === path2
}

/**
 * Normalizes a path, resolving .. segments and standardizing separators.
 * Also removes trailing slashes except for root paths.
 *
 * @param p - Path to normalize
 * @returns Normalized path
 */
function normalizePath(p: string): string {
	// normalize resolve ./.. segments, removes duplicate slashes, and standardizes path separators
	let normalized = path.normalize(p)
	// however it doesn't remove trailing slashes
	// remove trailing slash, except for root paths
	if (normalized.length > 1 && (normalized.endsWith("/") || normalized.endsWith("\\"))) {
		normalized = normalized.slice(0, -1)
	}
	return normalized
}

/**
 * Makes a path more readable for end users.
 * - For paths within cwd, shows relative path
 * - For paths at cwd, shows basename
 * - For paths outside cwd, shows absolute path
 *
 * @param cwd - Current working directory
 * @param relPath - Path to make readable (can be relative or absolute)
 * @returns Human-friendly path representation
 */
export function getReadablePath(cwd: string, relPath?: string): string {
	relPath = relPath || ""

	// Direct check for exact equality between relPath and cwd to ensure backward compatibility
	if (relPath === cwd) {
		return path.basename(cwd)
	}

	// Normalize both paths for consistent handling across platforms
	const normalizedCwd = normalizePath(cwd)
	const absolutePath = path.resolve(cwd, relPath)
	const normalizedAbsPath = normalizePath(absolutePath)

	// Convert paths to a consistent format for reliable comparison and display
	const toPortablePath = (p: string) => p.replace(/\\/g, "/")

	// Special case: Desktop path handling
	if (arePathsEqual(normalizedCwd, path.join(os.homedir(), "Desktop"))) {
		return toPortablePath(absolutePath)
	}

	// Case 1: Path equals CWD - return just the basename
	if (arePathsEqual(normalizedAbsPath, normalizedCwd)) {
		return path.basename(absolutePath)
	}

	// Case 2: Path is within CWD - use path.relative to get the relative path properly
	const relativePath = path.relative(normalizedCwd, normalizedAbsPath)

	// If the relative path doesn't start with '..', it's within the cwd
	if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
		return toPortablePath(relativePath)
	}

	// Case 3: Path is outside CWD - show full absolute path
	// On Windows, optionally remove drive letter for display consistency
	if (process.platform === "win32") {
		return toPortablePath(absolutePath).replace(/^[A-Z]:/i, "")
	}
	return toPortablePath(absolutePath)
}
