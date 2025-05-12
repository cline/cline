import * as fs from "fs"
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as health from "grpc-health-check"

import { ProtoGrpcType } from "../../dist/proto/account"

const log = (...args: unknown[]) => {
	const timestamp = new Date().toISOString()
	console.log(`[${timestamp}]`, "#bot.cline.server.ts", ...args)
}

// Load service definitions.
const clineDef = protoLoader.loadFileDescriptorSetFromBuffer(fs.readFileSync("proto/descriptor_set.pb"))
const healthDef = protoLoader.loadSync(health.protoPath)
const packageDefinition = { ...clineDef, ...healthDef }
const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoGrpcType

export { packageDefinition, proto, log }
