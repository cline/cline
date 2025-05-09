const grpc = require("@grpc/grpc-js")
// __IMPORTS__
const extension = require("./extension.js")

const log = (...args) => {
	const timestamp = new Date().toISOString()
	console.log(`[${timestamp}]`, "#bot.cline.server.js", ...args)
}

function wrapHandler(fn) {
	return async (call, callback) => {
		try {
			const result = await fn(controller)
			callback(null, result)
		} catch (err) {
			log("Handler error:", err)
			callback({
				code: grpc.status.UNKNOWN,
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

// __HANDLERS__

server.bindAsync("127.0.0.1:50051", grpc.ServerCredentials.createInsecure(), (err) => {
	if (err) {
		log("Error: Failed to bind to port 50051, port may be unavailable", err.message)
	} else {
		log("gRPC server listening on", "127.0.0.1:50051")
	}
})
