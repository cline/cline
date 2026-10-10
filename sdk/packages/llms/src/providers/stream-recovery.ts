import type { AiSdkStreamPart } from "./vendors/types";

const MAX_BUFFERED_PARTS = 64;

/** Order public SDK callbacks with consumer-facing parts, including retry boundaries. */
export class StreamRecovery {
	private readonly parts: AiSdkStreamPart[] = [];
	private readonly observed = new WeakSet<object>();
	private wake?: () => void;
	private wakeSpace?: () => void;
	private closed = false;
	private failure?: unknown;
	private pendingError?: string;
	private retry = 0;

	constructor(private readonly maxRetries: number) {}

	async onChunk(part: AiSdkStreamPart): Promise<void> {
		// Recovered errors are deliberately absent from fullStream. Terminal errors
		// are forwarded by consume(), after the SDK decides recovery is exhausted.
		if (part.type === "error") return;
		this.observed.add(part);
		this.push(part);
		if (this.parts.length >= MAX_BUFFERED_PARTS && !this.closed) {
			await new Promise<void>((resolve) => {
				this.wakeSpace = resolve;
			});
		}
	}

	onError(message: string): void {
		this.pendingError = message;
	}

	onStepStart(): void {
		this.retry = 0;
		this.pendingError = undefined;
	}

	onCallStart(): void {
		if (!this.pendingError) return;
		this.push({
			type: "stream-retry",
			error: this.pendingError,
			attempt: ++this.retry,
			maxRetries: this.maxRetries,
		});
		this.pendingError = undefined;
	}

	onStepEnd(): void {
		this.pendingError = undefined;
		this.push({ type: "response-checkpoint" });
	}

	private push(part: AiSdkStreamPart): void {
		if (this.closed) return;
		this.parts.push(part);
		this.wake?.();
		this.wake = undefined;
	}

	private async consume(source: AsyncIterable<AiSdkStreamPart>): Promise<void> {
		try {
			for await (const part of source) {
				if (this.closed) break;
				// Parts absent from onChunk, including terminal errors, still reach consumers.
				if (!this.observed.has(part)) this.push(part);
			}
		} catch (error) {
			this.failure = error;
		} finally {
			this.closed = true;
			this.wake?.();
		}
	}

	async *stream(
		source: AsyncIterable<AiSdkStreamPart>,
	): AsyncIterable<AiSdkStreamPart> {
		// consume catches its own failures and wakes the reader. Do not await it
		// on early return: the upstream may still be waiting for network bytes.
		void this.consume(source);
		try {
			for (;;) {
				while (this.parts.length) {
					const part = this.parts.shift();
					this.wakeSpace?.();
					this.wakeSpace = undefined;
					if (part) yield part;
				}
				if (this.closed) break;
				await new Promise<void>((resolve) => {
					this.wake = resolve;
				});
			}
			if (this.failure !== undefined) throw this.failure;
		} finally {
			this.closed = true;
			this.wakeSpace?.();
		}
	}
}
