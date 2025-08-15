import * as fs from "fs"
import * as protoLoader from "@grpc/proto-loader"
import * as health from "grpc-health-check"
import { StreamingCallbacks } from "@/hosts/host-provider-types"

const log = (...args: unknown[]) => {
	const now = new Date()
	const year = now.getFullYear()
	const month = String(now.getMonth() + 1).padStart(2, "0")
	const day = String(now.getDate()).padStart(2, "0")
	const hours = String(now.getHours()).padStart(2, "0")
	const minutes = String(now.getMinutes()).padStart(2, "0")
	const seconds = String(now.getSeconds()).padStart(2, "0")
	const milliseconds = String(now.getMilliseconds()).padStart(3, "0")

	const timestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`

	console.log(`[${timestamp}]`, "#bot.cline.server.ts", ...args)
}

function getPackageDefinition() {
	// Load service definitions.
	const descriptorSet = fs.readFileSync("proto/descriptor_set.pb")
	const options = { longs: Number } // Encode int64 fields as numbers
	const descriptorDefs = protoLoader.loadFileDescriptorSetFromBuffer(descriptorSet, options)
	const healthDef = protoLoader.loadSync(health.protoPath)
	const packageDefinition = { ...descriptorDefs, ...healthDef }
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
