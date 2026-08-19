import type { Lock, QueueEntry, StateAdapter } from "chat";

export class InMemoryStateAdapter implements StateAdapter {
	private readonly values = new Map<
		string,
		{ expiresAt?: number; value: unknown }
	>();
	private readonly lists = new Map<
		string,
		{ expiresAt?: number; value: unknown[] }
	>();
	private readonly queues = new Map<string, QueueEntry[]>();
	private readonly subscriptions = new Set<string>();
	private readonly locks = new Map<string, Lock>();

	private getActiveQueue(threadId: string): QueueEntry[] {
		const queue = this.queues.get(threadId) ?? [];
		const now = Date.now();
		const activeQueue = queue.filter((entry) => entry.expiresAt > now);
		if (activeQueue.length > 0) {
			this.queues.set(threadId, activeQueue);
		} else {
			this.queues.delete(threadId);
		}
		return activeQueue;
	}

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

	async dequeue(threadId: string): Promise<QueueEntry | null> {
		const queue = this.getActiveQueue(threadId);
		const next = queue.shift() ?? null;
		if (queue.length > 0) {
			this.queues.set(threadId, queue);
		} else {
			this.queues.delete(threadId);
		}
		return next;
	}

	async enqueue(
		threadId: string,
		entry: QueueEntry,
		maxSize: number,
	): Promise<number> {
		const queue = [...this.getActiveQueue(threadId), entry];
		const trimmed =
			maxSize > 0 && queue.length > maxSize
				? queue.slice(queue.length - maxSize)
				: queue;
		this.queues.set(threadId, trimmed);
		return trimmed.length;
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

	async queueDepth(threadId: string): Promise<number> {
		return this.getActiveQueue(threadId).length;
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
