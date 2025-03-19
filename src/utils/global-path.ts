/**
 * Global path utilities used across the codebase.
 * This module provides standard path manipulation functions that ensure
 * consistent behavior across different environments and platforms.
 */
import * as path from "path"
import * as os from "os"

/**
 * A safe version of path.dirname that handles undefined input
 * @param filePath The path to get the directory name of
 * @returns The directory name, or undefined if the input was undefined
 */
export function safeDirname(filePath: string | undefined): string | undefined {
	if (!filePath) {
		return undefined
	}
	return path.dirname(filePath)
}

/**
 * Gets the user's home directory
 * @returns The path to the user's home directory
 */
export function getHomeDir(): string {
	return os.homedir()
}

/**
 * Resolves a path relative to the user's home directory
 * @param relativePath The path relative to the home directory
 * @returns The absolute path
 */
export function resolveHomePath(relativePath: string): string {
	return path.resolve(getHomeDir(), relativePath)
}

/**
 * Normalizes a path to use forward slashes, regardless of platform
 * @param inputPath The path to normalize
 * @returns The normalized path with forward slashes
 */
export function normalizePath(inputPath: string): string {
	return inputPath.replace(/\\/g, "/")
}

// Ensure safeDirname is available globally for legacy code
// @ts-ignore
global.safeDirname = safeDirname
