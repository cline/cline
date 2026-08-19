/**
 * `@cline/gateway`
 *
 * The Gateway is the runtime authority of the Gateway RFC: transport,
 * persistence, configuration, credentials, shared resources, schedules,
 * and process supervision. This package currently contains the Phase 0
 * slice — the private command registry, `gateway.hello` negotiation, and
 * the idempotency ledger — plus the ADRs under `docs/adr/`. The server
 * itself (singleton lease, SQLite authority, CLI) is Phase 3 and is
 * intentionally NOT here yet.
 *
 * Reusable wire contracts live in `@cline/shared/gateway`; apps never
 * import this package's internals.
 */

export type { GatewayIdentityInfo, HelloNegotiation } from "./hello";
export {
	negotiateHello,
	SUPPORTED_PROTOCOL_VERSIONS,
} from "./hello";
export type { IdempotencyBeginOutcome } from "./idempotency-ledger";
export {
	IdempotencyLedger,
	stableStringify,
} from "./idempotency-ledger";
export type {
	GatewayMethodDefinition,
	ValidatedGatewayRequest,
} from "./methods";
export {
	GATEWAY_METHODS,
	getMethodDefinition,
	validateGatewayRequest,
} from "./methods";
