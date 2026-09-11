import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { readFile, rm } from "node:fs/promises";
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
import type { SessionRow } from "../models/session-row";
import { writeFileAtomic } from "./atomic-file";

function isNotFoundError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

function sessionRowFromManifest(manifest: SessionManifest): SessionRow {
	return {
		sessionId: manifest.session_id,
		source: manifest.source,
		pid: manifest.pid,
		startedAt: manifest.started_at,
		endedAt: manifest.ended_at ?? null,
		exitCode: manifest.exit_code ?? null,
		status: manifest.status,
		statusLock: 0,
		interactive: manifest.interactive,
		provider: manifest.provider,
		model: manifest.model,
		cwd: manifest.cwd,
		workspaceRoot: manifest.workspace_root,
		teamName: manifest.team_name ?? null,
		enableTools: manifest.enable_tools,
		enableSpawn: manifest.enable_spawn,
		enableTeams: manifest.enable_teams,
		parentSessionId: null,
		parentAgentId: null,
		agentId: null,
		conversationId: null,
		isSubagent: false,
		prompt: manifest.prompt ?? null,
		metadata: manifest.metadata ?? null,
		hookPath: "",
		messagesPath: manifest.messages_path ?? null,
		updatedAt: nowIso(),
	};
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
		row: SessionRow,
		path: string,
		startedAt: string,
	): void {
		writeEmptyMessagesFile(path, startedAt, resolveMessagesFileContext(row));
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

	/**
	 * Asynchronously read only the manifest `metadata.title`.
	 *
	 * The session-listing hot path needs nothing from the manifest except the
	 * title, but the manifest JSON can be large (it embeds metadata and prompt
	 * text). This reads the file off the event-loop thread and pulls the title
	 * out of the parsed JSON directly, skipping the full `SessionManifestSchema`
	 * (Zod) validation that `readSessionManifest` performs. On any error (missing
	 * file, malformed JSON, non-string title) it resolves to `undefined` so
	 * callers fall back to the row metadata/prompt title.
	 */
	async readSessionManifestTitle(
		sessionId: string,
	): Promise<string | undefined> {
		const manifestPath = this.artifacts.sessionManifestPath(sessionId, false);
		let raw: string;
		try {
			raw = await readFile(manifestPath, "utf8");
		} catch {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return undefined;
			}
			const metadata = (parsed as { metadata?: unknown }).metadata;
			if (
				!metadata ||
				typeof metadata !== "object" ||
				Array.isArray(metadata)
			) {
				return undefined;
			}
			const title = (metadata as { title?: unknown }).title;
			return typeof title === "string" ? title : undefined;
		} catch {
			return undefined;
		}
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

	/**
	 * Resolve the session row backing a message write, re-adopting it from the
	 * on-disk manifest when the DB row is missing (session artifacts restored
	 * or copied while the session DB was rebuilt). Sessions with neither a row
	 * nor a manifest throw so message writes cannot silently recreate
	 * orphaned session files.
	 */
	private async resolveSessionRow(sessionId: string): Promise<SessionRow> {
		const row = await this.adapter.getSession(sessionId);
		if (row) {
			return row;
		}
		const { manifest } = this.readManifestFile(sessionId);
		if (!manifest) {
			throw new Error(
				`Cannot persist messages for unknown session: ${sessionId}`,
			);
		}
		const adopted = sessionRowFromManifest(manifest);
		await this.adapter.upsertSession(adopted);
		this.logger?.debug("Re-adopted session row from manifest", { sessionId });
		return adopted;
	}

	async persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.MessageWithMetadata[],
		systemPrompt?: string,
	): Promise<void> {
		const row = await this.resolveSessionRow(sessionId);
		const path =
			typeof row.messagesPath === "string" && row.messagesPath.trim().length > 0
				? row.messagesPath
				: this.artifacts.sessionMessagesPath(sessionId);
		const payload = buildMessagesFilePayload({
			updatedAt: nowIso(),
			context: resolveMessagesFileContext(row),
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

	private updateCompactionPath(
		sessionId: string,
		path: string | undefined,
	): void {
		const manifestFile = this.readManifestFile(sessionId);
		if (!manifestFile.manifest) {
			return;
		}
		if (manifestFile.manifest.compaction_path === path) {
			return;
		}
		this.writeSessionManifest(manifestFile.path, {
			...manifestFile.manifest,
			compaction_path: path,
		});
	}

	async readSessionCompactionState(
		sessionId: string,
	): Promise<SessionCompactionState | undefined> {
		const path = this.resolveCompactionPath(sessionId);
		try {
			return parseSessionCompactionState(
				JSON.parse(await readFile(path, "utf8")) as unknown,
			);
		} catch (error) {
			if (isNotFoundError(error)) {
				return undefined;
			}
			this.logger?.debug("Ignoring invalid session compaction state", {
				sessionId,
				path,
				error,
				recovery:
					"Canonical history is unchanged; deleting the sidecar is safe.",
			});
			return undefined;
		}
	}

	async persistSessionCompactionState(
		sessionId: string,
		state: SessionCompactionState,
	): Promise<void> {
		const path = this.resolveCompactionPath(sessionId);
		const payload = SessionCompactionStateSchema.parse(state);
		await writeFileAtomic(path, `${JSON.stringify(payload, null, 2)}\n`);
		this.updateCompactionPath(sessionId, path);
	}

	async deleteSessionCompactionState(sessionId: string): Promise<void> {
		await rm(this.resolveCompactionPath(sessionId), { force: true });
		this.updateCompactionPath(sessionId, undefined);
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
