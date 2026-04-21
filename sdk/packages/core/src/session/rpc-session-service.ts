import { existsSync, mkdirSync } from "node:fs";
import { RpcSessionClient, type RpcSessionRow } from "@clinebot/rpc";
import type { SessionMessagesArtifactUploader } from "../types/session";
import type {
	PersistedSessionUpdateInput,
	SessionPersistenceAdapter,
} from "./persistence-service";
import { UnifiedSessionPersistenceService } from "./persistence-service";
import type { SessionRow } from "./session-service";

// ── Adapter ──────────────────────────────────────────────────────────

class RpcSessionPersistenceAdapter implements SessionPersistenceAdapter {
	constructor(private readonly client: RpcSessionClient) {}

	ensureSessionsDir(): string {
		return "";
	}

	async upsertSession(row: SessionRow): Promise<void> {
		await this.client.upsertSession(row as RpcSessionRow);
	}

	async getSession(sessionId: string): Promise<SessionRow | undefined> {
		const row = await this.client.getSession(sessionId);
		return (row as SessionRow | undefined) ?? undefined;
	}

	async listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<SessionRow[]> {
		const rows = await this.client.listSessions(options);
		return rows as SessionRow[];
	}

	async updateSession(
		input: PersistedSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		return this.client.updateSession({
			sessionId: input.sessionId,
			status: input.status,
			endedAt: input.endedAt,
			exitCode: input.exitCode,
			prompt: input.prompt,
			metadata: input.metadata,
			parentSessionId: input.parentSessionId,
			parentAgentId: input.parentAgentId,
			agentId: input.agentId,
			conversationId: input.conversationId,
			expectedStatusLock: input.expectedStatusLock,
			setRunning: input.setRunning,
		});
	}

	async deleteSession(sessionId: string, cascade: boolean): Promise<boolean> {
		return this.client.deleteSession(sessionId, cascade);
	}

	async enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		await this.client.enqueueSpawnRequest(input);
	}

	async claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		return this.client.claimSpawnRequest(rootSessionId, parentAgentId);
	}
}

// ── Service ──────────────────────────────────────────────────────────

export interface RpcCoreSessionServiceOptions {
	address?: string;
	sessionsDir: string;
	messagesArtifactUploader?: SessionMessagesArtifactUploader;
}

export class RpcCoreSessionService extends UnifiedSessionPersistenceService {
	private readonly sessionsDirPath: string;
	private readonly client: RpcSessionClient;
	public readonly address: string;

	constructor(options: RpcCoreSessionServiceOptions) {
		const address = options.address?.trim() || "127.0.0.1:4317";
		const client = new RpcSessionClient({
			address,
		});
		super(new RpcSessionPersistenceAdapter(client), {
			messagesArtifactUploader: options.messagesArtifactUploader,
		});
		this.sessionsDirPath = options.sessionsDir;
		this.client = client;
		this.address = address;
	}

	override ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
	}

	close(): void {
		this.client.close();
	}
}
