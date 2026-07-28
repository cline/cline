import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
	SessionMessage,
	SessionMessageDelivery,
	SessionMessageStatus,
} from "@cline/shared";
import { safeJsonParse } from "@cline/shared";
import { loadSqliteDb, nowIso, type SqliteDb } from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";
import type { ListInboxOptions, SessionMailStore } from "../../types/storage";

export interface SqliteSessionMailStoreOptions {
	mailDir?: string;
}

interface SessionMailRow {
	message_id: string;
	from_session_id: string;
	from_label: string | null;
	to_session_id: string;
	subject: string;
	body: string;
	delivery: string;
	status: string;
	hop_count: number;
	hop_chain_json: string;
	sent_at: string;
	delivered_at: string | null;
	read_at: string | null;
	dropped_reason: string | null;
}

function parseHopChain(raw: string): string[] {
	const parsed = safeJsonParse<unknown>(raw);
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed.filter((entry): entry is string => typeof entry === "string");
}

function rowToMessage(row: SessionMailRow): SessionMessage {
	return {
		id: row.message_id,
		fromSessionId: row.from_session_id,
		fromLabel: row.from_label ?? undefined,
		toSessionId: row.to_session_id,
		subject: row.subject,
		body: row.body,
		delivery: row.delivery as SessionMessageDelivery,
		status: row.status as SessionMessageStatus,
		hopCount: row.hop_count,
		hopChain: parseHopChain(row.hop_chain_json),
		sentAt: new Date(row.sent_at),
		deliveredAt: row.delivered_at ? new Date(row.delivered_at) : undefined,
		readAt: row.read_at ? new Date(row.read_at) : undefined,
		droppedReason: row.dropped_reason ?? undefined,
	};
}

export class SqliteSessionMailStore implements SessionMailStore {
	private readonly mailDirPath: string;
	private db: SqliteDb | undefined;

	constructor(options: SqliteSessionMailStoreOptions = {}) {
		this.mailDirPath = options.mailDir ?? resolveDbDataDir();
	}

	init(): void {
		this.getRawDb();
	}

	private ensureMailDir(): string {
		if (!existsSync(this.mailDirPath)) {
			mkdirSync(this.mailDirPath, { recursive: true });
		}
		return this.mailDirPath;
	}

	private getRawDb(): SqliteDb {
		if (this.db) {
			return this.db;
		}
		const db = loadSqliteDb(join(this.ensureMailDir(), "session-mail.db"));
		this.ensureSchema(db);
		this.db = db;
		return db;
	}

	private ensureSchema(db: SqliteDb): void {
		db.exec("PRAGMA journal_mode = WAL;");
		db.exec("PRAGMA busy_timeout = 5000;");
		db.exec(`
			CREATE TABLE IF NOT EXISTS session_mail (
				message_id TEXT PRIMARY KEY,
				from_session_id TEXT NOT NULL,
				from_label TEXT,
				to_session_id TEXT NOT NULL,
				subject TEXT NOT NULL,
				body TEXT NOT NULL,
				delivery TEXT NOT NULL,
				status TEXT NOT NULL,
				hop_count INTEGER NOT NULL DEFAULT 1,
				hop_chain_json TEXT NOT NULL DEFAULT '[]',
				sent_at TEXT NOT NULL,
				delivered_at TEXT,
				read_at TEXT,
				dropped_reason TEXT
			);
		`);
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_session_mail_recipient
				ON session_mail(to_session_id, status, sent_at DESC);
		`);
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_session_mail_sender
				ON session_mail(from_session_id, sent_at DESC);
		`);
	}

	private run(sql: string, params: unknown[] = []): void {
		this.getRawDb()
			.prepare(sql)
			.run(...params);
	}

	private queryAll<T>(sql: string, params: unknown[] = []): T[] {
		return this.getRawDb()
			.prepare(sql)
			.all(...params) as T[];
	}

	append(message: SessionMessage): void {
		this.run(
			`INSERT INTO session_mail (
				message_id, from_session_id, from_label, to_session_id, subject, body,
				delivery, status, hop_count, hop_chain_json, sent_at, delivered_at,
				read_at, dropped_reason
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(message_id) DO UPDATE SET
				status = excluded.status,
				delivered_at = excluded.delivered_at,
				read_at = excluded.read_at,
				dropped_reason = excluded.dropped_reason`,
			[
				message.id,
				message.fromSessionId,
				message.fromLabel ?? null,
				message.toSessionId,
				message.subject,
				message.body,
				message.delivery,
				message.status,
				message.hopCount,
				JSON.stringify(message.hopChain),
				message.sentAt.toISOString(),
				message.deliveredAt?.toISOString() ?? null,
				message.readAt?.toISOString() ?? null,
				message.droppedReason ?? null,
			],
		);
	}

	get(messageId: string): SessionMessage | undefined {
		const [row] = this.queryAll<SessionMailRow>(
			`SELECT * FROM session_mail WHERE message_id = ?`,
			[messageId],
		);
		return row ? rowToMessage(row) : undefined;
	}

	listInbox(
		sessionId: string,
		options: ListInboxOptions = {},
	): SessionMessage[] {
		const clauses = ["to_session_id = ?", "status != 'dropped'"];
		const params: unknown[] = [sessionId];
		if (options.unreadOnly) {
			clauses.push("read_at IS NULL");
		}
		if (options.status) {
			clauses.push("status = ?");
			params.push(options.status);
		}
		const limit = options.limit && options.limit > 0 ? options.limit : 100;
		return this.queryAll<SessionMailRow>(
			`SELECT * FROM session_mail
			 WHERE ${clauses.join(" AND ")}
			 ORDER BY sent_at ASC
			 LIMIT ?`,
			[...params, limit],
		).map(rowToMessage);
	}

	markDelivered(messageId: string): void {
		this.run(
			`UPDATE session_mail
			 SET status = 'delivered', delivered_at = ?
			 WHERE message_id = ? AND status = 'pending'`,
			[nowIso(), messageId],
		);
	}

	markRead(messageIds: string[]): void {
		if (messageIds.length === 0) {
			return;
		}
		const placeholders = messageIds.map(() => "?").join(", ");
		this.run(
			`UPDATE session_mail
			 SET status = 'read', read_at = COALESCE(read_at, ?)
			 WHERE message_id IN (${placeholders}) AND status != 'dropped'`,
			[nowIso(), ...messageIds],
		);
	}

	markDropped(messageId: string, reason: string): void {
		this.run(
			`UPDATE session_mail SET status = 'dropped', dropped_reason = ?
			 WHERE message_id = ?`,
			[reason, messageId],
		);
	}

	countSentSince(fromSessionId: string, since: Date): number {
		const [row] = this.queryAll<{ total: number }>(
			`SELECT COUNT(*) AS total FROM session_mail
			 WHERE from_session_id = ? AND sent_at >= ?`,
			[fromSessionId, since.toISOString()],
		);
		return row?.total ?? 0;
	}
}
