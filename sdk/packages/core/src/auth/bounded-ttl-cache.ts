/**
 * Small process-local string cache with TTL expiry and a hard entry cap.
 * Used where unbounded Maps would grow without bound in long-running processes.
 */
export class BoundedTtlCache {
	private readonly entries = new Map<
		string,
		{ value: string; expiresAt: number }
	>();

	constructor(
		private readonly ttlMs: number,
		private readonly maxEntries: number,
	) {}

	get(key: string, now = Date.now()): string | undefined {
		this.pruneExpired(now);
		const hit = this.entries.get(key);
		if (!hit) {
			return undefined;
		}
		// Bump recency for FIFO eviction under cap.
		this.entries.delete(key);
		this.entries.set(key, hit);
		return hit.value;
	}

	set(
		key: string,
		value: string,
		now = Date.now(),
		ttlMsOverride = this.ttlMs,
	): void {
		this.pruneExpired(now);
		this.entries.delete(key);
		while (this.entries.size >= this.maxEntries) {
			const first = this.entries.keys().next().value as string | undefined;
			if (first === undefined) {
				break;
			}
			this.entries.delete(first);
		}
		this.entries.set(key, { value, expiresAt: now + ttlMsOverride });
	}

	private pruneExpired(now: number): void {
		for (const [k, v] of this.entries) {
			if (v.expiresAt <= now) {
				this.entries.delete(k);
			}
		}
	}
}
