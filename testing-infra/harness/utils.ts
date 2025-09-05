import fs from "fs"
import path from "path"

export function loadJson(filePath: string): any {
	return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf-8"))
}

export function pretty(obj: any): string {
	return JSON.stringify(obj, null, 2)
}

export function compareResponse(actual: any, expected: any): { success: boolean; diffs: string[] } {
	const diffs: string[] = []
	const expectedStr = JSON.stringify(expected, null, 2)
	const actualStr = JSON.stringify(actual, null, 2)

	if (expectedStr !== actualStr) {
		diffs.push(`Expected:\n${expectedStr}\n\nActual:\n${actualStr}`)
	}

	return { success: diffs.length === 0, diffs }
}
