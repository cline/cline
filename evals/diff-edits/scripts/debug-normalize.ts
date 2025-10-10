import { normalizeLineForComparison } from "../diff-apply/diff-06-26-25"
import fs from "fs"
import path from "path"

function loadRecords() {
	const dataPath = path.resolve(__dirname, "../tmp/ipynb_diff_errors.json")
	if (!fs.existsSync(dataPath)) {
		throw new Error(`Missing ${dataPath}`)
	}
	return JSON.parse(fs.readFileSync(dataPath, "utf8")) as Array<{
		result_id: string
		original: string
		parsed_tool_call_json: string
	}>
}

function main() {
	const records = loadRecords()
	const record = records[0]
	const originalLine = record.original.split("\n").find((line) => line.includes("#3: Which are the resources")) || ""
	const parsed = JSON.parse(record.parsed_tool_call_json)
	const diff: string = parsed[0]?.input?.diff ?? ""
	const diffLine = diff.split("\n").find((line: string) => line.includes("#3: Which are the resources")) || ""
	console.log("Original:", JSON.stringify(originalLine))
	console.log("Normalized original:", JSON.stringify(normalizeLineForComparison(originalLine)))
	console.log("Diff line:", JSON.stringify(diffLine))
	console.log("Normalized diff:", JSON.stringify(normalizeLineForComparison(diffLine)))
}

main()
