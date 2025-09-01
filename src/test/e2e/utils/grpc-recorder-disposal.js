/**
 * CommonJS wrapper for gRPC recorder disposal to avoid ES module import issues in e2e tests.
 * This file uses CommonJS syntax to be compatible with the Node.js environment used by Playwright tests.
 */

async function disposeGrpcRecorder() {
	try {
		// Use dynamic import to load the compiled ES module from the out directory
		const { GrpcRecorder } = await import("../../../../out/src/core/controller/grpc-recorder.js")
		GrpcRecorder.dispose()
		console.log("gRPC recorder disposed")
	} catch (error) {
		// Don't throw error if the module can't be loaded - this is expected in some test environments
		console.warn("Could not dispose gRPC recorder:", error.message)
	}
}

module.exports = {
	disposeGrpcRecorder,
}
