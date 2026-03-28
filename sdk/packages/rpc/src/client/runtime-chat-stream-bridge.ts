import { createInterface } from "node:readline";
import { RpcRuntimeChatClient } from "./runtime-chat-client";
import {
	createRpcRuntimeStreamRelay,
	type RpcRuntimeBridgeStreamLine,
} from "./runtime-chat-stream-relay";

export type RpcRuntimeBridgeControlLine =
	| {
			type: "set_sessions";
			sessionIds: string[];
	  }
	| {
			type: "shutdown";
	  };

export type RpcRuntimeBridgeOutputLine =
	| {
			type: "ready";
	  }
	| RpcRuntimeBridgeStreamLine;

export async function runRpcRuntimeEventBridge(options: {
	clientId: string;
	writeLine: (line: RpcRuntimeBridgeOutputLine) => void;
}): Promise<void> {
	const client = new RpcRuntimeChatClient();
	const relay = createRpcRuntimeStreamRelay({
		client,
		clientId: options.clientId,
		writeLine: options.writeLine,
	});

	options.writeLine({ type: "ready" });

	await new Promise<void>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stderr,
			terminal: false,
		});

		const shutdown = () => {
			relay.stop();
			client.close();
			resolve();
		};

		rl.on("line", (line) => {
			const trimmed = line.trim();
			if (!trimmed) {
				return;
			}
			let parsed: RpcRuntimeBridgeControlLine;
			try {
				parsed = JSON.parse(trimmed) as RpcRuntimeBridgeControlLine;
			} catch {
				options.writeLine({
					type: "error",
					message: "invalid bridge control json",
				});
				return;
			}
			if (parsed.type === "set_sessions") {
				relay.applySessions(parsed.sessionIds ?? []);
				return;
			}
			if (parsed.type === "shutdown") {
				rl.close();
			}
		});

		rl.on("close", shutdown);
	});
}
