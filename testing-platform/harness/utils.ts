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

/**
 * Recursively normalizes an object or array by:
 * 1. Ignoring specified fields.
 * 2. Sorting arrays in a stable manner.
 * 3. Parsing JSON strings where possible.
 *
 * This ensures that comparison between objects/arrays is consistent
 * and ignores non-deterministic or irrelevant fields.
 *
 * @param obj - The object/array/value to normalize.
 * @param ignoreFields - List of field names or dot-paths to ignore during normalization.
 * @param parentPath - Internal use for tracking nested paths (used for ignoreFields).
 * @returns A normalized object/array/value suitable for comparison.
 */
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

/**
 * Recursively picks only the keys specified in `filter` from `actual`.
 * This is used for partial comparison of objects and arrays.
 *
 * Behavior:
 * 1. For objects: keeps only keys present in `filter`, recursively.
 * 2. For arrays: assumes `filter` is an array and picks corresponding keys
 *    from each element in `actual` array.
 * 3. For primitives: returns the actual value.
 *
 * @param actual - The full object/array/value received.
 * @param filter - The subset of keys/structure to keep from `actual`.
 * @returns A new object/array/value that only contains keys from `filter`.
 *
 * Example:
 * actual = {
 *   a: 1,
 *   b: { x: 10, y: 20 },
 *   c: [{ id: 1, val: "x" }, { id: 2, val: "y" }]
 * }
 *
 * filter = {
 *   b: { y: 20 },
 *   c: [{ val: "x" }]
 * }
 *
 * Result:
 * {
 *   b: { y: 20 },
 *   c: [{ val: "x" }, undefined]
 * }
 */
function pickDeep(actual: any, filter: any): any {
	if (_.isArray(filter)) {
		if (!_.isArray(actual)) return actual

		// Compare arrays element by element, picking only keys from filter
		return filter.map((f, i) => pickDeep(actual[i], f))
	}

	if (_.isPlainObject(filter)) {
		return _.mapValues(filter, (v, k) => (actual && k in actual ? pickDeep(actual[k], v) : undefined))
	}

	return actual
}

/**
 * Compares an actual response against an expected response, with optional:
 * - Ignored fields
 * - Partial comparison (via expectedSubset)
 *
 * Behavior:
 * 1. Normalizes actual and expected objects (sorting arrays, parsing JSON strings).
 * 2. If expectedSubset is provided, only compares the keys/structure defined in it.
 * 3. Returns a boolean success flag and an array of diffs (for reporting mismatches).
 *
 * @param actual - The response received from gRPC call.
 * @param expected - The full expected response from the spec file.
 * @param ignoreFields - Fields or paths to ignore in comparison.
 * @param expectedSubset - Optional subset of fields to validate (for meta.expected).
 * @returns Object with `success` (true/false) and `diffs` (array of string diffs).
 */
export function compareResponse(
	actual: any,
	expected: any,
	ignoreFields: string[] = [],
	expectedSubset?: any,
): { success: boolean; diffs: string[] } {
	const actualToCompare = normalize(actual, ignoreFields)
	const expectedToCompare = normalize(expected, ignoreFields)

	if (expectedSubset) {
		// Extract only the subset we care about
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
