/**
 * Bot domain errors (Gateway RFC, Phase 2).
 *
 * Each error carries a stable `code` so the Gateway can map domain
 * failures onto wire errors without string matching.
 */

export type BotDomainErrorCode =
	| "run_admission_rejected"
	| "role_immutable"
	| "delegation_not_allowed"
	| "workspace_immutable"
	| "messaging_not_allowed"
	| "contractor_task_exhausted"
	| "bot_not_found"
	| "bot_retired";

export class BotDomainError extends Error {
	readonly code: BotDomainErrorCode;

	constructor(code: BotDomainErrorCode, message: string) {
		super(message);
		this.name = "BotDomainError";
		this.code = code;
	}
}

export class RunAdmissionError extends BotDomainError {
	constructor(message: string) {
		super("run_admission_rejected", message);
		this.name = "RunAdmissionError";
	}
}

export class RoleImmutableError extends BotDomainError {
	constructor(message = "Bot role and parent are immutable") {
		super("role_immutable", message);
		this.name = "RoleImmutableError";
	}
}

export class DelegationNotAllowedError extends BotDomainError {
	constructor(message: string) {
		super("delegation_not_allowed", message);
		this.name = "DelegationNotAllowedError";
	}
}

export class WorkspaceImmutableError extends BotDomainError {
	constructor(message = "Session workspace is immutable after creation") {
		super("workspace_immutable", message);
		this.name = "WorkspaceImmutableError";
	}
}

export class MessagingNotAllowedError extends BotDomainError {
	constructor(message: string) {
		super("messaging_not_allowed", message);
		this.name = "MessagingNotAllowedError";
	}
}

export class ContractorTaskError extends BotDomainError {
	constructor(message = "A contractor accepts exactly one task") {
		super("contractor_task_exhausted", message);
		this.name = "ContractorTaskError";
	}
}

export class BotNotFoundError extends BotDomainError {
	constructor(botId: string) {
		super("bot_not_found", `Unknown bot: ${botId}`);
		this.name = "BotNotFoundError";
	}
}
