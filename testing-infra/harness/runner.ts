import path from "path"
import { GrpcAdapter } from "../adapters/grpcAdapter"
import { compareResponse, loadJson } from "./utils"

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

async function runSpec(specPath: string) {
	const spec: SpecFile = loadJson(specPath)
	const grpcAdapter = new GrpcAdapter("localhost:26040")

	for (const entry of spec.entries) {
		console.log(`▶️ ${entry.service}.${entry.method}`)
		const response = await grpcAdapter.call(entry.service, entry.method, entry.request)

		const { success, diffs } = compareResponse(response, entry?.response?.message)
		if (!success) {
			console.error("❌ Response mismatch!")
			console.error(diffs.join("\n"))
			process.exit(1)
		}
		console.log("✅ Response matched!")
	}
}

async function main() {
	const specPath = process.argv[2]
	const fullSpecPath = path.resolve(specPath)
	await runSpec(fullSpecPath)
}

main()
