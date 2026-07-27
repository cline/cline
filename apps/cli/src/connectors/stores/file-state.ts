import { readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir } from "@cline/core";
import type { Lock, QueueEntry, StateAdapter } from "chat";

type PersistedStateSnapshot = {
	values?: Record<string, { expiresAt?: number; value: unknown }>;
	lists?: Record<string, { expiresAt?: number; value: unknown[] }>;
	queues?: Record<string, QueueEntry[]>;
	subscriptions?: string[];
};

export class FileStateAdapter implements StateAdapter {
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
	private loaded = false;

	constructor(private readonly path: string) {}

	private pruneExpiredValues(): void {
		const now = Date.now();
		for (const [key, entry] of this.values.entries()) {
			if (entry.expiresAt && entry.expiresAt <= now) {
				this.values.delete(key);
			}
		}
		for (const [key, entry] of this.lists.entries()) {
			if (entry.expiresAt && entry.expiresAt <= now) {
				this.lists.delete(key);
			}
		}
		for (const [threadId, queue] of this.queues.entries()) {
			const activeQueue = queue.filter((entry) => entry.expiresAt > now);
			if (activeQueue.length > 0) {
				this.queues.set(threadId, activeQueue);
			} else {
				this.queues.delete(threadId);
			}
		}
	}

	private loadFromDisk(): void {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
		try {
			const raw = readFileSync(this.path, "utf8");
			const snapshot = JSON.parse(raw) as PersistedStateSnapshot;
			for (const [key, entry] of Object.entries(snapshot.values ?? {})) {
				if (!entry || typeof entry !== "object" || !("value" in entry)) {
					continue;
				}
				this.values.set(key, {
					value: entry.value,
					expiresAt:
						typeof entry.expiresAt === "number" ? entry.expiresAt : undefined,
				});
			}
			for (const [key, entry] of Object.entries(snapshot.lists ?? {})) {
				if (
					!entry ||
					typeof entry !== "object" ||
					!Array.isArray(entry.value)
				) {
					continue;
				}
				this.lists.set(key, {
					value: entry.value,
					expiresAt:
						typeof entry.expiresAt === "number" ? entry.expiresAt : undefined,
				});
			}
			for (const [threadId, entries] of Object.entries(snapshot.queues ?? {})) {
				if (!Array.isArray(entries)) {
					continue;
				}
				this.queues.set(
					threadId,
					entries.filter(
						(entry): entry is QueueEntry =>
							Boolean(entry) &&
							typeof entry === "object" &&
							typeof entry.enqueuedAt === "number" &&
							typeof entry.expiresAt === "number" &&
							"message" in entry,
					),
				);
			}
			for (const threadId of snapshot.subscriptions ?? []) {
				if (typeof threadId === "string" && threadId.trim()) {
					this.subscriptions.add(threadId);
				}
			}
			this.pruneExpiredValues();
		} catch {}
	}

	private persist(): void {
		this.pruneExpiredValues();
		ensureParentDir(this.path);
		const snapshot: PersistedStateSnapshot = {
			values: Object.fromEntries(this.values.entries()),
			lists: Object.fromEntries(this.lists.entries()),
			queues: Object.fromEntries(this.queues.entries()),
			subscriptions: [...this.subscriptions],
		};
		writeFileSync(this.path, JSON.stringify(snapshot, null, 2), "utf8");
	}

	async connect(): Promise<void> {
		this.loadFromDisk();
	}

	async disconnect(): Promise<void> {}

	async get<T = unknown>(key: string): Promise<T | null> {
		this.loadFromDisk();
		const entry = this.values.get(key);
		if (!entry) {
			return null;
		}
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			this.values.delete(key);
			this.persist();
			return null;
		}
		return entry.value as T;
	}

	async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
		this.loadFromDisk();
		this.values.set(key, {
			value,
			expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
		});
		this.persist();
	}

	async delete(key: string): Promise<void> {
		this.loadFromDisk();
		this.values.delete(key);
		this.lists.delete(key);
		this.persist();
	}

	async dequeue(threadId: string): Promise<QueueEntry | null> {
		this.loadFromDisk();
		this.pruneExpiredValues();
		const queue = this.queues.get(threadId) ?? [];
		const next = queue.shift() ?? null;
		if (queue.length > 0) {
			this.queues.set(threadId, queue);
		} else {
			this.queues.delete(threadId);
		}
		this.persist();
		return next;
	}

	async enqueue(
		threadId: string,
		entry: QueueEntry,
		maxSize: number,
	): Promise<number> {
		this.loadFromDisk();
		this.pruneExpiredValues();
		const queue = [...(this.queues.get(threadId) ?? []), entry];
		const trimmed =
			maxSize > 0 && queue.length > maxSize
				? queue.slice(queue.length - maxSize)
				: queue;
		this.queues.set(threadId, trimmed);
		this.persist();
		return trimmed.length;
	}

	async subscribe(threadId: string): Promise<void> {
		this.loadFromDisk();
		this.subscriptions.add(threadId);
		this.persist();
	}

	async unsubscribe(threadId: string): Promise<void> {
		this.loadFromDisk();
		this.subscriptions.delete(threadId);
		this.persist();
	}

	async isSubscribed(threadId: string): Promise<boolean> {
		this.loadFromDisk();
		return this.subscriptions.has(threadId);
	}

	async queueDepth(threadId: string): Promise<number> {
		this.loadFromDisk();
		this.pruneExpiredValues();
		const depth = this.queues.get(threadId)?.length ?? 0;
		this.persist();
		return depth;
	}

	async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
		this.loadFromDisk();
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
		this.loadFromDisk();
		const existing = this.locks.get(lock.threadId);
		if (!existing || existing.token !== lock.token) {
			return false;
		}
		existing.expiresAt = Date.now() + ttlMs;
		return true;
	}

	async releaseLock(lock: Lock): Promise<void> {
		this.loadFromDisk();
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
		this.loadFromDisk();
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
		this.persist();
	}

	async forceReleaseLock(threadId: string): Promise<void> {
		this.loadFromDisk();
		this.locks.delete(threadId);
	}

	async getList<T = unknown>(key: string): Promise<T[]> {
		this.loadFromDisk();
		const entry = this.lists.get(key);
		if (!entry) {
			return [];
		}
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			this.lists.delete(key);
			this.persist();
			return [];
		}
		return entry.value as T[];
	}

	async setIfNotExists(
		key: string,
		value: unknown,
		ttlMs?: number,
	): Promise<boolean> {
		this.loadFromDisk();
		const existing = await this.get(key);
		if (existing !== null) {
			return false;
		}
		await this.set(key, value, ttlMs);
		return true;
	}
}
