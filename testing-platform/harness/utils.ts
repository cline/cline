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
		return obj.map((item, idx) => normalize(item, ignoreFields, parentPath)) // do not include index
	}
	if (obj && typeof obj === "object") {
		const result: Record<string, any> = {}
		for (const [k, v] of Object.entries(obj)) {
			const currentPath = parentPath ? `${parentPath}.${k}` : k
			if (ignoreFields.includes(currentPath) || ignoreFields.includes(k)) continue
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
