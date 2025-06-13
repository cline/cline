import * as fs from "fs"
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as health from "grpc-health-check"

const log = (...args: unknown[]) => {
	const timestamp = new Date().toISOString()
	console.log(`[${timestamp}]`, "#bot.cline.server.ts", ...args)
}

function getPackageDefinition() {
	// Load service definitions.
	const descriptorSet = fs.readFileSync("proto/descriptor_set.pb")
	const clineDef = protoLoader.loadFileDescriptorSetFromBuffer(descriptorSet)
	const healthDef = protoLoader.loadSync(health.protoPath)
	const packageDefinition = { ...clineDef, ...healthDef }
	return packageDefinition
}
export { getPackageDefinition, log }
