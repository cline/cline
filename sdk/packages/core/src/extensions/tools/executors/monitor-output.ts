/**
 * Bounded accumulator for one monitor's stdout/stderr.
 *
 * A monitored process can print arbitrarily fast, arbitrarily long lines, or
 * a single line with no newline at all. This buffer turns that raw stream
 * into a bounded batch of report-ready lines: decoded across chunk
 * boundaries, split on newlines, truncated per line, and capped per batch —
 * with everything over the caps counted and dropped rather than retained.
 */

import { StringDecoder } from "node:string_decoder";

export type MonitorStream = "stdout" | "stderr";

export interface MonitorOutputLimits {
	/** Lines per notification batch; excess is dropped and counted. */
	maxLinesPerNotification: number;
	/** Characters per line; longer lines are truncated. */
	maxLineChars: number;
}

/** A drained batch, ready to be delivered as one notification. */
export interface MonitorOutputBatch {
	lines: string[];
	droppedLines: number;
}

const TRUNCATION_SUFFIX = "… [truncated]";

function truncateLine(line: string, maxChars: number): string {
	if (line.length <= maxChars) return line;
	return (
		line.slice(0, Math.max(0, maxChars - TRUNCATION_SUFFIX.length)) +
		TRUNCATION_SUFFIX
	);
}

/** Per-stream decoding state; stderr and stdout interleave arbitrarily. */
interface StreamState {
	decoder: StringDecoder;
	/** Unterminated tail of the last chunk, held until its newline arrives. */
	remainder: string;
	/**
	 * Set while the stream is inside a line that already overflowed
	 * `maxLineChars`. Its truncated head has been queued; the rest is dropped
	 * until the next newline, so a newline-free stream cannot grow memory.
	 */
	discarding: boolean;
}

export class MonitorOutputBuffer {
	private pending: string[] = [];
	private droppedInBatch = 0;
	private readonly stdout: StreamState;
	private readonly stderr: StreamState;

	constructor(private readonly limits: MonitorOutputLimits) {
		this.stdout = {
			decoder: new StringDecoder("utf8"),
			remainder: "",
			discarding: false,
		};
		this.stderr = {
			decoder: new StringDecoder("utf8"),
			remainder: "",
			discarding: false,
		};
	}

	/** Whether a drain would currently produce any lines. */
	get hasPending(): boolean {
		return this.pending.length > 0;
	}

	/** Decodes one raw chunk and queues any completed lines. */
	ingest(chunk: Buffer, stream: MonitorStream): void {
		const state = stream === "stdout" ? this.stdout : this.stderr;
		let text = state.decoder.write(chunk);

		// A stream stuck inside an already-overflowed line contributes nothing
		// until its next newline: the line's truncated head has been queued, and
		// everything up to the newline is dropped without being retained — the
		// chunk is scanned, never buffered.
		if (state.discarding) {
			const newline = text.indexOf("\n");
			if (newline === -1) return;
			state.discarding = false;
			text = text.slice(newline + 1);
			if (!text) return;
		}

		const parts = (state.remainder + text).split(/\r?\n/);
		// The trailing element is an unterminated line; hold it until more
		// arrives so a line split across chunks is never reported twice.
		let tail = parts.pop() ?? "";

		for (const part of parts) {
			this.queueLine(stream === "stderr" ? `[stderr] ${part}` : part);
		}

		// The retained tail is what a newline-free stream would otherwise grow
		// without bound while re-copying it on every chunk. Once it exceeds the
		// line cap it can only ever be reported truncated, so queue that
		// truncation now and switch to discarding the rest of the line.
		if (tail.length > this.limits.maxLineChars) {
			this.queueLine(stream === "stderr" ? `[stderr] ${tail}` : tail);
			tail = "";
			state.discarding = true;
		}
		state.remainder = tail;
	}

	/**
	 * Queues whatever the process wrote without a trailing newline before it
	 * ended; otherwise the last line of output is silently lost. Called once,
	 * when the monitor settles.
	 */
	drainRemainders(): void {
		const trailing: Array<[MonitorStream, string]> = [
			["stdout", this.stdout.remainder],
			["stderr", this.stderr.remainder],
		];
		this.stdout.remainder = "";
		this.stderr.remainder = "";
		for (const [stream, text] of trailing) {
			if (!text) continue;
			this.queueLine(stream === "stderr" ? `[stderr] ${text}` : text);
		}
	}

	/** Removes and returns the current batch, resetting the drop counter. */
	drainBatch(): MonitorOutputBatch {
		const batch: MonitorOutputBatch = {
			lines: this.pending,
			droppedLines: this.droppedInBatch,
		};
		this.pending = [];
		this.droppedInBatch = 0;
		return batch;
	}

	private queueLine(line: string): void {
		if (this.pending.length >= this.limits.maxLinesPerNotification) {
			this.droppedInBatch += 1;
			return;
		}
		this.pending.push(truncateLine(line, this.limits.maxLineChars));
	}
}
