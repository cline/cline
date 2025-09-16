#!/usr/bin/env ts-node

import fs from "fs"
import path from "path"
import "tsconfig-paths/register"

import { GrpcAdapter } from "@adapters/grpcAdapter"
import { NON_DETERMINISTIC_FIELDS } from "@harness/config"
import { Entry, SpecFile } from "@harness/types"
import { compareResponse, loadJson, retry } from "@harness/utils"

const STANDALONE_GRPC_SERVER_PORT = process.env.STANDALONE_GRPC_SERVER_PORT || "26040"
const FIX_MODE = process.argv.includes("--fix")

async function runSpec(specPath: string, grpcAdapter: GrpcAdapter) {
	const spec: SpecFile = loadJson(specPath)

	for (const entry of spec.entries) {
		console.log(`▶️ ${entry.service}.${entry.method}`)
		let actualResponse
		try {
			await retry(async () => {
				actualResponse = await grpcAdapter.call(entry.service, entry.method, entry.request)

				const { success, diffs } = compareResponse(actualResponse, entry?.response?.message, NON_DETERMINISTIC_FIELDS)

				if (!success) {
					const diffMsg = diffs.join("\n")
					throw new Error(`❌ Response mismatch! RequestID: ${entry.requestId}\n${diffMsg}`)
				} else {
					console.log("✅ Response matched! RequestID: %s", entry.requestId)
				}
			})
		} catch (err) {
			fixResponse(specPath, spec, entry, actualResponse)
			throw err
		}
	}
}

function fixResponse(specPath: string, spec: SpecFile, entry: Entry, actualResponse: any) {
	if (!FIX_MODE) {
		return
	}
	console.warn(`✏️ Updating response for RequestID: ${entry.requestId}`)
	entry.response.message = actualResponse
	fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n")
	console.log(`💾 Spec file updated: ${specPath}`)
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
		console.error("Usage: ts-node runSpecs.ts <spec-file-or-folder> [--fix]")
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
