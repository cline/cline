import type { Lock, StateAdapter } from "chat";

export class InMemoryStateAdapter implements StateAdapter {
	private readonly values = new Map<
		string,
		{ expiresAt?: number; value: unknown }
	>();
	private readonly lists = new Map<
		string,
		{ expiresAt?: number; value: unknown[] }
	>();
	private readonly subscriptions = new Set<string>();
	private readonly locks = new Map<string, Lock>();

	async connect(): Promise<void> {}

	async disconnect(): Promise<void> {}

	async get<T = unknown>(key: string): Promise<T | null> {
		const entry = this.values.get(key);
		if (!entry) {
			return null;
		}
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			this.values.delete(key);
			return null;
		}
		return entry.value as T;
	}

	async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
		this.values.set(key, {
			value,
			expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
		});
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key);
		this.lists.delete(key);
	}

	async subscribe(threadId: string): Promise<void> {
		this.subscriptions.add(threadId);
	}

	async unsubscribe(threadId: string): Promise<void> {
		this.subscriptions.delete(threadId);
	}

	async isSubscribed(threadId: string): Promise<boolean> {
		return this.subscriptions.has(threadId);
	}

	async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
		const existing = this.locks.get(threadId);
		if (existing && existing.expiresAt > Date.now()) {
			return null;
		}
		const lock: Lock = {
			threadId,
			token: crypto.randomUUID(),
			expiresAt: Date.now() + ttlMs,
		};
		this.locks.set(threadId, lock);
		return lock;
	}

	async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
		const existing = this.locks.get(lock.threadId);
		if (!existing || existing.token !== lock.token) {
			return false;
		}
		existing.expiresAt = Date.now() + ttlMs;
		return true;
	}

	async releaseLock(lock: Lock): Promise<void> {
		const existing = this.locks.get(lock.threadId);
		if (existing?.token === lock.token) {
			this.locks.delete(lock.threadId);
		}
	}

	async appendToList(
		key: string,
		value: unknown,
		options?: { maxLength?: number; ttlMs?: number },
	): Promise<void> {
		const existing = this.lists.get(key);
		const next = existing ? [...existing.value, value] : [value];
		const maxLength = options?.maxLength;
		const trimmed =
			typeof maxLength === "number" && maxLength > 0 && next.length > maxLength
				? next.slice(next.length - maxLength)
				: next;
		this.lists.set(key, {
			value: trimmed,
			expiresAt: options?.ttlMs ? Date.now() + options.ttlMs : undefined,
		});
	}

	async forceReleaseLock(threadId: string): Promise<void> {
		this.locks.delete(threadId);
	}

	async getList<T = unknown>(key: string): Promise<T[]> {
		const entry = this.lists.get(key);
		if (!entry) {
			return [];
		}
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			this.lists.delete(key);
			return [];
		}
		return entry.value as T[];
	}

	async setIfNotExists(
		key: string,
		value: unknown,
		ttlMs?: number,
	): Promise<boolean> {
		const existing = await this.get(key);
		if (existing !== null) {
			return false;
		}
		await this.set(key, value, ttlMs);
		return true;
	}
}
