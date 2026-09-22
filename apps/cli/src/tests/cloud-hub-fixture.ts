import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

type Command = {
	command: string;
	requestId: string;
	clientId: string;
	payload: Record<string, unknown>;
};

/** A stateful remote Hub fixture reached by the actual CLI over a real socket. */
export function attachCloudHubFixture(server: Server, newSession = false) {
	const hub = new WebSocketServer({ noServer: true });
	const commands: Command[] = [];
	const connections: Array<{ path: string; authorization?: string }> = [];
	const messages: Array<{ role: string; content: unknown }> = [];
	let prompts: Array<{ id: string; prompt: string; delivery: string }> = [];
	let running = false;
	let innerCreated = !newSession;
	let sequence = 0;
	let finishInput: (() => void) | undefined;
	const event = (name: string, payload: unknown) => {
		const frame = JSON.stringify({
			kind: "event",
			envelope: {
				version: "v1",
				event: name,
				eventId: `fixture-${++sequence}`,
				sequence,
				sessionId: "fixture-inner",
				timestamp: Date.now(),
				payload,
			},
		});
		for (const socket of hub.clients)
			if (socket.readyState === WebSocket.OPEN) socket.send(frame);
	};
	server.on("upgrade", (request, socket, head) => {
		connections.push({
			path: request.url ?? "",
			authorization: request.headers.authorization,
		});
		if (request.headers.authorization !== "Bearer fixture-cloud-token") {
			socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
			return;
		}
		hub.handleUpgrade(request, socket, head, (client) =>
			hub.emit("connection", client),
		);
	});
	hub.on("connection", (socket) => {
		socket.on("message", (data) => {
			const frame = JSON.parse(data.toString());
			if (frame.kind !== "command") return;
			const request = frame.envelope as Command;
			commands.push(request);
			const reply = (payload: unknown = {}) => {
				if (socket.readyState !== WebSocket.OPEN) return;
				socket.send(
					JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							requestId: request.requestId,
							ok: true,
							payload,
						},
					}),
				);
			};
			switch (request.command) {
				case "session.list":
					reply({
						sessions: innerCreated
							? [
									{
										sessionId: "fixture-inner",
										status: "idle",
										metadata: { model: "fixture-model" },
									},
								]
							: [],
					});
					return;
				case "session.create":
					innerCreated = true;
					if (Array.isArray(request.payload.initialMessages)) {
						messages.splice(
							0,
							messages.length,
							...structuredClone(request.payload.initialMessages),
						);
					}
					reply({ sessionId: "fixture-inner" });
					return;
				case "client.register":
					reply();
					return;
				case "session.get":
				case "session.attach":
					reply({
						session: {
							sessionId: "fixture-inner",
							status: running ? "running" : "idle",
							metadata: { model: "fixture-model" },
						},
					});
					return;
				case "session.messages":
					reply({ messages });
					return;
				case "session.pending_prompts":
					reply({ prompts });
					return;
				case "session.send_input": {
					const prompt = String(request.payload.prompt);
					if (request.payload.delivery === "queue") {
						prompts.push({ id: "fixture-queued", prompt, delivery: "queue" });
						event("session.pending_prompts", { prompts });
						reply({});
						return;
					}
					running = true;
					messages.push({ role: "user", content: prompt });
					event("run.started", {
						requestId: request.requestId,
						clientId: request.clientId,
					});
					event("assistant.delta", { text: "Working on the remote fixture." });
					messages.push({
						role: "assistant",
						content: "Working on the remote fixture.",
					});
					finishInput = () =>
						reply({
							result: {
								text: "Stopped",
								finishReason: "aborted",
								usage: { inputTokens: 1, outputTokens: 1 },
							},
						});
					return;
				}
				case "approval.respond":
					event("approval.resolved", {
						approvalId: request.payload.approvalId,
					});
					reply();
					return;
				case "session.remove_pending_prompt":
					prompts = [];
					event("session.pending_prompts", { prompts });
					reply({ prompts });
					return;
				case "run.abort":
					running = false;
					event("run.aborted", {});
					finishInput?.();
					reply();
					return;
				default:
					socket.send(
						JSON.stringify({
							kind: "reply",
							envelope: {
								version: "v1",
								requestId: request.requestId,
								ok: false,
								error: { code: "unknown_command", message: request.command },
							},
						}),
					);
			}
		});
	});
	return {
		commands,
		messages,
		connections,
		event,
		disconnect: () => {
			for (const socket of hub.clients) socket.terminate();
		},
		close: async () => {
			for (const socket of hub.clients) socket.terminate();
			await new Promise<void>((resolve) => hub.close(() => resolve()));
		},
	};
}
