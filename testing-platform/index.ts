#!/usr/bin/env ts-node
import "tsconfig-paths/register"

import { GrpcAdapter } from "@adapters/grpcAdapter"
import { NON_DETERMINISTIC_FIELDS } from "@harness/config"
import { SpecFile } from "@harness/types"
import { compareResponse, loadJson } from "@harness/utils"
import fs from "fs"
import path from "path"

const STANDALONE_GRPC_SERVER_PORT = process.env.STANDALONE_GRPC_SERVER_PORT || "26040"

async function runSpec(specPath: string, grpcAdapter: GrpcAdapter) {
	const spec: SpecFile = loadJson(specPath)

	for (const entry of spec.entries) {
		console.log(`▶️ ${entry.service}.${entry.method}`)
		await new Promise((resolve) => setTimeout(resolve, 50))
		const response = await grpcAdapter.call(entry.service, entry.method, entry.request)

		const { success, diffs } = compareResponse(response, entry?.response?.message, NON_DETERMINISTIC_FIELDS)
		if (!success) {
			console.error("❌ Response mismatch! RequestID: %s", entry.requestId)
			console.error(diffs.join("\n"))
			process.exit(1)
		}
		console.log("✅ Response matched! RequestID: %s", entry.requestId)
	}
}

async function runSpecsFromFolder(folderPath: string, grpcAdapter: GrpcAdapter) {
	const files = fs.readdirSync(folderPath).filter((f) => f.endsWith(".json"))

	if (files.length === 0) {
		console.warn(`⚠️ No JSON spec files found in ${folderPath}`)
		return
	}

	for (const file of files) {
		const fullPath = path.join(folderPath, file)
		console.log(`\n📂 Running spec file: ${file}`)
		await runSpec(fullPath, grpcAdapter)
	}
}

async function main() {
	const inputPath = process.argv[2]
	if (!inputPath) {
		console.error("Usage: ts-node runSpecs.ts <spec-file-or-folder>")
		process.exit(1)
	}

	const fullPath = path.resolve(inputPath)
	const grpcAdapter = new GrpcAdapter(`localhost:${STANDALONE_GRPC_SERVER_PORT}`)

	const stat = fs.statSync(fullPath)
	if (stat.isDirectory()) {
		await runSpecsFromFolder(fullPath, grpcAdapter)
	} else {
		await runSpec(fullPath, grpcAdapter)
	}

	grpcAdapter.close()
}

main().catch((err) => {
	console.error("❌ Fatal error:", err)
	process.exit(1)
})
