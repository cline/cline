import {
	type AddressInfo,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ComputerUseClient } from "../computer-use/client";
import type { ComputerUseResponse } from "../computer-use/protocol";
import type {
	ArtifactEventSink,
	ArtifactSinkStatus,
	ComputerTaskArtifactEvent,
} from "./artifact-events";
import { ComputerTaskArtifactRecorder } from "./recorder";

function createCollectingSink(): {
	sink: ArtifactEventSink;
	events: ComputerTaskArtifactEvent[];
} {
	const events: ComputerTaskArtifactEvent[] = [];
	const sink: ArtifactEventSink = {
		emit(event) {
			events.push(event);
		},
		flush(): Promise<ArtifactSinkStatus> {
			return Promise.resolve({
				status: "complete",
				lastClientSequence: events.length,
				lastAcknowledgedSequence: events.length,
			});
		},
	};
	return { sink, events };
}

function startFakeBackend(
	respond: (request: Record<string, unknown>) => ComputerUseResponse,
): Promise<{ server: Server; port: number }> {
	return new Promise((resolve) => {
		const server = createServer((socket: Socket) => {
			let buffer = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				let newlineIndex = buffer.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex);
					buffer = buffer.slice(newlineIndex + 1);
					if (line.trim().length > 0) {
						const request = JSON.parse(line) as Record<string, unknown>;
						socket.write(`${JSON.stringify(respond(request))}\n`);
					}
					newlineIndex = buffer.indexOf("\n");
				}
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve({ server, port: address.port });
		});
	});
}

describe("ComputerTaskArtifactRecorder", () => {
	let server: Server | undefined;

	afterEach(async () => {
		if (!server) {
			return;
		}
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	});

	it("assigns a gap-free client sequence across sources", () => {
		const { sink, events } = createCollectingSink();
		const recorder = new ComputerTaskArtifactRecorder("artifact_1", sink);

		recorder.record({
			type: "session.started",
			source: { kind: "driver", sessionId: "drv" },
			payload: {},
		});
		recorder.record({
			type: "helper.note",
			source: { kind: "computer_user", sessionId: "helper" },
			payload: { message: "starting" },
		});
		recorder.record({
			type: "session.ended",
			source: { kind: "driver", sessionId: "drv" },
			payload: {},
		});

		expect(events.map((event) => event.clientSequence)).toEqual([1, 2, 3]);
		expect(new Set(events.map((event) => event.eventId)).size).toBe(3);
		expect(events.every((event) => event.artifactId === "artifact_1")).toBe(
			true,
		);
	});

	it("records the real client's action lifecycle with shared correlation and no typed text", async () => {
		const started = await startFakeBackend((request) => ({
			id: request.id as number,
			ok: true,
			text: "typed",
			image: { data: "ZmFrZQ==", mediaType: "image/png" },
		}));
		server = started.server;

		const { sink, events } = createCollectingSink();
		const recorder = new ComputerTaskArtifactRecorder("artifact_2", sink);
		const client = new ComputerUseClient({
			port: started.port,
			observer: recorder.createComputerObserver({ sessionId: "helper" }),
		});

		await client.send({ action: "type", text: "hunter2" });

		expect(events.map((event) => event.type)).toEqual([
			"computer.action_requested",
			"computer.action_completed",
		]);
		const [requested, completed] = events;
		expect(requested?.correlation?.computerActionId).toBeDefined();
		expect(requested?.correlation?.computerActionId).toBe(
			completed?.correlation?.computerActionId,
		);
		// Typed text must never enter the artifact stream.
		expect(JSON.stringify(requested?.payload)).not.toContain("hunter2");
		expect(requested?.payload.hasText).toBe(true);
		expect(completed?.payload.hasImage).toBe(true);
		client.close();
	});

	it("records cancellations as their own event type", async () => {
		const started = await startFakeBackend(() => {
			throw new Error("never called: server intentionally does not respond");
		});
		server = started.server;
		server.removeAllListeners("connection");
		server.on("connection", (socket) => {
			socket.on("data", () => {
				/* intentionally never respond */
			});
		});

		const { sink, events } = createCollectingSink();
		const recorder = new ComputerTaskArtifactRecorder("artifact_3", sink);
		const client = new ComputerUseClient({
			port: started.port,
			requestTimeoutMs: 5_000,
			observer: recorder.createComputerObserver({ sessionId: "helper" }),
		});

		const controller = new AbortController();
		const sendPromise = client.send(
			{ action: "screenshot" },
			{ signal: controller.signal },
		);
		controller.abort(new Error("interrupted by driver"));
		await expect(sendPromise).rejects.toThrow("interrupted by driver");

		expect(events.map((event) => event.type)).toEqual([
			"computer.action_requested",
			"computer.action_cancelled",
		]);
		expect(events[1]?.payload.reason).toBe("interrupted by driver");
		client.close();
	});
});
