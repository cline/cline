import { type CoreConnectionMessage, CoreConnectionServiceService } from "@generated/grpc-js/host/core_connection"
import * as grpc from "@grpc/grpc-js"
import { expect } from "chai"
import { describe, it } from "mocha"
import { dispatchCoreConnectionRequest } from "../core-connection-protocol"
import { connectCoreStream } from "../core-connection-stream"

describe("core connection dispatcher", () => {
	it("forwards unary controller results and completes the request", async () => {
		const stream = fakeStream()

		await dispatchCoreConnectionRequest(
			stream.write,
			request("unary-1", false),
			() => false,
			async (postMessage) => {
				await postMessage({
					type: "grpc_response",
					grpc_response: { request_id: "unary-1", message: { value: "ok" } },
				})
			},
		)

		const response = stream.messages[0]?.response
		expect(response?.requestId).to.equal("unary-1")
		expect(new TextDecoder().decode(response?.messageJsonChunk)).to.equal('{"value":"ok"}')
		expect(response?.messageJsonComplete).to.equal(true)
		expect(response?.completed).to.equal(true)
	})

	it("keeps streams open until the controller marks the final response", async () => {
		const stream = fakeStream()

		await dispatchCoreConnectionRequest(
			stream.write,
			request("stream-1", true),
			() => true,
			async (postMessage) => {
				await postMessage({
					type: "grpc_response",
					grpc_response: {
						request_id: "stream-1",
						message: { value: 1 },
						is_streaming: true,
					},
				})
				await postMessage({
					type: "grpc_response",
					grpc_response: {
						request_id: "stream-1",
						message: { value: 2 },
						is_streaming: false,
					},
				})
			},
		)

		expect(stream.messages.map((message) => message.response?.completed)).to.deep.equal([false, true])
	})

	it("rejects a caller streaming mode that disagrees with generated metadata", async () => {
		const stream = fakeStream()

		await dispatchCoreConnectionRequest(
			stream.write,
			request("bad-mode", true),
			() => false,
			async () => {},
		)

		expect(stream.messages[0]?.response?.error).to.contain("streaming mode does not match")
		expect(stream.messages[0]?.response?.completed).to.equal(true)
	})

	it("splits large controller payloads into bounded ordered chunks", async () => {
		const stream = fakeStream()
		const value = "x".repeat(2 * 1024 * 1024)

		await dispatchCoreConnectionRequest(
			stream.write,
			request("large", false),
			() => false,
			async (postMessage) => {
				await postMessage({
					type: "grpc_response",
					grpc_response: { request_id: "large", message: { value } },
				})
			},
		)

		expect(stream.messages.length).to.be.greaterThan(2)
		expect(stream.messages.every((message) => (message.response?.messageJsonChunk?.length ?? 0) <= 1024 * 1024)).to.equal(
			true,
		)
		expect(stream.messages.slice(0, -1).every((message) => !message.response?.completed)).to.equal(true)
		expect(stream.messages.at(-1)?.response?.messageJsonComplete).to.equal(true)
		expect(stream.messages.at(-1)?.response?.completed).to.equal(true)
	})

	it("reports active stream loss exactly once", async () => {
		const server = new grpc.Server()
		server.addService(CoreConnectionServiceService, {
			connect(stream: grpc.ServerDuplexStream<CoreConnectionMessage, CoreConnectionMessage>) {
				stream.once("data", () => {
					stream.write({ ready: {} })
					stream.end()
				})
			},
		})
		const port = await bind(server)
		try {
			let disconnects = 0
			let resolveDisconnect!: () => void
			const disconnected = new Promise<void>((resolve) => {
				resolveDisconnect = resolve
			})
			await connectCoreStream(
				`127.0.0.1:${port}`,
				{ token: "token", instanceId: "instance" },
				{ onRequest: async () => {}, onCancel: () => {} },
				() => {
					disconnects += 1
					resolveDisconnect()
				},
			)
			await disconnected
			expect(disconnects).to.equal(1)
		} finally {
			server.forceShutdown()
		}
	})
})

function bind(server: grpc.Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) =>
			error ? reject(error) : resolve(port),
		)
	})
}

function fakeStream(): {
	messages: CoreConnectionMessage[]
	write(message: CoreConnectionMessage): Promise<void>
} {
	const messages: CoreConnectionMessage[] = []
	return {
		messages,
		write: async (message) => {
			messages.push(message)
		},
	}
}

function request(requestId: string, isStreaming: boolean) {
	return {
		requestId,
		service: "cline.TestService",
		method: isStreaming ? "testStreaming" : "testUnary",
		messageJson: "{}",
		isStreaming,
	}
}
