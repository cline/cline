const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")
const { ReflectionService } = require("@grpc/reflection")
const health = require("grpc-health-check")
const extension = require("./extension.js")

const packageDefinition = protoLoader.loadSync([
	health.protoPath,
	// __PROTO_FILES__
])
const proto = grpc.loadPackageDefinition(packageDefinition)

const log = (...args) => {
	const timestamp = new Date().toISOString()
	console.log(`[${timestamp}]`, "#bot.cline.server.js", ...args)
}

function wrapHandler(handler) {
	return async (call, callback) => {
		try {
			log("gRPC request:", call.path)
			const result = await handler(controller)
			callback(null, result)
		} catch (err) {
			log(`gRPC handler error: ${call.path}\n${err.stack}`)
			callback({
				code: grpc.status.INTERNAL,
				message: err.message || "Internal error",
			})
		}
	}
}

function postMessage(message) {
	log("postMessage called:", message)
	return Promise.resolve(true)
}

log("Starting service...")

extension.activate(vscode.ExtensionContext)
const controller = new extension.Controller(vscode.ExtensionContext, vscode.OutputChannel, postMessage)
const server = new grpc.Server()

const healthImpl = new health.HealthImplementation({ "": "SERVING" })
healthImpl.addToServer(server)

// __HANDLERS__

const reflection = new ReflectionService(packageDefinition)
reflection.addToServer(server)

server.bindAsync("127.0.0.1:50051", grpc.ServerCredentials.createInsecure(), (err) => {
	if (err) {
		log("Error: Failed to bind to port 50051, port may be unavailable", err.message)
		process.exit(1)
	} else {
		log("gRPC server listening on", "127.0.0.1:50051")
	}
})
