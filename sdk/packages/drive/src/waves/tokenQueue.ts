import type { TokenQueueConfig } from "./types";

export const DEFAULT_TOKEN_QUEUE: TokenQueueConfig = {
	maxPerInterval: 8,
	intervalMs: 1_000,
};

type Waiter = {
	resolve: () => void;
	reject: (error: Error) => void;
};

/**
 * Queued rate limiter. Callers await acquire() before starting work.
 * Tokens refill each interval; waiters drain FIFO.
 */
export class TokenQueue {
	readonly config: TokenQueueConfig;
	#tokens: number;
	#queue: Waiter[] = [];
	#timer: ReturnType<typeof setInterval> | null = null;
	#closed = false;

	constructor(config: Partial<TokenQueueConfig> = {}) {
		this.config = { ...DEFAULT_TOKEN_QUEUE, ...config };
		if (this.config.maxPerInterval < 1) {
			throw new Error("TokenQueue maxPerInterval must be >= 1");
		}
		this.#tokens = this.config.maxPerInterval;
		this.#timer = setInterval(() => this.#refill(), this.config.intervalMs);
		if (typeof this.#timer === "object" && "unref" in this.#timer) {
			this.#timer.unref();
		}
	}

	async acquire(signal?: AbortSignal): Promise<void> {
		if (this.#closed) {
			throw new Error("TokenQueue is closed");
		}
		if (signal?.aborted) {
			throw new Error("TokenQueue acquire aborted");
		}
		if (this.#tokens > 0) {
			this.#tokens -= 1;
			return;
		}
		return new Promise<void>((resolve, reject) => {
			const waiter: Waiter = { resolve, reject };
			this.#queue.push(waiter);
			const onAbort = () => {
				const idx = this.#queue.indexOf(waiter);
				if (idx >= 0) {
					this.#queue.splice(idx, 1);
				}
				reject(new Error("TokenQueue acquire aborted"));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	close(): void {
		this.#closed = true;
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
		const pending = this.#queue.splice(0);
		for (const waiter of pending) {
			waiter.reject(new Error("TokenQueue is closed"));
		}
	}

	#refill(): void {
		this.#tokens = this.config.maxPerInterval;
		while (this.#tokens > 0 && this.#queue.length > 0) {
			const next = this.#queue.shift();
			if (!next) {
				break;
			}
			this.#tokens -= 1;
			next.resolve();
		}
	}
}
