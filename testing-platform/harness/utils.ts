import fs from "fs"
import { diff } from "jest-diff"
import path from "path"

export function loadJson(filePath: string): any {
	return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf-8"))
}

export function pretty(obj: any): string {
	return JSON.stringify(obj, null, 2)
}

// Normalize object and ignore specified fields
function normalize(obj: any, ignoreFields: string[] = [], parentPath = ""): any {
	if (Array.isArray(obj)) {
		return obj.map((item, _) => normalize(item, ignoreFields, parentPath)) // do not include index
	}
	if (obj && typeof obj === "object") {
		const result: Record<string, any> = {}
		for (const [k, v] of Object.entries(obj)) {
			const currentPath = parentPath ? `${parentPath}.${k}` : k
			if (ignoreFields.includes(currentPath) || ignoreFields.includes(k)) {
				continue
			}
			result[k] = normalize(v, ignoreFields, currentPath)
		}
		return result
	}
	if (typeof obj === "string") {
		try {
			return normalize(JSON.parse(obj), ignoreFields, parentPath)
		} catch {
			return obj
		}
	}
	return obj
}

// Compare two objects, ignoring specified fields
export function compareResponse(actual: any, expected: any, ignoreFields: string[] = []): { success: boolean; diffs: string[] } {
	const diffs: string[] = []

	const normalizedActual = normalize(actual, ignoreFields)
	const normalizedExpected = normalize(expected, ignoreFields)

	if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
		const difference = diff(normalizedExpected, normalizedActual, {
			expand: false, // compact diff
		})
		diffs.push(difference || "Objects differ but no diff generated.")
	}

	return { success: diffs.length === 0, diffs }
}

/**
 * Retries a given asynchronous function up to a specified number of times.
 *
 * @template T - The type of the resolved value.
 * @param fn - The async function to execute.
 * @param retries - Maximum number of attempts before throwing the last error (default: 3).
 * @param delayMs - Delay (in milliseconds) between retries (default: 100).
 * @returns A promise that resolves with the function result if successful.
 * @throws The last encountered error if all retries fail.
 *
 * @example
 * await retry(() => fetchData(), 5, 200)
 */
export async function retry<T>(fn: () => Promise<T>, retries = 3, delayMs = 100): Promise<T> {
	let lastError: any
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			return await fn()
		} catch (err) {
			lastError = err
			if (attempt < retries) {
				console.warn(`⚠️ Attempt ${attempt} failed, retrying in ${delayMs}ms...`)
				await new Promise((r) => setTimeout(r, delayMs))
			}
		}
	}
	throw lastError
}
