import type { BotToolConfiguration, ToolProfile } from "@cline/shared/gateway";
import {
	BotToolConfigurationSchema,
	ToolProfileSchema,
} from "@cline/shared/gateway";
import type { GatewayDatabase } from "../db";
import { DEFAULT_TOOL_PROFILES } from "./profiles";

export type ToolConfigurationScope =
	| { kind: "global" }
	| { kind: "workspace"; workspaceRoot: string }
	| { kind: "bot"; botId: string };

function scopeKey(scope: ToolConfigurationScope): [string, string] {
	switch (scope.kind) {
		case "global":
			return ["global", "global"];
		case "workspace":
			return ["workspace", scope.workspaceRoot];
		case "bot":
			return ["bot", scope.botId];
	}
}

export interface VersionedToolConfiguration {
	readonly scope: ToolConfigurationScope;
	readonly revision: number;
	readonly config: BotToolConfiguration;
	readonly updatedAt: number;
}

export class ToolConfigurationStore {
	constructor(private readonly database: GatewayDatabase) {}

	bootstrap(now = Date.now()): void {
		for (const profile of DEFAULT_TOOL_PROFILES) {
			this.database.db
				.prepare(
					"INSERT OR IGNORE INTO tool_profiles (name, revision, definition_json, updated_at) VALUES (?, ?, ?, ?);",
				)
				.run(profile.name, profile.revision, JSON.stringify(profile), now);
		}
	}

	listProfiles(): readonly ToolProfile[] {
		return this.database.db
			.prepare("SELECT definition_json FROM tool_profiles ORDER BY name;")
			.all()
			.map((row) =>
				ToolProfileSchema.parse(JSON.parse(String(row.definition_json))),
			);
	}

	putProfile(
		profile: ToolProfile,
		expectedRevision?: number,
		now = Date.now(),
	): ToolProfile {
		const parsed = ToolProfileSchema.parse(profile);
		const existing = this.database.db
			.prepare("SELECT revision FROM tool_profiles WHERE name = ?;")
			.get(parsed.name);
		const actual = existing ? Number(existing.revision) : 0;
		if (expectedRevision !== undefined && actual !== expectedRevision) {
			throw new Error(
				`Tool profile revision conflict for ${parsed.name}: expected ${expectedRevision}, got ${actual}`,
			);
		}
		const next = { ...parsed, revision: actual + 1 };
		this.database.db
			.prepare(
				"INSERT INTO tool_profiles (name, revision, definition_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET revision = excluded.revision, definition_json = excluded.definition_json, updated_at = excluded.updated_at;",
			)
			.run(next.name, next.revision, JSON.stringify(next), now);
		return next;
	}

	get(scope: ToolConfigurationScope): VersionedToolConfiguration | undefined {
		const [kind, key] = scopeKey(scope);
		const row = this.database.db
			.prepare(
				"SELECT * FROM tool_configurations WHERE scope_type = ? AND scope_key = ?;",
			)
			.get(kind, key);
		if (!row) return undefined;
		return {
			scope,
			revision: Number(row.revision),
			config: BotToolConfigurationSchema.parse(
				JSON.parse(String(row.config_json)),
			),
			updatedAt: Number(row.updated_at),
		};
	}

	put(
		scope: ToolConfigurationScope,
		config: BotToolConfiguration,
		expectedRevision?: number,
		now = Date.now(),
	): VersionedToolConfiguration {
		const parsed = BotToolConfigurationSchema.parse(config);
		const current = this.get(scope);
		const actual = current?.revision ?? 0;
		if (expectedRevision !== undefined && actual !== expectedRevision) {
			throw new Error(
				`Tool configuration revision conflict: expected ${expectedRevision}, got ${actual}`,
			);
		}
		const revision = actual + 1;
		const [kind, key] = scopeKey(scope);
		this.database.db
			.prepare(
				"INSERT INTO tool_configurations (scope_type, scope_key, revision, config_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope_type, scope_key) DO UPDATE SET revision = excluded.revision, config_json = excluded.config_json, updated_at = excluded.updated_at;",
			)
			.run(kind, key, revision, JSON.stringify(parsed), now);
		return { scope, revision, config: parsed, updatedAt: now };
	}
}
