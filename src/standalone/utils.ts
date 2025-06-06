import * as fs from "fs"
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import * as health from "grpc-health-check"

const log = (...args: unknown[]) => {
	const timestamp = new Date().toISOString()
	console.log(`[${timestamp}]`, "#bot.cline.server.ts", ...args)
}

// Load service definitions.
const descriptorSet = fs.readFileSync("proto/descriptor_set.pb")
const clineDef = protoLoader.loadFileDescriptorSetFromBuffer(descriptorSet)
const healthDef = protoLoader.loadSync(health.protoPath)
const packageDefinition = { ...clineDef, ...healthDef }
const proto = grpc.loadPackageDefinition(packageDefinition) as unknown

// Helper function to convert camelCase to snake_case
function camelToSnakeCase(obj: any): any {
	if (obj === null || typeof obj !== "object") {
		return obj
	}

	if (Array.isArray(obj)) {
		return obj.map(camelToSnakeCase)
	}

	return Object.keys(obj).reduce((acc: any, key: string) => {
		// Convert key from camelCase to snake_case
		const snakeKey = key
			.replace(/([A-Z])/g, "_$1")
			.replace(/^_+/, "")
			.toLowerCase()

		// Convert value recursively if it's an object
		const value = obj[key]
		acc[snakeKey] = camelToSnakeCase(value)

		return acc
	}, {})
}

// Helper function to convert snake_case to camelCase
function snakeToCamelCase(obj: any): any {
	if (obj === null || typeof obj !== "object") {
		return obj
	}

	if (Array.isArray(obj)) {
		return obj.map(snakeToCamelCase)
	}

	return Object.keys(obj).reduce((acc: any, key: string) => {
		// Convert key from snake_case to camelCase
		const camelKey = key.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase())

		// Convert value recursively if it's an object
		const value = obj[key]
		acc[camelKey] = snakeToCamelCase(value)

		return acc
	}, {})
}

export { packageDefinition, proto, log, camelToSnakeCase, snakeToCamelCase }
