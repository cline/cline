import type { AdaptiveConcurrencyConfig } from "./types";

export const DEFAULT_ADAPTIVE_CONCURRENCY: AdaptiveConcurrencyConfig = {
	initial: 2,
	min: 1,
	max: 8,
	increase: 1,
	decrease: 0.5,
};

/**
 * Additive-increase / multiplicative-decrease concurrency window.
 * Success widens the window; rate-limit or failure shrinks it.
 */
export class AdaptiveConcurrency {
	readonly config: AdaptiveConcurrencyConfig;
	#window: number;

	constructor(config: Partial<AdaptiveConcurrencyConfig> = {}) {
		this.config = { ...DEFAULT_ADAPTIVE_CONCURRENCY, ...config };
		if (this.config.min < 1) {
			throw new Error("AdaptiveConcurrency min must be >= 1");
		}
		if (this.config.max < this.config.min) {
			throw new Error("AdaptiveConcurrency max must be >= min");
		}
		this.#window = clamp(
			this.config.initial,
			this.config.min,
			this.config.max,
		);
	}

	get window(): number {
		return this.#window;
	}

	onSuccess(): number {
		this.#window = clamp(
			this.#window + this.config.increase,
			this.config.min,
			this.config.max,
		);
		return this.#window;
	}

	onFailure(): number {
		this.#window = clamp(
			Math.max(this.config.min, Math.floor(this.#window * this.config.decrease)),
			this.config.min,
			this.config.max,
		);
		return this.#window;
	}

	/** Treat provider 429 / throttle as a hard shrink. */
	onRateLimited(): number {
		return this.onFailure();
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
