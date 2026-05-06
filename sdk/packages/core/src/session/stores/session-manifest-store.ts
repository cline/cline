import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import type { BasicLogger } from "@cline/shared";
import { ensureHookLogDir } from "@cline/shared/storage";
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
	parseSessionCompactionState,
	type SessionCompactionState,
	SessionCompactionStateSchema,
} from "../models/session-compaction";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../models/session-manifest";

function fsyncBestEffort(path: string): void {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		fsyncSync(fd);
	} catch {
		// Directory fsync is not available on all platforms/filesystems.
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// Best-effort durability only.
			}
		}
	}
}

function writeFileAtomicSync(path: string, contents: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	let fd: number | undefined;
	try {
		fd = openSync(tempPath, "w");
		writeFileSync(fd, contents, "utf8");
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(tempPath, path);
		fsyncBestEffort(dirname(path));
	} catch (error) {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// Preserve the original write error.
			}
		}
		rmSync(tempPath, { force: true });
		throw error;
	}
}

export class SessionManifestStore {
	readonly artifacts: SessionArtifacts;

	constructor(
		private readonly adapter: SessionPersistenceAdapter,
		private readonly messagesArtifactUploader?: SessionMessagesArtifactUploader,
		private readonly logger?: BasicLogger,
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
		writeFileAtomicSync(
			manifestPath,
			`${JSON.stringify(SessionManifestSchema.parse(manifest), null, 2)}\n`,
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
		writeFileAtomicSync(path, contents);
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
			this.logger?.debug("Failed to upload persisted session messages", {
				sessionId,
				error,
			});
		}
	}

	private resolveCompactionPath(sessionId: string): string {
		const { manifest } = this.readManifestFile(sessionId);
		return (
			manifest?.compaction_path?.trim() ||
			this.artifacts.sessionCompactionPath(sessionId)
		);
	}

	readSessionCompactionState(
		sessionId: string,
	): SessionCompactionState | undefined {
		const path = this.resolveCompactionPath(sessionId);
		if (!existsSync(path)) {
			return undefined;
		}
		try {
			return parseSessionCompactionState(
				JSON.parse(readFileSync(path, "utf8")) as unknown,
			);
		} catch {
			return undefined;
		}
	}

	persistSessionCompactionState(
		sessionId: string,
		state: SessionCompactionState,
	): void {
		const path = this.resolveCompactionPath(sessionId);
		const payload = SessionCompactionStateSchema.parse(state);
		writeFileAtomicSync(path, `${JSON.stringify(payload, null, 2)}\n`);
	}

	deleteSessionCompactionState(sessionId: string): void {
		rmSync(this.resolveCompactionPath(sessionId), { force: true });
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
