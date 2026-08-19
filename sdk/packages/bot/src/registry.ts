/**
 * Bot registry and topology (Gateway RFC, Phase 2).
 *
 * Registration semantics:
 * - The first bot is `cline` with role `lead` (bootstrap).
 * - Role and parent are immutable; there is no promotion path — the
 *   registry exposes no role mutation, and repositories reject saves that
 *   change identity.
 * - Delegation: only a lead delegates; it creates workers and contractors.
 *   Workers and contractors cannot delegate by default, and nothing can
 *   delegate a new lead.
 * - Messaging: a bot may message its parent (worker/contractor -> lead)
 *   and a lead may message its children. Worker-to-worker messaging is
 *   rejected by default.
 */

import type { BotId } from "@cline/shared/gateway";
import {
	BotNotFoundError,
	DelegationNotAllowedError,
	MessagingNotAllowedError,
} from "./errors";
import {
	type BotConfig,
	type BotRecord,
	type BotRole,
	FIRST_BOT_NAME,
	FIRST_BOT_ROLE,
	freezeIdentity,
} from "./identity";
import type { BotClock, BotIdSource, BotRepository } from "./ports";

export interface DelegationSpec {
	name: string;
	role: Exclude<BotRole, "lead">;
	config?: BotConfig;
	reason?: string;
}

export interface BotMessage {
	readonly fromBotId: BotId;
	readonly toBotId: BotId;
	readonly text: string;
	readonly sentAt: number;
}

export interface BotRegistryPorts {
	bots: BotRepository;
	ids: BotIdSource;
	clock: BotClock;
}

export class BotRegistry {
	private readonly ports: BotRegistryPorts;

	constructor(ports: BotRegistryPorts) {
		this.ports = ports;
	}

	/**
	 * Ensure the first bot exists: `cline`, role `lead`, no parent.
	 * Idempotent — returns the existing bootstrap lead when present.
	 */
	bootstrap(): BotRecord {
		const existing = this.ports.bots
			.list()
			.find(
				(record) =>
					record.identity.role === "lead" &&
					record.identity.provenance.createdBy === "bootstrap",
			);
		if (existing) {
			return existing;
		}
		const record: BotRecord = {
			identity: freezeIdentity({
				botId: this.ports.ids.botId(),
				name: FIRST_BOT_NAME,
				role: FIRST_BOT_ROLE,
				parentBotId: null,
				provenance: { createdBy: "bootstrap" },
				createdAt: this.ports.clock.now(),
			}),
			config: {},
			status: "active",
			revision: 0,
		};
		this.ports.bots.save(record);
		return record;
	}

	get(botId: BotId): BotRecord {
		const record = this.ports.bots.get(botId);
		if (!record) {
			throw new BotNotFoundError(botId);
		}
		return record;
	}

	list(): readonly BotRecord[] {
		return this.ports.bots.list();
	}

	/** Create a worker or contractor under a lead. */
	delegate(parentBotId: BotId, spec: DelegationSpec): BotRecord {
		const parent = this.get(parentBotId);
		if (parent.status !== "active") {
			throw new DelegationNotAllowedError(
				`Bot ${parentBotId} is retired and cannot delegate`,
			);
		}
		if (parent.identity.role !== "lead") {
			throw new DelegationNotAllowedError(
				`Only a lead delegates; ${parent.identity.role} bots cannot delegate by default`,
			);
		}
		// The spec type already excludes "lead"; guard the runtime hole too.
		if ((spec.role as BotRole) === "lead") {
			throw new DelegationNotAllowedError(
				"Delegation never creates a lead; the bootstrap lead is the only lead",
			);
		}
		const record: BotRecord = {
			identity: freezeIdentity({
				botId: this.ports.ids.botId(),
				name: spec.name,
				role: spec.role,
				parentBotId,
				provenance: { createdBy: parentBotId, reason: spec.reason },
				createdAt: this.ports.clock.now(),
			}),
			config: spec.config ?? {},
			status: "active",
			revision: 0,
		};
		this.ports.bots.save(record);
		return record;
	}

	/** Retire a bot, retaining its record (contractor teardown). */
	retire(botId: BotId): BotRecord {
		const record = this.get(botId);
		if (record.status === "retired") {
			return record;
		}
		const retired: BotRecord = {
			...record,
			status: "retired",
			revision: record.revision + 1,
		};
		this.ports.bots.save(retired);
		return retired;
	}

	/**
	 * Route a message along the allowed topology: child -> its parent, or
	 * lead -> its direct child. Anything else is rejected by default.
	 */
	routeMessage(fromBotId: BotId, toBotId: BotId, text: string): BotMessage {
		const from = this.get(fromBotId);
		const to = this.get(toBotId);
		const childToParent = from.identity.parentBotId === toBotId;
		const parentToChild =
			from.identity.role === "lead" && to.identity.parentBotId === fromBotId;
		if (!childToParent && !parentToChild) {
			throw new MessagingNotAllowedError(
				`Bot ${fromBotId} (${from.identity.role}) may not message ${toBotId} (${to.identity.role}); ` +
					"workers message their lead, and worker-to-worker communication is disabled by default",
			);
		}
		return {
			fromBotId,
			toBotId,
			text,
			sentAt: this.ports.clock.now(),
		};
	}
}
