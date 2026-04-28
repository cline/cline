import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type * as LlmsProviders from "@clinebot/llms";
import { ensureHookLogDir } from "@clinebot/shared/storage";
import { nowIso, SessionArtifacts } from "../../services/session-artifacts";
import {
	buildMessagesFilePayload,
	resolveMessagesFileContext,
	writeEmptyMessagesFile,
} from "../../services/session-data";
import type {
	SessionMessagesArtifactUploader,
	SessionPersistenceAdapter,
	StoredMessageWithMetadata,
} from "../../types/session";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../models/session-manifest";

export class SessionManifestStore {
	readonly artifacts: SessionArtifacts;

	constructor(
		private readonly adapter: SessionPersistenceAdapter,
		private readonly messagesArtifactUploader?: SessionMessagesArtifactUploader,
	) {
		this.artifacts = new SessionArtifacts(() => this.ensureSessionsDir());
	}

	ensureSessionsDir(): string {
		return this.adapter.ensureSessionsDir();
	}

	initializeMessagesFile(
		sessionId: string,
		path: string,
		startedAt: string,
	): void {
		writeEmptyMessagesFile(
			path,
			startedAt,
			resolveMessagesFileContext(sessionId),
		);
	}

	writeSessionManifest(manifestPath: string, manifest: SessionManifest): void {
		mkdirSync(dirname(manifestPath), { recursive: true });
		writeFileSync(
			manifestPath,
			`${JSON.stringify(SessionManifestSchema.parse(manifest), null, 2)}\n`,
			"utf8",
		);
	}

	readSessionManifest(sessionId: string): SessionManifest | undefined {
		return this.readManifestFile(sessionId).manifest;
	}

	readManifestFile(sessionId: string): {
		path: string;
		manifest?: SessionManifest;
	} {
		const manifestPath = this.artifacts.sessionManifestPath(sessionId, false);
		if (!existsSync(manifestPath)) {
			return { path: manifestPath };
		}
		try {
			return {
				path: manifestPath,
				manifest: SessionManifestSchema.parse(
					JSON.parse(readFileSync(manifestPath, "utf8")) as SessionManifest,
				),
			};
		} catch {
			return { path: manifestPath };
		}
	}

	async resolveArtifactPath(
		sessionId: string,
		kind: "messagesPath",
		fallback: (id: string) => string,
	): Promise<string> {
		const row = await this.adapter.getSession(sessionId);
		const value = row?.[kind];
		return typeof value === "string" && value.trim().length > 0
			? value
			: fallback(sessionId);
	}

	async persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.Message[],
		systemPrompt?: string,
	): Promise<void> {
		const path = await this.resolveArtifactPath(
			sessionId,
			"messagesPath",
			(id) => this.artifacts.sessionMessagesPath(id),
		);
		const payload = buildMessagesFilePayload({
			updatedAt: nowIso(),
			context: resolveMessagesFileContext(sessionId),
			messages: messages as StoredMessageWithMetadata[],
			systemPrompt,
		});
		const contents = `${JSON.stringify(payload, null, 2)}\n`;
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents, "utf8");
		if (!this.messagesArtifactUploader) {
			return;
		}
		try {
			const row = await this.adapter.getSession(sessionId);
			await this.messagesArtifactUploader.uploadMessagesFile({
				sessionId,
				path,
				contents,
				row,
			});
		} catch (error) {
			console.warn(
				`Failed to upload persisted session messages for ${sessionId}`,
				error,
			);
		}
	}

	appendStaleSessionHookLog(
		detectedAt: string,
		sessionId: string,
		pid: number,
		reason: string,
		source: string,
	): void {
		const envPath = process.env.CLINE_HOOKS_LOG_PATH?.trim() || undefined;
		const logPath = envPath ?? join(ensureHookLogDir(), "hooks.jsonl");
		appendFileSync(
			logPath,
			`${JSON.stringify({
				ts: detectedAt,
				hookName: "session_shutdown",
				reason,
				sessionId,
				pid,
				source,
			})}\n`,
			"utf8",
		);
	}
}
