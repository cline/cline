import * as fs from "fs/promises"
import * as path from "path"

/**
 * Parse proto files to extract service definitions
 * @param {string[]} protoFilePaths - Array of proto file paths
 * @param {string} protoDir - Base proto directory
 * @returns {Promise<Object>} Services object with service definitions
 */
export async function parseProtoForServices(protoFilePaths, protoDir) {
	const services = {}

	for (const protoFilePath of protoFilePaths) {
		const content = await fs.readFile(path.join(protoDir, protoFilePath), "utf8")
		const serviceMatches = content.matchAll(/service\s+(\w+Service)\s*\{([\s\S]*?)\}/g)

		// Determine proto package from file path
		const protoPackage = protoFilePath.startsWith("host/") ? "host" : "cline"

		for (const serviceMatch of serviceMatches) {
			const serviceName = serviceMatch[1]
			const serviceKey = serviceName.replace("Service", "").toLowerCase()
			const serviceBody = serviceMatch[2]
			const methodMatches = serviceBody.matchAll(
				/rpc\s+(\w+)\s*\((stream\s)?([\w.]+)\)\s*returns\s*\((stream\s)?([\w.]+)\)/g,
			)

			const methods = []
			for (const methodMatch of methodMatches) {
				methods.push({
					name: methodMatch[1],
					requestType: methodMatch[3],
					responseType: methodMatch[5],
					isRequestStreaming: !!methodMatch[2],
					isResponseStreaming: !!methodMatch[4],
				})
			}
			services[serviceKey] = { name: serviceName, methods, protoPackage }
		}
	}
	return services
}

/**
 * Create service name map from parsed services
 * @param {Object} services - Services object from parseProtoForServices
 * @returns {Object} Service name map
 */
export function createServiceNameMap(services) {
	const serviceNameMap = {}
	for (const [serviceKey, serviceDef] of Object.entries(services)) {
		const packagePrefix = serviceDef.protoPackage === "host" ? "host" : "cline"
		serviceNameMap[serviceKey] = `${packagePrefix}.${serviceDef.name}`
	}
	return serviceNameMap
}

/**
 * Log message only if verbose flag is set
 * @param {string} message - Message to log
 */
export function logVerbose(message) {
	if (process.argv.includes("-v") || process.argv.includes("--verbose")) {
		console.log(message)
	}
}
