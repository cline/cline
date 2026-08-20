/**
 * Machine-readable authority invariants (Gateway RFC, Phase 0).
 *
 * These constants encode the ADR decisions that other packages and tests
 * assert against. Changing any of them is a deliberate protocol/authority
 * change, not a refactor.
 */

import { z } from "zod";

/**
 * ADR: the Gateway process is the ONLY writer of new-path state (bot
 * registry, sessions, runs, credentials, configs, memory indexes).
 * Clients and bots never write Gateway-owned files directly; `@cline/bot`
 * and `@cline/engine` mutate state only through injected ports whose real
 * implementations live in the Gateway.
 */
export const GATEWAY_WRITE_AUTHORITY = "gateway" as const;

/**
 * ADR: there is no implicit in-process fallback. When the selected Gateway
 * cannot be reached, clients surface `gateway_unreachable` — they never
 * silently spin up a private runtime.
 */
export const GATEWAY_CONNECT_FALLBACK = "none" as const;

/**
 * ADR: exactly one production Gateway per canonical local data directory.
 * Ownership is taken via a lease; a second authority must not attach.
 */
export const GATEWAY_SINGLETON_OWNERSHIP = "lease" as const;

/** Disconnect never implies abort. */
export const DISCONNECT_IMPLIES_ABORT = false as const;

/**
 * How a client selects and connects to a Gateway. `fallback` is a literal:
 * the schema rejects any policy that permits an implicit fallback.
 */
export const GatewayConnectPolicySchema = z
	.object({
		/** Explicitly selected endpoint (loopback address, SSH tunnel, WSS URL). */
		endpoint: z.string().min(1),
		fallback: z.literal(GATEWAY_CONNECT_FALLBACK),
	})
	.strict();

export type GatewayConnectPolicy = z.infer<typeof GatewayConnectPolicySchema>;
