import { GrpcAdapter } from "@adapters/grpcAdapter"
import { compareResponse, loadJson } from "@harness/utils"
import path from "path"

const STANDALONE_GRPC_SERVER_PORT = process.env.HOSTBRIDGE_PORT || "26040"

async function runSpec(specPath: string) {
	const spec: SpecFile = loadJson(specPath)
	const grpcAdapter = new GrpcAdapter(`localhost:${STANDALONE_GRPC_SERVER_PORT}`)

	for (const entry of spec.entries) {
		console.log(`▶️ ${entry.service}.${entry.method}`)
		const response = await grpcAdapter.call(entry.service, entry.method, entry.request)

		const { success, diffs } = compareResponse(response, entry?.response?.message)
		if (!success) {
			console.error("❌ Response mismatch! RequestID: %s", entry.requestId)
			console.error(diffs.join("\n"))
			process.exit(1)
		}
		console.log("✅ Response matched! RequestID: %s", entry.requestId)
	}
}

async function main() {
	const specPath = process.argv[2]
	const fullSpecPath = path.resolve(specPath)
	await runSpec(fullSpecPath)
}

main()
