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

/** Dashboard-managed configuration for a connector channel. */
export interface ConnectorConfigRecord {
	channel: string;
	type: string;
	values: Record<string, string>;
	security?: ConnectorSecurityConfig;
	configuredAt: string;
	updatedAt: string;
}

/** A successfully launched connector instance eligible for auto-reconnect. */
export interface ConnectorConnectionRecord {
	channel: string;
	instanceId: string;
	connectArgs: string[];
	lastSuccessfulArgs: string[];
	enabled: boolean;
	updatedAt: string;
	lastConnectedAt: string;
}

const CONNECTOR_CONFIG_SCHEMA = `CREATE TABLE IF NOT EXISTS connector_configs (
	channel TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	values_json TEXT NOT NULL DEFAULT '{}',
	security_enabled INTEGER NOT NULL DEFAULT 0,
	security_values_json TEXT NOT NULL DEFAULT '{}',
	configured_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);`;

const CONNECTOR_CONNECTION_SCHEMA = `CREATE TABLE IF NOT EXISTS connector_connections (
	channel TEXT NOT NULL,
	instance_id TEXT NOT NULL,
	connect_args_json TEXT NOT NULL,
	last_successful_args_json TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	updated_at TEXT NOT NULL,
	last_connected_at TEXT NOT NULL,
	PRIMARY KEY (channel, instance_id)
);`;

export function ensureConnectorSchema(db: SqliteDb): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec(CONNECTOR_CONFIG_SCHEMA);
	db.exec(CONNECTOR_CONNECTION_SCHEMA);
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
		return parsed.filter((value) => typeof value === "string");
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

	getConfig(channel: string): ConnectorConfigRecord | undefined {
		const row = this.getRawDb()
			.prepare(`SELECT * FROM connector_configs WHERE channel = ?`)
			.get(channel);
		return row ? rowToConfigRecord(row) : undefined;
	}

	listConfigs(): ConnectorConfigRecord[] {
		return this.getRawDb()
			.prepare(`SELECT * FROM connector_configs ORDER BY channel ASC`)
			.all()
			.map(rowToConfigRecord);
	}

	getConnection(
		channel: string,
		instanceId: string,
	): ConnectorConnectionRecord | undefined {
		const row = this.getRawDb()
			.prepare(
				`SELECT * FROM connector_connections
				 WHERE channel = ? AND instance_id = ?`,
			)
			.get(channel, instanceId);
		return row ? rowToConnectionRecord(row) : undefined;
	}

	listConnections(channel?: string): ConnectorConnectionRecord[] {
		const rows = channel
			? this.getRawDb()
					.prepare(
						`SELECT * FROM connector_connections
						 WHERE channel = ?
						 ORDER BY instance_id ASC`,
					)
					.all(channel)
			: this.getRawDb()
					.prepare(
						`SELECT * FROM connector_connections
						 ORDER BY channel ASC, instance_id ASC`,
					)
					.all();
		return rows.map(rowToConnectionRecord);
	}

	/**
	 * Create or update dashboard configuration. If exactly one persisted
	 * instance exists, its desired reconnect arguments may be updated
	 * atomically. With multiple instances, only the channel-wide dashboard
	 * configuration is updated because choosing reconnect args is ambiguous.
	 */
	upsertConfig(entry: {
		channel: string;
		type?: string;
		values: Record<string, string>;
		security?: ConnectorSecurityConfig;
		updateConnectArgs?: (existing: {
			config?: ConnectorConfigRecord;
			connection: ConnectorConnectionRecord;
		}) => string[];
		configuredAt?: string;
		updatedAt?: string;
	}): void {
		const now = nowIso();
		const db = this.getRawDb();
		db.exec("BEGIN IMMEDIATE;");
		try {
			const existingConfigRow = db
				.prepare(`SELECT * FROM connector_configs WHERE channel = ?`)
				.get(entry.channel);
			const existingConfig = existingConfigRow
				? rowToConfigRecord(existingConfigRow)
				: undefined;
			const connectionRows = db
				.prepare(`SELECT * FROM connector_connections WHERE channel = ?`)
				.all(entry.channel);
			const connections = connectionRows.map(rowToConnectionRecord);
			const updatedConnectionArgs =
				entry.updateConnectArgs && connections.length === 1 && connections[0]
					? entry.updateConnectArgs({
							config: existingConfig,
							connection: connections[0],
						})
					: undefined;
			db.prepare(
				`INSERT INTO connector_configs (
					channel, type, values_json, security_enabled,
					security_values_json, configured_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(channel) DO UPDATE SET
					type = excluded.type,
					values_json = excluded.values_json,
					security_enabled = excluded.security_enabled,
					security_values_json = excluded.security_values_json,
					configured_at = excluded.configured_at,
					updated_at = excluded.updated_at`,
			).run(
				entry.channel,
				entry.type ?? entry.channel,
				JSON.stringify(entry.values),
				toBoolInt(entry.security?.enabled === true),
				JSON.stringify(entry.security?.values ?? {}),
				entry.configuredAt ?? existingConfig?.configuredAt ?? now,
				entry.updatedAt ?? now,
			);
			if (updatedConnectionArgs && connections[0]) {
				db.prepare(
					`UPDATE connector_connections
					 SET connect_args_json = ?, updated_at = ?
					 WHERE channel = ? AND instance_id = ?`,
				).run(
					JSON.stringify(updatedConnectionArgs),
					now,
					entry.channel,
					connections[0].instanceId,
				);
			}
			db.exec("COMMIT;");
		} catch (error) {
			try {
				db.exec("ROLLBACK;");
			} catch {
				// Preserve the original transaction failure.
			}
			throw error;
		}
	}

	/**
	 * Record a successful `cline connect <channel>` start: keep the exact args
	 * (auth flags included) for auto-reconnect and re-enable the channel.
	 */
	recordConnected(
		channel: string,
		instanceId: string,
		connectArgs: string[],
	): void {
		const now = nowIso();
		this.getRawDb()
			.prepare(
				`INSERT INTO connector_connections (
					channel, instance_id, connect_args_json,
					last_successful_args_json, enabled, updated_at, last_connected_at
				) VALUES (?, ?, ?, ?, 1, ?, ?)
				ON CONFLICT(channel, instance_id) DO UPDATE SET
					connect_args_json = excluded.connect_args_json,
					last_successful_args_json = excluded.last_successful_args_json,
					enabled = 1,
					updated_at = excluded.updated_at,
					last_connected_at = excluded.last_connected_at`,
			)
			.run(
				channel,
				instanceId,
				JSON.stringify(connectArgs),
				JSON.stringify(connectArgs),
				now,
				now,
			);
	}

	/** Toggle auto-reconnect for one instance or every instance in a channel. */
	setEnabled(channel: string, enabled: boolean, instanceId?: string): void {
		if (instanceId) {
			this.getRawDb()
				.prepare(
					`UPDATE connector_connections
					 SET enabled = ?, updated_at = ?
					 WHERE channel = ? AND instance_id = ?`,
				)
				.run(toBoolInt(enabled), nowIso(), channel, instanceId);
			return;
		}
		this.getRawDb()
			.prepare(
				`UPDATE connector_connections
				 SET enabled = ?, updated_at = ?
				 WHERE channel = ?`,
			)
			.run(toBoolInt(enabled), nowIso(), channel);
	}

	deleteConnection(channel: string, instanceId: string): boolean {
		const changes =
			this.getRawDb()
				.prepare(
					`DELETE FROM connector_connections
					 WHERE channel = ? AND instance_id = ?`,
				)
				.run(channel, instanceId).changes ?? 0;
		return changes > 0;
	}

	disableAll(): void {
		this.getRawDb()
			.prepare(`UPDATE connector_connections SET enabled = 0, updated_at = ?`)
			.run(nowIso());
	}

	/**
	 * Remove only dashboard-managed configuration. Persisted CLI instances live
	 * in a separate table and are intentionally unaffected.
	 */
	deleteConfig(channel: string): boolean {
		const changes =
			this.getRawDb()
				.prepare(`DELETE FROM connector_configs WHERE channel = ?`)
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
				if (!isRecord(value) || this.getConfig(channel)) {
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

function rowToConfigRecord(
	row: Record<string, unknown>,
): ConnectorConfigRecord {
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
		configuredAt: asString(row.configured_at),
		updatedAt: asString(row.updated_at),
	};
}

function rowToConnectionRecord(
	row: Record<string, unknown>,
): ConnectorConnectionRecord {
	return {
		channel: asString(row.channel),
		instanceId: asString(row.instance_id),
		connectArgs: parseStringArray(row.connect_args_json) ?? [],
		lastSuccessfulArgs: parseStringArray(row.last_successful_args_json) ?? [],
		enabled: row.enabled === 1,
		updatedAt: asString(row.updated_at),
		lastConnectedAt:
			asOptionalString(row.last_connected_at) ?? asString(row.updated_at),
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
