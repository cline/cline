import path from "path"
import { GrpcAdapter } from "../adapters/grpcAdapter"
import { compareGolden, loadJson } from "./utils"

interface Entry {
	requestId: string
	service: string
	method: string
	request: any
	response?: any
	status: string
}

interface SpecFile {
	startTime: string
	entries: Entry[]
}

async function runSpec(specPath: string, goldenPath?: string) {
	const spec: SpecFile = loadJson(specPath)

	// Example: assume extension core runs on localhost:26040
	const grpcAdapter = new GrpcAdapter("localhost:26040")

	const actualResponses: any[] = []

	for (const entry of spec.entries) {
		console.log(`▶️ ${entry.service}.${entry.method}`)
		const response = await grpcAdapter.call(entry.service, entry.method, entry.request)
		actualResponses.push(response)
	}

	if (goldenPath) {
		const golden = loadJson(goldenPath)
		const { success, diffs } = compareGolden({ responses: actualResponses }, golden)
		if (!success) {
			console.error("❌ Golden mismatch!")
			console.error(diffs.join("\n"))
			process.exit(1)
		}
		console.log("✅ Golden matched!")
	} else {
		console.log("No golden file provided, printing actual responses:")
		console.log(JSON.stringify({ responses: actualResponses }, null, 2))
	}
}

async function main() {
	const specPath = process.argv[2]
	const goldenPath = process.argv[3]
	if (!specPath) {
		console.error("Usage: ts-node runner.ts <specPath> [goldenPath]")
		process.exit(1)
	}

	const fullSpecPath = path.resolve(specPath)
	const fullGoldenPath = goldenPath ? path.resolve(goldenPath) : undefined

	await runSpec(fullSpecPath, fullGoldenPath)
}

main()
