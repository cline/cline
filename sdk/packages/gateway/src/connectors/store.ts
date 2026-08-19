/**
 * Connector persistence (Gateway RFC, Phase 6).
 *
 * Connectors are bot-scoped: the config row, the conversation routes,
 * and the dedupe cursor all live in the bot namespace, and every
 * connector targets exactly one bot. The stores enforce that scoping so
 * an adapter instance can never read (let alone use) another bot's
 * connector config or credential reference.
 */

import type { ConnectorRoute, ConnectorRouteRepository } from "@cline/bot";
import type {
	BotId,
	ConnectorId,
	PrincipalId,
	SessionId,
	WorkerId,
} from "@cline/shared/gateway";
import type { GatewayDatabase } from "../db";

export type ConnectorStatus = "enabled" | "disabled";

export interface ConnectorRecord {
	readonly connectorId: ConnectorId;
	readonly botId: BotId;
	readonly kind: string;
	readonly name: string;
	/** Non-secret adapter configuration. */
	readonly config: Readonly<Record<string, unknown>>;
	/** Name of the owner-only 0600 secret file — never the secret. */
	readonly credentialRef?: string;
	readonly status: ConnectorStatus;
	readonly createdAt: number;
	readonly revision: number;
}

function rowToConnector(row: Record<string, unknown>): ConnectorRecord {
	return {
		connectorId: String(row.connector_id) as ConnectorId,
		botId: String(row.bot_id) as BotId,
		kind: String(row.kind),
		name: String(row.name),
		config: JSON.parse(String(row.config_json)) as Record<string, unknown>,
		credentialRef:
			row.credential_ref === null ? undefined : String(row.credential_ref),
		status: String(row.status) as ConnectorStatus,
		createdAt: Number(row.created_at),
		revision: Number(row.revision),
	};
}

export class ConnectorScopeViolationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConnectorScopeViolationError";
	}
}

export class ConnectorStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(connectorId: ConnectorId): ConnectorRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM connectors WHERE connector_id = ?;")
			.get(connectorId);
		return row ? rowToConnector(row) : undefined;
	}

	/**
	 * Bot-scoped read: the caller must name the bot it is acting for, and
	 * a mismatch is an error — not an empty result — so cross-bot access
	 * attempts surface loudly.
	 */
	getForBot(botId: BotId, connectorId: ConnectorId): ConnectorRecord {
		const record = this.get(connectorId);
		if (!record) {
			throw new ConnectorScopeViolationError(
				`Unknown connector: ${connectorId}`,
			);
		}
		if (record.botId !== botId) {
			throw new ConnectorScopeViolationError(
				`Connector ${connectorId} belongs to bot ${record.botId}, not ${botId}`,
			);
		}
		return record;
	}

	list(botId?: BotId): readonly ConnectorRecord[] {
		if (botId) {
			return this.database.db
				.prepare(
					"SELECT * FROM connectors WHERE bot_id = ? ORDER BY created_at, connector_id;",
				)
				.all(botId)
				.map(rowToConnector);
		}
		return this.database.db
			.prepare("SELECT * FROM connectors ORDER BY created_at, connector_id;")
			.all()
			.map(rowToConnector);
	}

	listEnabled(): readonly ConnectorRecord[] {
		return this.database.db
			.prepare(
				"SELECT * FROM connectors WHERE status = 'enabled' ORDER BY created_at, connector_id;",
			)
			.all()
			.map(rowToConnector);
	}

	save(record: ConnectorRecord): void {
		const existing = this.get(record.connectorId);
		if (existing && existing.botId !== record.botId) {
			// A connector targets exactly one bot, forever.
			throw new ConnectorScopeViolationError(
				`Connector ${record.connectorId} cannot move from bot ${existing.botId} to ${record.botId}`,
			);
		}
		this.database.db
			.prepare(
				`INSERT INTO connectors (
					connector_id, bot_id, kind, name, config_json, credential_ref,
					status, created_at, revision
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(connector_id) DO UPDATE SET
					name = excluded.name,
					config_json = excluded.config_json,
					credential_ref = excluded.credential_ref,
					status = excluded.status,
					revision = excluded.revision;`,
			)
			.run(
				record.connectorId,
				record.botId,
				record.kind,
				record.name,
				JSON.stringify(record.config),
				record.credentialRef ?? null,
				record.status,
				record.createdAt,
				record.revision,
			);
	}
}

// -----------------------------------------------------------------------------
// Routes: (connectorId, externalAccountId, externalConversationId) ->
//         (botId, sessionId, principal context)
// -----------------------------------------------------------------------------

export class SqliteConnectorRouteStore implements ConnectorRouteRepository {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(
		connectorId: ConnectorId,
		externalAccountId: string,
		externalConversationId: string,
	): ConnectorRoute | undefined {
		const row = this.database.db
			.prepare(
				`SELECT * FROM connector_routes
				WHERE connector_id = ? AND external_account_id = ? AND external_conversation_id = ?;`,
			)
			.get(connectorId, externalAccountId, externalConversationId);
		if (!row) {
			return undefined;
		}
		return {
			connectorId: String(row.connector_id) as ConnectorId,
			externalAccountId: String(row.external_account_id),
			externalConversationId: String(row.external_conversation_id),
			botId: String(row.bot_id) as BotId,
			sessionId: String(row.session_id) as SessionId,
			principalId:
				row.principal_id === null
					? undefined
					: (String(row.principal_id) as PrincipalId),
			createdAt: Number(row.created_at),
		};
	}

	save(route: ConnectorRoute): void {
		this.database.db
			.prepare(
				`INSERT INTO connector_routes (
					connector_id, external_account_id, external_conversation_id,
					bot_id, session_id, principal_id, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(connector_id, external_account_id, external_conversation_id) DO UPDATE SET
					session_id = excluded.session_id,
					principal_id = excluded.principal_id;`,
			)
			.run(
				route.connectorId,
				route.externalAccountId,
				route.externalConversationId,
				route.botId,
				route.sessionId,
				route.principalId ?? null,
				route.createdAt,
			);
	}

	listByConnector(connectorId: ConnectorId): readonly ConnectorRoute[] {
		return this.database.db
			.prepare(
				"SELECT * FROM connector_routes WHERE connector_id = ? ORDER BY created_at;",
			)
			.all(connectorId)
			.map((row) => ({
				connectorId: String(row.connector_id) as ConnectorId,
				externalAccountId: String(row.external_account_id),
				externalConversationId: String(row.external_conversation_id),
				botId: String(row.bot_id) as BotId,
				sessionId: String(row.session_id) as SessionId,
				principalId:
					row.principal_id === null
						? undefined
						: (String(row.principal_id) as PrincipalId),
				createdAt: Number(row.created_at),
			}));
	}
}

// -----------------------------------------------------------------------------
// Dedupe cursor: committed in the same transaction as the admitted work
// -----------------------------------------------------------------------------

export class ConnectorCursorStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(connectorId: ConnectorId): string | undefined {
		const row = this.database.db
			.prepare("SELECT cursor FROM connector_cursors WHERE connector_id = ?;")
			.get(connectorId);
		return row ? String(row.cursor) : undefined;
	}

	set(connectorId: ConnectorId, cursor: string, now: number): void {
		this.database.db
			.prepare(
				`INSERT INTO connector_cursors (connector_id, cursor, updated_at)
				VALUES (?, ?, ?)
				ON CONFLICT(connector_id) DO UPDATE SET
					cursor = excluded.cursor,
					updated_at = excluded.updated_at;`,
			)
			.run(connectorId, cursor, now);
	}
}

// -----------------------------------------------------------------------------
// Instance registry: one live worker per connector instance
// -----------------------------------------------------------------------------

export interface ConnectorInstanceClaim {
	readonly connectorId: ConnectorId;
	readonly workerId: WorkerId;
	readonly gatewayInstanceId: string;
	readonly startedAt: number;
	readonly heartbeatAt: number;
}

export class ConnectorInstanceStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(connectorId: ConnectorId): ConnectorInstanceClaim | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM connector_instances WHERE connector_id = ?;")
			.get(connectorId);
		if (!row) {
			return undefined;
		}
		return {
			connectorId: String(row.connector_id) as ConnectorId,
			workerId: String(row.worker_id) as WorkerId,
			gatewayInstanceId: String(row.gateway_instance_id),
			startedAt: Number(row.started_at),
			heartbeatAt: Number(row.heartbeat_at),
		};
	}

	/**
	 * Claim the single worker slot for a connector. Succeeds when no
	 * claim exists, when the claim belongs to this Gateway instance
	 * (restart after crash of the worker task), or when the previous
	 * claim's heartbeat is stale (its process is gone). A live foreign
	 * claim wins: no duplicate instance is ever created.
	 */
	claim(
		connectorId: ConnectorId,
		workerId: WorkerId,
		gatewayInstanceId: string,
		now: number,
		staleAfterMs: number,
	): boolean {
		const existing = this.get(connectorId);
		if (
			existing &&
			existing.gatewayInstanceId !== gatewayInstanceId &&
			now - existing.heartbeatAt < staleAfterMs
		) {
			return false;
		}
		this.database.db
			.prepare(
				`INSERT INTO connector_instances (
					connector_id, worker_id, gateway_instance_id, started_at, heartbeat_at
				) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(connector_id) DO UPDATE SET
					worker_id = excluded.worker_id,
					gateway_instance_id = excluded.gateway_instance_id,
					started_at = excluded.started_at,
					heartbeat_at = excluded.heartbeat_at;`,
			)
			.run(connectorId, workerId, gatewayInstanceId, now, now);
		return true;
	}

	heartbeat(connectorId: ConnectorId, workerId: WorkerId, now: number): void {
		this.database.db
			.prepare(
				"UPDATE connector_instances SET heartbeat_at = ? WHERE connector_id = ? AND worker_id = ?;",
			)
			.run(now, connectorId, workerId);
	}

	release(connectorId: ConnectorId, workerId: WorkerId): void {
		this.database.db
			.prepare(
				"DELETE FROM connector_instances WHERE connector_id = ? AND worker_id = ?;",
			)
			.run(connectorId, workerId);
	}
}
