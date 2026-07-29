export type OutboundPriority = "high" | "normal" | "low";

export interface OutboundMessageOptions {
	priority?: OutboundPriority;
	/** Queued messages with the same key may be replaced after the soft watermark. */
	replaceableKey?: string;
}

export interface BoundedOutboundChannelOptions {
	softWatermarkBytes?: number;
	hardWatermarkBytes?: number;
	congestionGraceMs?: number;
	closeGraceMs?: number;
	closeCode?: number;
	closeReason?: string;
}

export interface OutboundChannelSocket {
	/** Call complete when the transport no longer owns the supplied bytes. */
	write(data: string, complete: (error?: unknown) => void): void;
	close(code: number, reason: string): void;
	terminate(): void;
}

export interface OutboundChannelCounters {
	enqueuedMessages: number;
	enqueuedBytes: number;
	sentMessages: number;
	sentBytes: number;
	coalescedMessages: number;
	coalescedBytes: number;
	droppedMessages: number;
	droppedBytes: number;
	hardPressureEvents: number;
	closeRequests: number;
	terminations: number;
	queuedMessages: number;
	queuedBytes: number;
	peakQueuedBytes: number;
	disposed: boolean;
}

export const DEFAULT_WEBSOCKET_DELIVERY_OPTIONS = {
	softWatermarkBytes: 256 * 1024,
	hardWatermarkBytes: 1024 * 1024,
	congestionGraceMs: 5_000,
	closeGraceMs: 1_000,
	closeCode: 1013,
	closeReason: "WebSocket outbound congestion",
} as const;

export const DEFAULT_WEBSOCKET_MAX_INBOUND_PAYLOAD_BYTES = 1024 * 1024;

type QueueEntry = {
	data: string;
	bytes: number;
	priority: OutboundPriority;
	replaceableKey?: string;
};

const PRIORITIES: readonly OutboundPriority[] = ["high", "normal", "low"];

export function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

/** A transport-neutral, per-socket byte-bounded delivery queue. */
export class BoundedOutboundChannel {
	private readonly queues: Record<OutboundPriority, QueueEntry[]> = {
		high: [],
		normal: [],
		low: [],
	};
	private readonly replaceable = new Map<string, QueueEntry>();
	private readonly options: Required<BoundedOutboundChannelOptions>;
	private readonly counters: OutboundChannelCounters = {
		enqueuedMessages: 0,
		enqueuedBytes: 0,
		sentMessages: 0,
		sentBytes: 0,
		coalescedMessages: 0,
		coalescedBytes: 0,
		droppedMessages: 0,
		droppedBytes: 0,
		hardPressureEvents: 0,
		closeRequests: 0,
		terminations: 0,
		queuedMessages: 0,
		queuedBytes: 0,
		peakQueuedBytes: 0,
		disposed: false,
	};
	private inFlight: QueueEntry | undefined;
	private congestionTimer: ReturnType<typeof setTimeout> | undefined;
	private terminateTimer: ReturnType<typeof setTimeout> | undefined;
	private closing = false;

	constructor(
		private readonly socket: OutboundChannelSocket,
		options: BoundedOutboundChannelOptions = {},
	) {
		this.options = { ...DEFAULT_WEBSOCKET_DELIVERY_OPTIONS, ...options };
		if (
			this.options.softWatermarkBytes < 0 ||
			this.options.hardWatermarkBytes <= 0 ||
			this.options.softWatermarkBytes > this.options.hardWatermarkBytes
		) {
			throw new Error("WebSocket watermarks must satisfy 0 <= soft <= hard");
		}
	}

	send(data: string, options: OutboundMessageOptions = {}): boolean {
		const bytes = utf8ByteLength(data);
		if (this.counters.disposed || this.closing) {
			this.recordDrop(bytes);
			return false;
		}

		const priority = options.priority ?? "normal";
		const existing = options.replaceableKey
			? this.replaceable.get(options.replaceableKey)
			: undefined;
		if (
			existing &&
			this.counters.queuedBytes + bytes > this.options.softWatermarkBytes
		) {
			this.removeQueued(existing);
			this.counters.coalescedMessages += 1;
			this.counters.coalescedBytes += existing.bytes;
		}

		if (bytes > this.options.hardWatermarkBytes) {
			this.recordDrop(bytes);
			this.beginHardPressure();
			return false;
		}
		while (
			this.counters.queuedBytes + bytes > this.options.hardWatermarkBytes &&
			this.dropReplaceableCandidate(priority)
		) {}
		if (this.counters.queuedBytes + bytes > this.options.hardWatermarkBytes) {
			this.recordDrop(bytes);
			this.beginHardPressure();
			return false;
		}

		const entry: QueueEntry = {
			data,
			bytes,
			priority,
			replaceableKey: options.replaceableKey,
		};
		this.queues[priority].push(entry);
		if (entry.replaceableKey) this.replaceable.set(entry.replaceableKey, entry);
		this.counters.enqueuedMessages += 1;
		this.counters.enqueuedBytes += bytes;
		this.counters.queuedMessages += 1;
		this.counters.queuedBytes += bytes;
		this.counters.peakQueuedBytes = Math.max(
			this.counters.peakQueuedBytes,
			this.counters.queuedBytes,
		);
		this.pump();
		return true;
	}

	/** Completes a Bun write that returned backpressure and later emitted drain. */
	notifyWritable(): void {
		this.completeInFlight();
	}

	getCounters(): Readonly<OutboundChannelCounters> {
		return { ...this.counters };
	}

	dispose(): void {
		if (this.counters.disposed) return;
		this.counters.disposed = true;
		this.clearTimers();
		for (const priority of PRIORITIES) this.queues[priority].length = 0;
		this.replaceable.clear();
		this.inFlight = undefined;
		this.counters.queuedMessages = 0;
		this.counters.queuedBytes = 0;
	}

	private pump(): void {
		if (this.inFlight || this.counters.disposed || this.closing) return;
		const entry = this.shiftNext();
		if (!entry) {
			this.clearCongestionIfRecovered();
			return;
		}
		this.inFlight = entry;
		let completed = false;
		try {
			this.socket.write(entry.data, (error) => {
				if (completed) return;
				completed = true;
				if (error) {
					this.requestClose(1011, "WebSocket outbound write failed");
					return;
				}
				this.completeInFlight();
			});
		} catch {
			this.requestClose(1011, "WebSocket outbound write failed");
		}
	}

	private completeInFlight(): void {
		const entry = this.inFlight;
		if (!entry) return;
		this.inFlight = undefined;
		this.counters.sentMessages += 1;
		this.counters.sentBytes += entry.bytes;
		this.counters.queuedMessages -= 1;
		this.counters.queuedBytes -= entry.bytes;
		this.clearCongestionIfRecovered();
		queueMicrotask(() => this.pump());
	}

	private shiftNext(): QueueEntry | undefined {
		for (const priority of PRIORITIES) {
			const entry = this.queues[priority].shift();
			if (!entry) continue;
			if (
				entry.replaceableKey &&
				this.replaceable.get(entry.replaceableKey) === entry
			) {
				this.replaceable.delete(entry.replaceableKey);
			}
			return entry;
		}
		return undefined;
	}

	private removeQueued(entry: QueueEntry): void {
		const queue = this.queues[entry.priority];
		const index = queue.indexOf(entry);
		if (index < 0) return;
		queue.splice(index, 1);
		if (
			entry.replaceableKey &&
			this.replaceable.get(entry.replaceableKey) === entry
		) {
			this.replaceable.delete(entry.replaceableKey);
		}
		this.counters.queuedMessages -= 1;
		this.counters.queuedBytes -= entry.bytes;
	}

	private dropReplaceableCandidate(
		incomingPriority: OutboundPriority,
	): boolean {
		const eligible =
			incomingPriority === "high"
				? (["low", "normal", "high"] as const)
				: incomingPriority === "normal"
					? (["low", "normal"] as const)
					: (["low"] as const);
		for (const priority of eligible) {
			const entry = this.queues[priority].find(
				(candidate) => candidate.replaceableKey,
			);
			if (!entry) continue;
			this.removeQueued(entry);
			this.recordDrop(entry.bytes);
			return true;
		}
		return false;
	}

	private recordDrop(bytes: number): void {
		this.counters.droppedMessages += 1;
		this.counters.droppedBytes += bytes;
	}

	private beginHardPressure(): void {
		this.counters.hardPressureEvents += 1;
		if (this.congestionTimer || this.closing || this.counters.disposed) return;
		this.congestionTimer = setTimeout(() => {
			this.congestionTimer = undefined;
			if (this.counters.queuedBytes < this.options.softWatermarkBytes) return;
			this.requestClose(this.options.closeCode, this.options.closeReason);
		}, this.options.congestionGraceMs);
	}

	private clearCongestionIfRecovered(): void {
		if (this.counters.queuedBytes >= this.options.softWatermarkBytes) return;
		if (this.congestionTimer) clearTimeout(this.congestionTimer);
		this.congestionTimer = undefined;
	}

	private requestClose(code: number, reason: string): void {
		if (this.closing || this.counters.disposed) return;
		this.closing = true;
		if (this.congestionTimer) clearTimeout(this.congestionTimer);
		this.congestionTimer = undefined;
		this.counters.closeRequests += 1;
		try {
			this.socket.close(code, reason);
		} catch {}
		this.terminateTimer = setTimeout(() => {
			this.terminateTimer = undefined;
			if (this.counters.disposed) return;
			this.counters.terminations += 1;
			try {
				this.socket.terminate();
			} finally {
				this.dispose();
			}
		}, this.options.closeGraceMs);
	}

	private clearTimers(): void {
		if (this.congestionTimer) clearTimeout(this.congestionTimer);
		if (this.terminateTimer) clearTimeout(this.terminateTimer);
		this.congestionTimer = undefined;
		this.terminateTimer = undefined;
	}
}
