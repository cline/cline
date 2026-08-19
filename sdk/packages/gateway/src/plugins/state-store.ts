/**
 * Durable plugin state (Gateway RFC, Phase 4).
 *
 * Mutable plugin state is session-scoped by default (it lives in the
 * session binding and dies with it). Anything durable goes through this
 * Gateway storage port: a namespaced key/value store in the authority
 * database, scoped so one plugin (and one scope) can never read another's
 * values.
 */

import type { GatewayDatabase } from "../db";

/**
 * Storage scope string. Callers build scopes from bound context —
 * `global`, `bot:<botId>`, `workspace:<workspaceId>` — so state written
 * under one binding is invisible to another.
 */
export type PluginStateScope = string;

export interface PluginStateStorePort {
	get(key: string): unknown;
	set(key: string, value: unknown): void;
	delete(key: string): void;
	keys(): readonly string[];
}

export class PluginStateStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(pluginName: string, scope: PluginStateScope, key: string): unknown {
		const row = this.database.db
			.prepare(
				"SELECT value_json FROM plugin_state WHERE plugin_name = ? AND scope = ? AND key = ?;",
			)
			.get(pluginName, scope, key);
		return row ? JSON.parse(String(row.value_json)) : undefined;
	}

	set(
		pluginName: string,
		scope: PluginStateScope,
		key: string,
		value: unknown,
		now: number,
	): void {
		this.database.db
			.prepare(
				`INSERT INTO plugin_state (plugin_name, scope, key, value_json, updated_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(plugin_name, scope, key) DO UPDATE SET
					value_json = excluded.value_json,
					updated_at = excluded.updated_at;`,
			)
			.run(pluginName, scope, key, JSON.stringify(value ?? null), now);
	}

	delete(pluginName: string, scope: PluginStateScope, key: string): void {
		this.database.db
			.prepare(
				"DELETE FROM plugin_state WHERE plugin_name = ? AND scope = ? AND key = ?;",
			)
			.run(pluginName, scope, key);
	}

	keys(pluginName: string, scope: PluginStateScope): readonly string[] {
		return this.database.db
			.prepare(
				"SELECT key FROM plugin_state WHERE plugin_name = ? AND scope = ? ORDER BY key;",
			)
			.all(pluginName, scope)
			.map((row) => String(row.key));
	}

	/** A port view locked to one plugin and one scope. */
	portFor(
		pluginName: string,
		scope: PluginStateScope,
		clock: () => number = () => Date.now(),
	): PluginStateStorePort {
		return {
			get: (key) => this.get(pluginName, scope, key),
			set: (key, value) => this.set(pluginName, scope, key, value, clock()),
			delete: (key) => this.delete(pluginName, scope, key),
			keys: () => this.keys(pluginName, scope),
		};
	}
}
