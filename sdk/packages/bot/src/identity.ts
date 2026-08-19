/**
 * Bot identity (Gateway RFC, Phase 2).
 *
 * A bot's ID, role, parent, and provenance are fixed at creation. Roles:
 *
 * - `lead`: persistent, delegates, inspects children. The first bot is
 *   `cline` with role `lead`.
 * - `worker`: persistent, messages its lead. Never promoted to lead.
 * - `contractor`: an ephemeral, task-scoped worker — one task, then
 *   teardown with record retention. Cannot delegate by default.
 *
 * `sandbox` is intentionally NOT a role.
 */

import type { ToolPolicy } from "@cline/engine";
import type { BotId, BotToolConfiguration } from "@cline/shared/gateway";

export const BOT_ROLES = ["lead", "worker", "contractor"] as const;
export type BotRole = (typeof BOT_ROLES)[number];

/** Name and role of the bootstrap bot. */
export const FIRST_BOT_NAME = "cline";
export const FIRST_BOT_ROLE: BotRole = "lead";

export interface BotProvenance {
	/** `bootstrap` for the first bot; otherwise the creating bot's ID. */
	readonly createdBy: "bootstrap" | BotId;
	readonly reason?: string;
}

export interface BotIdentity {
	readonly botId: BotId;
	readonly name: string;
	/** Immutable. There is no promotion path. */
	readonly role: BotRole;
	/** Immutable. `null` only for the bootstrap lead. */
	readonly parentBotId: BotId | null;
	readonly provenance: BotProvenance;
	readonly createdAt: number;
}

/** Bot-level configuration; per-turn overrides layer on top of this. */
export interface BotConfig {
	/** Named host profile used to assemble this bot's prompt and extensions. */
	profileId?: string;
	providerId?: string;
	modelId?: string;
	systemPrompt?: string;
	toolPolicies?: Record<string, ToolPolicy>;
	/** Declarative profile/tool selection; Gateway resolves executable tools. */
	tools?: BotToolConfiguration;
	maxIterations?: number;
}

export type BotStatus = "active" | "retired";

export interface BotRecord {
	readonly identity: BotIdentity;
	readonly config: BotConfig;
	readonly status: BotStatus;
	readonly revision: number;
}

export function freezeIdentity(identity: BotIdentity): BotIdentity {
	Object.freeze(identity.provenance);
	return Object.freeze(identity);
}
