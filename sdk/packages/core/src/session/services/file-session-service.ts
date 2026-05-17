import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { BasicLogger } from "@cline/shared";
import { resolveSessionDataDir } from "@cline/shared/storage";
import type { SessionMessagesArtifactUploader } from "../../types/session";
import type { SessionRow } from "../models/session-row";
import type {
	PersistedSessionUpdateInput,
	SessionPersistenceAdapter,
} from "./persistence-service";
import { UnifiedSessionPersistenceService } from "./persistence-service";

interface FileSessionIndex {
	version: 1;
	sessions: Record<string, SessionRow>;
}

interface FileSpawnRequest {
	id: number;
	rootSessionId: string;
	parentAgentId: string;
	task?: string;
	systemPrompt?: string;
	createdAt: string;
	consumedAt?: string;
}

interface FileSpawnQueue {
	version: 1;
	nextId: number;
	requests: FileSpawnRequest[];
}

function nowIso(): string {
	return new Date().toISOString();
}

function atomicWriteJson(path: string, value: unknown): void {
	const tempPath = `${path}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(tempPath, path);
}

class FileSessionPersistenceAdapter implements SessionPersistenceAdapter {
	constructor(
		private readonly sessionsDirPath: string = resolveSessionDataDir(),
	) {}

	ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
	}

	private indexPath(): string {
		return join(this.ensureSessionsDir(), "sessions.index.json");
	}

	private spawnQueuePath(): string {
		return join(this.ensureSessionsDir(), "subagent-spawn-queue.json");
	}

	private readIndex(): FileSessionIndex {
		const path = this.indexPath();
		if (!existsSync(path)) {
			return { version: 1, sessions: {} };
		}
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as FileSessionIndex;
			if (parsed?.version === 1 && parsed.sessions) {
				return parsed;
			}
		} catch {
			// Ignore invalid persistence and fall back to an empty index.
		}
		return { version: 1, sessions: {} };
	}

	private writeIndex(index: FileSessionIndex): void {
		atomicWriteJson(this.indexPath(), index);
	}

	private readQueue(): FileSpawnQueue {
		const path = this.spawnQueuePath();
		if (!existsSync(path)) {
			return { version: 1, nextId: 1, requests: [] };
		}
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as FileSpawnQueue;
			if (
				parsed?.version === 1 &&
				typeof parsed.nextId === "number" &&
				Array.isArray(parsed.requests)
			) {
				return parsed;
			}
		} catch {
			// Ignore invalid persistence and fall back to an empty queue.
		}
		return { version: 1, nextId: 1, requests: [] };
	}

	private writeQueue(queue: FileSpawnQueue): void {
		atomicWriteJson(this.spawnQueuePath(), queue);
	}

	async upsertSession(row: SessionRow): Promise<void> {
		const index = this.readIndex();
		index.sessions[row.sessionId] = row;
		this.writeIndex(index);
	}

	async getSession(sessionId: string): Promise<SessionRow | undefined> {
		return this.readIndex().sessions[sessionId];
	}

	async listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<SessionRow[]> {
		return Object.values(this.readIndex().sessions)
			.filter((row) =>
				options.parentSessionId !== undefined
					? row.parentSessionId === options.parentSessionId
					: true,
			)
			.filter((row) =>
				options.status !== undefined ? row.status === options.status : true,
			)
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
			.slice(0, options.limit);
	}

	async updateSession(
		input: PersistedSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		const index = this.readIndex();
		const existing = index.sessions[input.sessionId];
		if (!existing) {
			return { updated: false, statusLock: 0 };
		}
		if (
			input.expectedStatusLock !== undefined &&
			existing.statusLock !== input.expectedStatusLock
		) {
			return { updated: false, statusLock: existing.statusLock };
		}

		const nextStatusLock =
			input.expectedStatusLock !== undefined
				? input.expectedStatusLock + 1
				: existing.statusLock;
		const next: SessionRow = {
			...existing,
			status: input.status ?? existing.status,
			endedAt:
				input.endedAt !== undefined
					? input.endedAt
					: (existing.endedAt ?? null),
			exitCode:
				input.exitCode !== undefined
					? input.exitCode
					: (existing.exitCode ?? null),
			prompt:
				input.prompt !== undefined ? input.prompt : (existing.prompt ?? null),
			metadata:
				input.metadata !== undefined
					? (input.metadata ?? null)
					: (existing.metadata ?? null),
			parentSessionId:
				input.parentSessionId !== undefined
					? (input.parentSessionId ?? null)
					: (existing.parentSessionId ?? null),
			parentAgentId:
				input.parentAgentId !== undefined
					? (input.parentAgentId ?? null)
					: (existing.parentAgentId ?? null),
			agentId:
				input.agentId !== undefined
					? (input.agentId ?? null)
					: (existing.agentId ?? null),
			conversationId:
				input.conversationId !== undefined
					? (input.conversationId ?? null)
					: (existing.conversationId ?? null),
			statusLock: nextStatusLock,
			isSubagent:
				input.setRunning || input.parentSessionId !== undefined
					? true
					: existing.isSubagent,
			updatedAt: nowIso(),
		};

		if (input.setRunning) {
			next.status = "running";
			next.endedAt = null;
			next.exitCode = null;
		}

		index.sessions[input.sessionId] = next;
		this.writeIndex(index);
		return { updated: true, statusLock: next.statusLock };
	}

	async deleteSession(sessionId: string, cascade: boolean): Promise<boolean> {
		const index = this.readIndex();
		const existing = index.sessions[sessionId];
		if (!existing) {
			return false;
		}
		delete index.sessions[sessionId];
		if (cascade) {
			for (const row of Object.values(index.sessions)) {
				if (row.parentSessionId === sessionId) {
					delete index.sessions[row.sessionId];
				}
			}
		}
		this.writeIndex(index);
		return true;
	}

	async enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		const queue = this.readQueue();
		queue.requests.push({
			id: queue.nextId,
			rootSessionId: input.rootSessionId,
			parentAgentId: input.parentAgentId,
			task: input.task,
			systemPrompt: input.systemPrompt,
			createdAt: nowIso(),
		});
		queue.nextId += 1;
		this.writeQueue(queue);
	}

	async claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		const queue = this.readQueue();
		const request = queue.requests.find(
			(item) =>
				item.rootSessionId === rootSessionId &&
				item.parentAgentId === parentAgentId &&
				!item.consumedAt,
		);
		if (!request) {
			return undefined;
		}
		request.consumedAt = nowIso();
		this.writeQueue(queue);
		return request.task;
	}
}

export class FileSessionService extends UnifiedSessionPersistenceService {
	constructor(
		sessionsDir?: string,
		options: {
			messagesArtifactUploader?: SessionMessagesArtifactUploader;
			logger?: BasicLogger;
		} = {},
	) {
		super(new FileSessionPersistenceAdapter(sessionsDir), options);
	}

	override ensureSessionsDir(): string {
		return super.ensureSessionsDir();
	}
}
