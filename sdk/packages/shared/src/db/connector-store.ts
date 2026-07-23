import { existsSync, readFileSync, renameSync } from "node:fs";
import {
	resolveConnectorSettingsPath,
	resolveConnectorsDbPath,
} from "../storage/paths";
import {
	asOptionalString,
	asString,
	loadSqliteDb,
	nowIso,
	type SqliteDb,
	toBoolInt,
} from "./sqlite-db";

export interface ConnectorSecurityConfig {
	enabled: boolean;
	values: Record<string, string>;
}

/**
 * Persisted configuration for a single connector channel. `values` and
 * `security.values` hold the raw field values (including auth tokens/keys);
 * `connectArgs` holds the exact `cline connect <channel>` arguments recorded
 * from the last successful start so the connector can be relaunched after a
 * hub or CLI restart. `enabled` gates that auto-reconnect: it is set when a
 * connector starts and cleared when the user stops it explicitly.
 */
export interface ConnectorConfigRecord {
	channel: string;
	type: string;
	values: Record<string, string>;
	security?: ConnectorSecurityConfig;
	connectArgs?: string[];
	enabled: boolean;
	configuredAt: string;
	updatedAt: string;
	lastConnectedAt?: string;
}

const CONNECTOR_SCHEMA = `CREATE TABLE IF NOT EXISTS connectors (
	channel TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	values_json TEXT NOT NULL DEFAULT '{}',
	security_enabled INTEGER NOT NULL DEFAULT 0,
	security_values_json TEXT NOT NULL DEFAULT '{}',
	connect_args_json TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	configured_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	last_connected_at TEXT
);`;

export function ensureConnectorSchema(db: SqliteDb): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec(CONNECTOR_SCHEMA);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringRecord(raw: unknown): Record<string, string> {
	if (typeof raw !== "string" || !raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed)) {
			return {};
		}
		const entries: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string") {
				entries[key] = value;
			}
		}
		return entries;
	} catch {
		return {};
	}
}

function parseStringArray(raw: unknown): string[] | undefined {
	if (typeof raw !== "string" || !raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return undefined;
		}
		const args = parsed.filter((value) => typeof value === "string");
		return args.length > 0 ? args : undefined;
	} catch {
		return undefined;
	}
}

export interface SqliteConnectorStoreOptions {
	dbPath?: string;
}

/**
 * SQLite-backed store for connector configuration and credentials.
 * Replaces the legacy `~/.cline/data/connectors/settings.json` file; any
 * existing legacy file is imported on first open and renamed so the two
 * stores cannot diverge.
 */
export class SqliteConnectorStore {
	private readonly dbPath: string;
	private db: SqliteDb | undefined;

	constructor(options: SqliteConnectorStoreOptions = {}) {
		this.dbPath = options.dbPath ?? resolveConnectorsDbPath();
	}

	private getRawDb(): SqliteDb {
		if (this.db) {
			return this.db;
		}
		const db = loadSqliteDb(this.dbPath);
		ensureConnectorSchema(db);
		this.db = db;
		this.importLegacyJsonSettings();
		return db;
	}

	close(): void {
		this.db?.close?.();
		this.db = undefined;
	}

	get(channel: string): ConnectorConfigRecord | undefined {
		const row = this.getRawDb()
			.prepare(`SELECT * FROM connectors WHERE channel = ?`)
			.get(channel);
		return row ? rowToRecord(row) : undefined;
	}

	list(): ConnectorConfigRecord[] {
		return this.getRawDb()
			.prepare(`SELECT * FROM connectors ORDER BY channel ASC`)
			.all()
			.map(rowToRecord);
	}

	/**
	 * Create or update the stored configuration for a channel while preserving
	 * connection state (connect args, enabled flag, last-connected timestamp).
	 */
	upsertConfig(entry: {
		channel: string;
		type?: string;
		values: Record<string, string>;
		security?: ConnectorSecurityConfig;
		configuredAt?: string;
		updatedAt?: string;
	}): void {
		const now = nowIso();
		const existing = this.get(entry.channel);
		this.getRawDb()
			.prepare(
				`INSERT INTO connectors (
					channel, type, values_json, security_enabled, security_values_json,
					connect_args_json, enabled, configured_at, updated_at, last_connected_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(channel) DO UPDATE SET
					type = excluded.type,
					values_json = excluded.values_json,
					security_enabled = excluded.security_enabled,
					security_values_json = excluded.security_values_json,
					updated_at = excluded.updated_at`,
			)
			.run(
				entry.channel,
				entry.type ?? entry.channel,
				JSON.stringify(entry.values),
				toBoolInt(entry.security?.enabled === true),
				JSON.stringify(entry.security?.values ?? {}),
				existing?.connectArgs ? JSON.stringify(existing.connectArgs) : null,
				toBoolInt(existing?.enabled ?? true),
				entry.configuredAt ?? existing?.configuredAt ?? now,
				entry.updatedAt ?? now,
				existing?.lastConnectedAt ?? null,
			);
	}

	/**
	 * Record a successful `cline connect <channel>` start: keep the exact args
	 * (auth flags included) for auto-reconnect and re-enable the channel.
	 */
	recordConnected(channel: string, connectArgs: string[]): void {
		const now = nowIso();
		this.getRawDb()
			.prepare(
				`INSERT INTO connectors (
					channel, type, connect_args_json, enabled,
					configured_at, updated_at, last_connected_at
				) VALUES (?, ?, ?, 1, ?, ?, ?)
				ON CONFLICT(channel) DO UPDATE SET
					connect_args_json = excluded.connect_args_json,
					enabled = 1,
					updated_at = excluded.updated_at,
					last_connected_at = excluded.last_connected_at`,
			)
			.run(channel, channel, JSON.stringify(connectArgs), now, now, now);
	}

	/** Toggle auto-reconnect for a channel without dropping its config. */
	setEnabled(channel: string, enabled: boolean): void {
		this.getRawDb()
			.prepare(
				`UPDATE connectors SET enabled = ?, updated_at = ? WHERE channel = ?`,
			)
			.run(toBoolInt(enabled), nowIso(), channel);
	}

	disableAll(): void {
		this.getRawDb()
			.prepare(`UPDATE connectors SET enabled = 0, updated_at = ?`)
			.run(nowIso());
	}

	delete(channel: string): boolean {
		const changes =
			this.getRawDb()
				.prepare(`DELETE FROM connectors WHERE channel = ?`)
				.run(channel).changes ?? 0;
		return changes > 0;
	}

	/**
	 * One-time import of the legacy JSON settings file. Existing DB rows win;
	 * the file is renamed (not deleted) afterwards so older builds cannot keep
	 * writing to a store that is no longer read.
	 */
	private importLegacyJsonSettings(): void {
		const legacyPath = resolveConnectorSettingsPath();
		if (!existsSync(legacyPath)) {
			return;
		}
		try {
			const parsed = JSON.parse(readFileSync(legacyPath, "utf8")) as unknown;
			const connectors =
				isRecord(parsed) && isRecord(parsed.connectors)
					? parsed.connectors
					: {};
			for (const [channel, value] of Object.entries(connectors)) {
				if (!isRecord(value) || this.get(channel)) {
					continue;
				}
				const values: Record<string, string> = {};
				if (isRecord(value.values)) {
					for (const [key, raw] of Object.entries(value.values)) {
						if (typeof raw === "string") {
							values[key] = raw;
						}
					}
				}
				const securityValues: Record<string, string> = {};
				const security = isRecord(value.security) ? value.security : undefined;
				if (security && isRecord(security.values)) {
					for (const [key, raw] of Object.entries(security.values)) {
						if (typeof raw === "string") {
							securityValues[key] = raw;
						}
					}
				}
				this.upsertConfig({
					channel,
					type: typeof value.type === "string" ? value.type : channel,
					values,
					security: security
						? { enabled: security.enabled === true, values: securityValues }
						: undefined,
					configuredAt:
						typeof value.configuredAt === "string"
							? value.configuredAt
							: undefined,
					updatedAt:
						typeof value.updatedAt === "string" ? value.updatedAt : undefined,
				});
			}
			renameSync(legacyPath, `${legacyPath}.migrated`);
		} catch {
			// Leave an unreadable legacy file in place; the DB is authoritative.
		}
	}
}

function rowToRecord(row: Record<string, unknown>): ConnectorConfigRecord {
	const securityEnabled = row.security_enabled === 1;
	const securityValues = parseStringRecord(row.security_values_json);
	const hasSecurity = securityEnabled || Object.keys(securityValues).length > 0;
	return {
		channel: asString(row.channel),
		type: asString(row.type),
		values: parseStringRecord(row.values_json),
		security: hasSecurity
			? { enabled: securityEnabled, values: securityValues }
			: undefined,
		connectArgs: parseStringArray(row.connect_args_json),
		enabled: row.enabled === 1,
		configuredAt: asString(row.configured_at),
		updatedAt: asString(row.updated_at),
		lastConnectedAt: asOptionalString(row.last_connected_at),
	};
}

/**
 * Convenience wrapper that opens the store, runs `fn`, and always closes the
 * DB handle. Suitable for the infrequent configure/connect/stop operations;
 * long-lived processes that poll the store should hold their own instance.
 */
export function withConnectorStore<T>(
	fn: (store: SqliteConnectorStore) => T,
): T {
	const store = new SqliteConnectorStore();
	try {
		return fn(store);
	} finally {
		store.close();
	}
}
