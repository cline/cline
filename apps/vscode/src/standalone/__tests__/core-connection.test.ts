import type { CoreConnectionMessage } from "@generated/grpc-js/host/core_connection";
import { expect } from "chai";
import { describe, it } from "mocha";
import { dispatchCoreConnectionRequest } from "../core-connection-protocol";

describe("core connection dispatcher", () => {
	it("forwards unary controller results and completes the request", async () => {
		const stream = fakeStream();

		await dispatchCoreConnectionRequest(
			stream.write,
			request("unary-1", false),
			() => false,
			async (postMessage) => {
				await postMessage({
					type: "grpc_response",
					grpc_response: { request_id: "unary-1", message: { value: "ok" } },
				});
			},
		);

		expect(stream.messages).to.deep.equal([
			{
				response: {
					requestId: "unary-1",
					messageJson: '{"value":"ok"}',
					error: undefined,
					completed: true,
				},
			},
		]);
	});

	it("keeps streams open until the controller marks the final response", async () => {
		const stream = fakeStream();

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
				});
				await postMessage({
					type: "grpc_response",
					grpc_response: {
						request_id: "stream-1",
						message: { value: 2 },
						is_streaming: false,
					},
				});
			},
		);

		expect(
			stream.messages.map((message) => message.response?.completed),
		).to.deep.equal([false, true]);
	});

	it("rejects a caller streaming mode that disagrees with generated metadata", async () => {
		const stream = fakeStream();

		await dispatchCoreConnectionRequest(
			stream.write,
			request("bad-mode", true),
			() => false,
			async () => {},
		);

		expect(stream.messages[0]?.response?.error).to.contain(
			"streaming mode does not match",
		);
		expect(stream.messages[0]?.response?.completed).to.equal(true);
	});
});

function fakeStream(): {
	messages: CoreConnectionMessage[];
	write(message: CoreConnectionMessage): Promise<void>;
} {
	const messages: CoreConnectionMessage[] = [];
	return {
		messages,
		write: async (message) => {
			messages.push(message);
		},
	};
}

function request(requestId: string, isStreaming: boolean) {
	return {
		requestId,
		service: "cline.TestService",
		method: isStreaming ? "testStreaming" : "testUnary",
		messageJson: "{}",
		isStreaming,
	};
}
