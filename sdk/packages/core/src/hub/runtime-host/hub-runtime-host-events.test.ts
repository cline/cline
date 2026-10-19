import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { HubRuntimeHost } from "./hub-runtime-host";

it("delivers overlapping catalog and session wire events once", async () => {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await once(server, "listening");
	const streams = new Set<string>();
	server.on("connection", (socket) => {
		socket.on("message", (raw) => {
			const frame = JSON.parse(String(raw));
			if (frame.kind === "stream.subscribe")
				streams.add(frame.sessionId ?? "global");
			if (frame.kind === "stream.unsubscribe")
				streams.delete(frame.sessionId ?? "global");
			if (frame.kind !== "command") return;
			const request = frame.envelope as HubCommandEnvelope;
			socket.send(
				JSON.stringify({
					kind: "reply",
					envelope: {
						version: "v1",
						requestId: request.requestId,
						ok: true,
						payload:
							request.command === "session.create"
								? {
										session: {
											sessionId: "sess-1",
											status: "running",
											createdAt: Date.now(),
											updatedAt: Date.now(),
										},
									}
								: {},
					},
				}),
			);
		});
	});
	const host = new HubRuntimeHost({
		url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/hub`,
	});
	try {
		const events = vi.fn();
		const catalogs = vi.fn();
		host.subscribe(events);
		host.pluginCommands.subscribe(catalogs);
		await host.startSession({
			config: {
				sessionId: "sess-1",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				providerId: "openai-native",
				modelId: "gpt-4o-mini",
				apiKey: "test",
				systemPrompt: "test",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			interactive: true,
		});
		await vi.waitFor(() => expect(streams.size).toBeGreaterThan(0));
		const delta: HubEventEnvelope = {
			version: "v1",
			event: "assistant.delta",
			eventId: "delta-1",
			sessionId: "sess-1",
			payload: { text: "hello" },
		};
		for (const socket of server.clients) {
			for (const stream of streams) {
				if (stream === "global" || stream === delta.sessionId)
					socket.send(JSON.stringify({ kind: "event", envelope: delta }));
			}
		}
		await vi.waitFor(() => expect(events).toHaveBeenCalled());
		expect(streams).toEqual(new Set(["global", "sess-1"]));
		expect(events).toHaveBeenCalledTimes(1);
		expect(catalogs).not.toHaveBeenCalled();
	} finally {
		await host.dispose();
		for (const socket of server.clients) socket.terminate();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
