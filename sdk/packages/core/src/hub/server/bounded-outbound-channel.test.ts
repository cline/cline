import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BoundedOutboundChannel,
	type OutboundChannelSocket,
} from "./bounded-outbound-channel";

function createSocket(autoComplete = false) {
	const writes: Array<{ data: string; complete: (error?: unknown) => void }> =
		[];
	const socket: OutboundChannelSocket & {
		writes: typeof writes;
		closed: Array<[number, string]>;
		terminated: number;
	} = {
		writes,
		closed: [],
		terminated: 0,
		write(data, complete) {
			writes.push({ data, complete });
			if (autoComplete) complete();
		},
		close(code, reason) {
			this.closed.push([code, reason]);
		},
		terminate() {
			this.terminated += 1;
		},
	};
	return socket;
}

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("BoundedOutboundChannel", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("delivers normal sends and accounts for UTF-8 bytes", async () => {
		const socket = createSocket(true);
		const channel = new BoundedOutboundChannel(socket);
		expect(channel.send("héllo")).toBe(true);
		await flush();
		expect(socket.writes.map(({ data }) => data)).toEqual(["héllo"]);
		expect(channel.getCounters()).toMatchObject({
			sentMessages: 1,
			sentBytes: 6,
			queuedBytes: 0,
		});
	});

	it("coalesces replaceable messages after the soft watermark", async () => {
		const socket = createSocket();
		const channel = new BoundedOutboundChannel(socket, {
			softWatermarkBytes: 6,
			hardWatermarkBytes: 30,
		});
		channel.send("block");
		channel.send("old", { priority: "low", replaceableKey: "state" });
		channel.send("new", { priority: "low", replaceableKey: "state" });
		expect(channel.getCounters()).toMatchObject({ coalescedMessages: 1 });
		socket.writes[0]?.complete();
		await flush();
		expect(socket.writes.map(({ data }) => data)).toEqual(["block", "new"]);
	});

	it("keeps a slow client's queue bounded during a long snapshot stream", async () => {
		const socket = createSocket();
		const hardWatermarkBytes = 1024;
		const channel = new BoundedOutboundChannel(socket, {
			softWatermarkBytes: 1,
			hardWatermarkBytes,
		});
		channel.send("blocked");

		const updateCount = 25_000;
		for (let sequence = 0; sequence < updateCount; sequence++) {
			expect(
				channel.send(JSON.stringify({ sequence, status: "running" }), {
					priority: "low",
					replaceableKey: "session:snapshot",
				}),
			).toBe(true);
		}

		expect(channel.getCounters()).toMatchObject({
			queuedMessages: 2,
			coalescedMessages: updateCount - 1,
			droppedMessages: 0,
		});
		expect(channel.getCounters().queuedBytes).toBeLessThanOrEqual(
			hardWatermarkBytes,
		);
		expect(channel.getCounters().peakQueuedBytes).toBeLessThanOrEqual(
			hardWatermarkBytes,
		);

		socket.writes[0]?.complete();
		await flush();
		expect(JSON.parse(socket.writes[1]?.data ?? "{}")).toMatchObject({
			sequence: updateCount - 1,
		});
		channel.dispose();
	});

	it("sends high-priority work before queued low-priority work", async () => {
		const socket = createSocket();
		const channel = new BoundedOutboundChannel(socket);
		channel.send("block");
		channel.send("low", { priority: "low" });
		channel.send("high", { priority: "high" });
		socket.writes[0]?.complete();
		await flush();
		expect(socket.writes[1]?.data).toBe("high");
		socket.writes[1]?.complete();
		await flush();
		expect(socket.writes[2]?.data).toBe("low");
	});

	it("closes then terminates persistent hard pressure after grace", async () => {
		vi.useFakeTimers();
		const socket = createSocket();
		const channel = new BoundedOutboundChannel(socket, {
			softWatermarkBytes: 4,
			hardWatermarkBytes: 8,
			congestionGraceMs: 20,
			closeGraceMs: 10,
		});
		channel.send("12345678");
		expect(channel.send("x")).toBe(false);
		await vi.advanceTimersByTimeAsync(20);
		expect(socket.closed).toEqual([[1013, "WebSocket outbound congestion"]]);
		await vi.advanceTimersByTimeAsync(10);
		expect(socket.terminated).toBe(1);
		expect(channel.getCounters()).toMatchObject({
			hardPressureEvents: 1,
			closeRequests: 1,
			terminations: 1,
			disposed: true,
		});
	});

	it("disposal clears queued bytes and prevents later delivery", async () => {
		const socket = createSocket();
		const channel = new BoundedOutboundChannel(socket);
		channel.send("block");
		channel.send("queued");
		channel.dispose();
		socket.writes[0]?.complete();
		await flush();
		expect(socket.writes.map(({ data }) => data)).toEqual(["block"]);
		expect(channel.send("late")).toBe(false);
		expect(channel.getCounters()).toMatchObject({
			queuedBytes: 0,
			disposed: true,
			droppedMessages: 1,
		});
	});
});
