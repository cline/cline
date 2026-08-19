/**
 * `@cline/bot`
 *
 * Domain semantics for one bot (Gateway RFC, Phase 2): immutable identity
 * and roles, lead/worker/contractor topology, lazy sessions, immutable
 * session workspaces, FIFO run admission with immediate acknowledgement,
 * per-turn overrides, steering into the active run, contractor teardown,
 * file-backed memory discovery, and engine invocation — all through
 * injected ports.
 *
 * This package never opens SQLite, watches files, exposes sockets, or
 * spawns processes, and never imports `@cline/gateway` or `@cline/core`.
 * See `src/boundaries.test.ts` for the machine-checked rules.
 */

export type { SubmitPromptOptions } from "./bot";
export { Bot } from "./bot";
export type {
	ConnectorDescriptor,
	ConnectorInboundResult,
	ConnectorInboxPorts,
	ConnectorReplyPort,
	ConnectorRoute,
	ConnectorRouteRepository,
	ConnectorRunAdmission,
	NormalizedConnectorMessage,
} from "./connectors";
export {
	ConnectorInbox,
	ConnectorScopeError,
	formatConnectorPrompt,
} from "./connectors";
export type { EngineExecutionBindings } from "./engine-adapter";
export { createEngineExecutionPort } from "./engine-adapter";
export type { BotDomainErrorCode } from "./errors";
export {
	BotDomainError,
	BotNotFoundError,
	ContractorTaskError,
	DelegationNotAllowedError,
	MessagingNotAllowedError,
	RoleImmutableError,
	RunAdmissionError,
	WorkspaceImmutableError,
} from "./errors";
export type {
	BotConfig,
	BotIdentity,
	BotProvenance,
	BotRecord,
	BotRole,
	BotStatus,
} from "./identity";
export {
	BOT_ROLES,
	FIRST_BOT_NAME,
	FIRST_BOT_ROLE,
	freezeIdentity,
} from "./identity";
export type { InMemoryBotPorts } from "./in-memory";
export {
	createInMemoryPorts,
	createSequentialIdSource,
	createStepClock,
	InMemoryBotRepository,
	InMemoryMemorySource,
	InMemoryRunRepository,
	InMemorySessionRepository,
	ManualEngineHandle,
	ManualEnginePort,
} from "./in-memory";
export type { BotMemory } from "./memories";
export { discoverMemories, MEMORIES_DIR } from "./memories";
export type { TurnOverrides } from "./overrides";
export { resolveEffectiveConfig } from "./overrides";
export type {
	BotClock,
	BotIdSource,
	BotPorts,
	BotRepository,
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
	MemorySource,
	RunRecord,
	RunRepository,
	SessionRecord,
	SessionRepository,
	WorkspaceRef,
} from "./ports";
export type { BotMessage, BotRegistryPorts, DelegationSpec } from "./registry";
export { BotRegistry } from "./registry";
