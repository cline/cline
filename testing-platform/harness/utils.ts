import fs from "fs"
import { diff } from "jest-diff"
import _ from "lodash"
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
		// Normalize each element, then sort in a stable way
		const normalizedArray = obj.map((item) => normalize(item, ignoreFields, parentPath))

		// Sort array by JSON stringification (works for objects & primitives)
		return normalizedArray.sort((a, b) => {
			const sa = JSON.stringify(a)
			const sb = JSON.stringify(b)
			return sa < sb ? -1 : sa > sb ? 1 : 0
		})
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

function pickDeep(actual: any, filter: any): any {
	if (_.isPlainObject(filter)) {
		return _.mapValues(filter, (v, k) => (actual && k in actual ? pickDeep(actual[k], v) : undefined))
	}
	return actual
}

export function compareResponse(actual: any, expected: any, ignoreFields: string[] = [], expectedSubset?: any) {
	const actualToCompare = normalize(actual, ignoreFields)
	const expectedToCompare = normalize(expected, ignoreFields)

	if (expectedSubset) {
		// Extract only what we care about
		const actualSubset = pickDeep(actualToCompare, expectedSubset)

		const success = _.isEqual(actualSubset, expectedSubset)
		if (!success) {
			const difference = diff(expectedSubset, actualSubset, { expand: false })
			return { success: false, diffs: [difference || "Objects differ"] }
		}
		return { success: true, diffs: [] }
	}

	// Fallback: full comparison
	const success = _.isEqual(actualToCompare, expectedToCompare)
	if (!success) {
		const difference = diff(expectedToCompare, actualToCompare, { expand: false })
		return { success: false, diffs: [difference || "Objects differ"] }
	}
	return { success: true, diffs: [] }
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
