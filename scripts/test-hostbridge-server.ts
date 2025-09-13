#!/usr/bin/env npx tsx
import * as grpc from "@grpc/grpc-js"
import { ReflectionService } from "@grpc/reflection"
import * as health from "grpc-health-check"
import * as os from "os"
import { host } from "src/generated/grpc-js/index"
import { getPackageDefinition } from "./proto-utils.mjs"

export async function startTestHostBridgeServer() {
	const server = new grpc.Server()

	// Set up health check
	const healthImpl = new health.HealthImplementation({ "": "SERVING" })
	healthImpl.addToServer(server)

	// Add host bridge services using the mock implementations
	server.addService(host.WorkspaceServiceService, createMockService<host.WorkspaceServiceServer>("WorkspaceService"))
	server.addService(host.WindowServiceService, createMockService<host.WindowServiceServer>("WindowService"))
	server.addService(host.EnvServiceService, createMockService<host.EnvServiceServer>("EnvService"))
	server.addService(host.DiffServiceService, createMockService<host.DiffServiceServer>("DiffService"))
	server.addService(host.WatchServiceService, createMockService<host.WatchServiceServer>("WatchService"))

	// Load package definition for reflection service
	const packageDefinition = await getPackageDefinition()
	// Filter service names to only include host services
	const hostBridgeServiceNames = Object.keys(packageDefinition).filter(
		(name) => name.startsWith("host.") || name.startsWith("grpc.health"),
	)
	const reflection = new ReflectionService(packageDefinition, {
		services: hostBridgeServiceNames,
	})
	reflection.addToServer(server)

	const bindAddress = process.env.HOST_BRIDGE_ADDRESS || `127.0.0.1:26041`

	server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (err) => {
		if (err) {
			console.error(`Failed to bind test host bridge server to ${bindAddress}:`, err)
			process.exit(1)
		}
		server.start()
		console.log(`Test HostBridge gRPC server listening on ${bindAddress}`)
	})
}

/**
 * Creates a mock gRPC service implementation using Proxy
 * @param serviceName Name of the service for logging
 * @returns A proxy that implements the service interface
 */
function createMockService<T extends grpc.UntypedServiceImplementation>(serviceName: string): T {
	const handler: ProxyHandler<T> = {
		get(_target, prop) {
			// Return a function that handles the gRPC call
			return (call: any, callback: any) => {
				console.log(`Hostbridge: ${serviceName}.${String(prop)} called with:`, call.request)

				// Special cases that need specific return values
				switch (prop) {
					case "getWorkspacePaths":
						callback(null, {
							paths: ["/test-workspace"],
						})
						return

					case "getMachineId":
						callback(null, {
							value: "fake-machine-id-" + os.hostname(),
						})
						return

					case "clipboardReadText":
						callback(null, {
							value: "",
						})
						return

					case "getWebviewHtml":
						callback(null, {
							html: "<html><body>Fake Webview</body></html>",
						})
						return

					case "showTextDocument":
						callback(null, {
							document_path: call.request?.path || "",
							view_column: 1,
							is_active: true,
						})
						return

					case "openDiff":
						callback(null, {
							diff_id: "fake-diff-" + Date.now(),
						})
						return

					case "getDocumentText":
						callback(null, {
							content: "",
						})
						return

					case "getOpenTabs":
					case "getVisibleTabs":
					case "showOpenDialogue":
						callback(null, {
							paths: [],
						})
						return

					case "getDiagnostics":
						callback(null, {
							file_diagnostics: [],
						})
						return

					// For streaming methods (like subscribeToFile)
					case "subscribeToFile":
						// Just end the stream immediately
						call.end()
						return
				}

				// Default: return empty object for all other methods
				callback(null, {})
			}
		},
	}

	return new Proxy({} as T, handler)
}

if (require.main === module) {
	startTestHostBridgeServer().catch((err) => {
		console.error("Failed to start test host bridge server:", err)
		process.exit(1)
	})
}
