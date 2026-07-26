/**
 * Shared status / scratch bus for wave workers.
 * Last-write-wins per key. Keys are opaque strings owned by the workflow.
 */
export class DriveWorkScratch {
	#store = new Map<string, unknown>();

	get size(): number {
		return this.#store.size;
	}

	get(key: string): unknown {
		return this.#store.get(key);
	}

	set(key: string, value: unknown): void {
		this.#store.set(key, value);
	}

	writeAll(writes: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(writes)) {
			this.#store.set(key, value);
		}
	}

	has(key: string): boolean {
		return this.#store.has(key);
	}

	delete(key: string): boolean {
		return this.#store.delete(key);
	}

	snapshot(): Map<string, unknown> {
		return new Map(this.#store);
	}

	toRecord(): Record<string, unknown> {
		return Object.fromEntries(this.#store);
	}

	restore(record: Record<string, unknown>): void {
		this.#store = new Map(Object.entries(record));
	}

	clear(): void {
		this.#store.clear();
	}
}
