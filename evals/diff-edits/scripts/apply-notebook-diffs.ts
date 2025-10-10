import fs from "fs"
import path from "path"
import { constructNewFileContentV2 } from "../diff-apply/diff-06-26-25"

interface DiffRecord {
	result_id: string
	filepath: string
	original: string
	parsed_tool_call_json: string | null
}

async function main() {
	const dataPath = path.resolve(__dirname, "../tmp/ipynb_diff_errors.json")
	if (!fs.existsSync(dataPath)) {
		throw new Error(`Missing input data at ${dataPath}`)
	}
	const raw = fs.readFileSync(dataPath, "utf8")
	const records: DiffRecord[] = JSON.parse(raw)
	const outcomes = [] as Array<{ resultId: string; success: boolean; error?: string }>

	for (const record of records) {
		let diff = ""
		if (record.parsed_tool_call_json) {
			try {
				const parsed = JSON.parse(record.parsed_tool_call_json)
				const firstCall = Array.isArray(parsed) ? parsed[0] : undefined
				diff = firstCall?.input?.diff || ""
			} catch (error) {
				outcomes.push({ resultId: record.result_id, success: false, error: `Failed to parse diff JSON: ${error}` })
				continue
			}
		}
		if (!diff) {
			outcomes.push({ resultId: record.result_id, success: false, error: "Missing diff content" })
			continue
		}
		try {
			await constructNewFileContentV2(diff, record.original, true)
			outcomes.push({ resultId: record.result_id, success: true })
		} catch (error) {
			outcomes.push({ resultId: record.result_id, success: false, error: (error as Error).message })
		}
	}

	const successCount = outcomes.filter((o) => o.success).length
	console.log(JSON.stringify({ total: outcomes.length, successCount, outcomes }, null, 2))
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
