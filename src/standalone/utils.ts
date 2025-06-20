import * as fs from "fs"
import * as protoLoader from "@grpc/proto-loader"
import * as health from "grpc-health-check"
import { StreamingCallbacks } from "@/hosts/host-provider-types"

const log = (...args: unknown[]) => {
	const timestamp = new Date().toISOString()
	console.log(`[${timestamp}]`, "#bot.cline.server.ts", ...args)
}

function getPackageDefinition() {
	// Load service definitions.
	const descriptorSet = fs.readFileSync("proto/descriptor_set.pb")
	const allDefs = protoLoader.loadFileDescriptorSetFromBuffer(descriptorSet)

	// Log all keys to see what's in the descriptor set
	console.log("All keys in descriptor set:", Object.keys(allDefs).join(", "))

	// Filter to only include entries from the cline package
	const clineDef: Record<string, any> = {}
	for (const [key, value] of Object.entries(allDefs)) {
		if (key.startsWith("cline.")) {
			clineDef[key] = value
		}
	}

	// Log the filtered keys
	console.log("Filtered keys:", Object.keys(clineDef).join(", "))

	const healthDef = protoLoader.loadSync(health.protoPath)
	const packageDefinition = { ...clineDef, ...healthDef }

	// Log the final package definition keys
	console.log("Final package definition keys:", Object.keys(packageDefinition).join(", "))

	return packageDefinition
}

/**
 * Converts an AsyncIterable to a callback-based API
 * @param stream The AsyncIterable stream to process
 * @param callbacks The callbacks to invoke for stream events
 */
async function asyncIteratorToCallbacks<T>(stream: AsyncIterable<T>, callbacks: StreamingCallbacks<T>): Promise<void> {
	try {
		// Process each item in the stream
		for await (const response of stream) {
			callbacks.onResponse && callbacks.onResponse(response)
		}
		// Stream completed successfully
		callbacks.onComplete && callbacks.onComplete()
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err))
		if (callbacks.onError) {
			callbacks.onError(error)
		} else {
			log(`Host bridge RPC error: ${error}`)
		}
	}
}

export { getPackageDefinition, log, asyncIteratorToCallbacks }
