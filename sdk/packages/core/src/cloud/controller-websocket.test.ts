import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { CloudSessionApi, type CloudSessionRecord } from "./api";
import { CloudSessionController } from "./controller";

/** Real REST and WS connections, including the cloud-header/local-Hub-auth boundary. */
describe("cloud REST and WebSocket integration", () => {
	it("refreshes Bearer auth, reconciles a real reconnect, and keeps two viewers' approvals consistent", async () => {
		let token = "first";
		const headers: string[] = [];
		const commands: string[] = [];
		let pendingApproval = false;
		let innerCreated = false;
		let finishFirstInput: (() => void) | undefined;
		let sequence = 0;
		const messages: unknown[] = [];
		const upstream = new WebSocketServer({
			port: 0,
			host: "127.0.0.1",
			handleProtocols: (protocols) =>
				protocols.has("cline-hub-auth.fixture")
					? "cline-hub-auth.fixture"
					: false,
		});
		await new Promise<void>((resolve) => upstream.once("listening", resolve));
		const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
		const event = (name: string, payload: unknown = {}) =>
			JSON.stringify({
				kind: "event",
				envelope: {
					version: "v1",
					event: name,
					eventId: `e-${++sequence}`,
					sequence,
					sessionId: "inner",
					timestamp: Date.now(),
					payload,
				},
			});
		const broadcast = (name: string, payload: unknown = {}) => {
			const frame = event(name, payload);
			for (const socket of upstream.clients)
				if (socket.readyState === WebSocket.OPEN) socket.send(frame);
		};
		upstream.on("connection", (socket, request) => {
			expect(request.headers["sec-websocket-protocol"]).toBe(
				"cline-hub-auth.fixture",
			);
			socket.on("message", (data) => {
				const frame = JSON.parse(data.toString());
				if (frame.kind === "subscribe") {
					if (pendingApproval)
						socket.send(
							event("approval.requested", {
								approvalId: "approval",
								toolCallId: "call",
								toolName: "run_commands",
								inputJson: '{"command":"true"}',
							}),
						);
					return;
				}
				if (frame.kind !== "command") return;
				const request = frame.envelope;
				commands.push(request.command);
				let payload: Record<string, unknown> = {};
				if (
					request.command === "session.get" ||
					request.command === "session.attach"
				)
					payload = {
						session: {
							sessionId: "inner",
							status: "idle",
							metadata: { model: "model" },
						},
					};
				if (request.command === "session.list")
					payload = {
						sessions: innerCreated
							? [
									{
										sessionId: "inner",
										status: "idle",
										metadata: { model: "model" },
									},
								]
							: [],
					};
				if (request.command === "session.create") {
					innerCreated = true;
					expect(request.payload.toolPolicies).toEqual({
						"*": { autoApprove: false },
					});
					payload = { sessionId: "inner" };
				}
				if (request.command === "session.messages") payload = { messages };
				if (request.command === "session.pending_prompts")
					payload = { prompts: [] };
				if (request.command === "session.send_input") {
					messages.push(
						{ role: "user", content: request.payload.prompt },
						{ role: "assistant", content: "Hosted answer" },
					);
					broadcast("run.started", {
						requestId: request.requestId,
						clientId: request.clientId,
					});
					broadcast("assistant.delta", { text: "Hosted answer" });
					broadcast("run.completed", { reason: "completed" });
					payload = {
						result: {
							text: "Hosted answer",
							finishReason: "completed",
							usage: { inputTokens: 1, outputTokens: 1 },
						},
					};
				}
				if (request.command === "approval.respond") {
					pendingApproval = false;
					broadcast("approval.resolved", { approvalId: "approval" });
				}
				const reply = () =>
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
				if (
					request.command === "session.send_input" &&
					request.payload.prompt === "Run remotely"
				)
					finishFirstInput = reply;
				else reply();
			});
		});
		let record: CloudSessionRecord = {
			id: "ses-fixture",
			status: "ready",
			sandboxUrl: "",
			repoContext: { repoUrl: "https://github.com/cline/test" },
			metadata: { modelId: "model", taskId: "inner" },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		const server = createServer(async (req, res) => {
			headers.push(String(req.headers.authorization));
			if (req.headers.authorization !== `Bearer ${token}`) {
				res.writeHead(401);
				res.end();
				return;
			}
			const json = (data: unknown) => {
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify({ success: true, data }));
			};
			if (req.method === "POST") {
				const chunks = [];
				for await (const chunk of req) chunks.push(chunk);
				const input = JSON.parse(Buffer.concat(chunks).toString());
				record = { ...record, title: input.title };
				json({ sessionId: record.id, status: "ready" });
				return;
			}
			json([record]);
		});
		const front = new WebSocketServer({ noServer: true });
		server.on("upgrade", (req, socket, head) => {
			headers.push(String(req.headers.authorization));
			if (
				req.headers.authorization !== `Bearer ${token}` ||
				req.headers["sec-websocket-protocol"]
			) {
				socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
				return;
			}
			front.handleUpgrade(req, socket, head, (client) => {
				const backend = new WebSocket(upstreamUrl, ["cline-hub-auth.fixture"]);
				const waiting: string[] = [];
				client.on("message", (data) => {
					if (backend.readyState === WebSocket.OPEN)
						backend.send(data.toString());
					else waiting.push(data.toString());
				});
				backend.on("open", () => {
					for (const frame of waiting) backend.send(frame);
				});
				backend.on("message", (data) => {
					if (client.readyState === WebSocket.OPEN)
						client.send(data.toString());
				});
				backend.on("error", () => client.close());
				client.on("error", () => backend.close());
				client.on("close", () => backend.close());
				backend.on("close", () => client.close());
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const apiBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const api = new CloudSessionApi({
			apiBaseUrl,
			appBaseUrl: apiBaseUrl,
			getAuthToken: async () => token,
		});
		const first = new CloudSessionController({
			api,
			apiBaseUrl,
			getAuthToken: async () => token,
		});
		const second = new CloudSessionController({
			api,
			apiBaseUrl,
			getAuthToken: async () => token,
		});
		try {
			const created = await first.create({
				requestId: "request",
				modelId: "model",
				repoUrl: record.repoContext.repoUrl!,
				autoApproveTools: false,
			});
			expect(created.sessionId).toBe(record.id);
			await first.attach(record.id);
			await first.readMessages(record.id);
			const accepted = vi.fn();
			first.subscribe((event) => {
				if (event.type === "prompt_accepted") accepted(event);
			});
			let completed = false;
			const sending = first.send(record.id, "Run remotely").then(() => {
				completed = true;
			});
			await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce());
			expect(completed).toBe(false);
			expect(accepted).toHaveBeenCalledWith({
				type: "prompt_accepted",
				sessionId: record.id,
				prompt: "Run remotely",
				delivery: undefined,
			});
			finishFirstInput?.();
			await sending;
			await second.attach(record.id);
			await second.readMessages(record.id);
			pendingApproval = true;
			broadcast("approval.requested", {
				approvalId: "approval",
				toolCallId: "call",
				toolName: "run_commands",
				inputJson: '{"command":"true"}',
			});
			await vi.waitFor(() =>
				expect(first.getSnapshot(record.id)?.approvals).toHaveLength(1),
			);
			await vi.waitFor(() =>
				expect(second.getSnapshot(record.id)?.approvals).toHaveLength(1),
			);
			await second.respondApproval(record.id, "approval", { approved: true });
			await vi.waitFor(() =>
				expect(first.getSnapshot(record.id)?.approvals).toEqual([]),
			);
			token = "rotated";
			for (const socket of front.clients) socket.terminate();
			await vi.waitFor(() => expect(headers).toContain("Bearer rotated"), {
				timeout: 5000,
			});
			await vi.waitFor(
				() => expect(first.getSnapshot(record.id)?.transcriptKnown).toBe(true),
				{ timeout: 5000 },
			);
			await first.readMessages(record.id);
			expect(first.getSnapshot(record.id)?.messages).toEqual(messages);
			expect(
				commands.filter((name) => name === "session.send_input"),
			).toHaveLength(1);
			const aborts = commands.filter((name) => name === "run.abort").length;
			await first.detach(record.id);
			expect(commands.filter((name) => name === "run.abort")).toHaveLength(
				aborts,
			);
			await second.send(record.id, "Still connected");
			expect(
				commands.filter((name) => name === "session.send_input"),
			).toHaveLength(2);
		} finally {
			await Promise.all([first.dispose(), second.dispose()]);
			for (const socket of front.clients) socket.terminate();
			for (const socket of upstream.clients) socket.terminate();
			await new Promise<void>((resolve) => front.close(() => resolve()));
			await new Promise<void>((resolve) => upstream.close(() => resolve()));
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
