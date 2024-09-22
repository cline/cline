import * as path from "path"

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

// Safe path comparison that works across different platforms
// export function arePathsEqual(path1?: string, path2?: string): boolean {
// 	if (!path1 && !path2) {
// 		return true
// 	}
// 	if (!path1 || !path2) {
// 		return false
// 	}

// 	path1 = normalizePath(path1)
// 	path2 = normalizePath(path2)

// 	if (process.platform === "win32") {
// 		return path1.toLowerCase() === path2.toLowerCase()
// 	}
// 	return path1 === path2
// }

// function normalizePath(p: string): string {
// 	// normalize resolve ./.. segments, removes duplicate slashes, and standardizes path separators
// 	let normalized = path.normalize(p)
// 	// however it doesn't remove trailing slashes
// 	// remove trailing slash, except for root paths
// 	if (normalized.length > 1 && (normalized.endsWith("/") || normalized.endsWith("\\"))) {
// 		normalized = normalized.slice(0, -1)
// 	}
// 	return normalized
// }
