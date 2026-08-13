import type { Controller } from "@core/controller";
import { handleGrpcRequestCancel } from "@core/controller/grpc-handler";
import {
	type CoreConnectionMessage,
	CoreConnectionServiceClient,
} from "@generated/grpc-js/host/core_connection";
import * as grpc from "@grpc/grpc-js";
import { dispatchCoreConnectionRequest } from "./core-connection-dispatcher";
import { log } from "./utils";

export interface CoreConnection {
	close(): void;
}

export interface CoreConnectionCredentials {
	token: string;
	instanceId: string;
}

/**
 * Opens the core's authenticated reverse-RPC stream on the existing Host Bridge.
 * The stream is the core's readiness signal and remains owned by this process
 * until shutdown; Kotlin never needs to probe or reserve a second TCP port.
 */
export function connectCoreToHostBridge(
	controller: Controller,
	credentials: CoreConnectionCredentials,
): Promise<CoreConnection> {
	const address = requiredEnvironment("HOST_BRIDGE_ADDRESS");
	const client = new CoreConnectionServiceClient(
		address,
		grpc.credentials.createInsecure(),
		{
			"grpc.enable_http_proxy": 0,
			"grpc.max_receive_message_length": 256 * 1024 * 1024,
			"grpc.max_send_message_length": 256 * 1024 * 1024,
		},
	);
	const stream = client.connect();

	return new Promise((resolve, reject) => {
		let connected = false;
		let closed = false;

		const failStartup = (error: Error) => {
			if (!connected) {
				reject(error);
			}
		};

		stream.on("data", (message: CoreConnectionMessage) => {
			if (message.ready) {
				if (!connected) {
					connected = true;
					resolve({
						close() {
							closed = true;
							stream.end();
							client.close();
						},
					});
				}
				return;
			}
			const request = message.request;
			if (request) {
				void dispatchCoreConnectionRequest(
					controller,
					(message) => writeMessage(stream, message),
					request,
				).catch(async (error) => {
					log(`Core connection request dispatch failed: ${error}`);
					await writeMessage(stream, {
						response: {
							requestId: request.requestId,
							error: error instanceof Error ? error.message : String(error),
							completed: true,
						},
					});
				});
				return;
			}
			if (message.cancel) {
				void handleGrpcRequestCancel(async () => true, {
					request_id: message.cancel.requestId,
				});
			}
		});
		stream.once("error", (error) => {
			failStartup(error);
			if (connected && !closed) {
				log(`Core connection failed: ${error.message}`);
				process.exit(1);
			}
		});
		stream.once("end", () => {
			failStartup(
				new Error("Host Bridge closed the core connection during startup"),
			);
			if (connected && !closed) {
				log("Host Bridge closed the active core connection");
				process.exit(1);
			}
		});

		stream.write({ hello: credentials }, (error?: Error | null) => {
			if (error) {
				failStartup(error);
			}
		});
	});
}

function writeMessage(
	stream: grpc.ClientDuplexStream<CoreConnectionMessage, CoreConnectionMessage>,
	message: CoreConnectionMessage,
): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.write(message, (error?: Error | null) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required for the external core connection`);
	}
	return value;
}
