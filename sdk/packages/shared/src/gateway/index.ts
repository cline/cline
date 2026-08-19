/**
 * `@cline/shared/gateway` — reusable wire contracts for the Cline Gateway
 * (Gateway RFC, Phase 0).
 *
 * This subpath holds only what every party to the protocol needs: IDs,
 * envelopes, errors, revisions, cursors, idempotency, the handshake,
 * capabilities, async-run states, and server requests. Gateway-internal
 * command schemas stay private to `@cline/gateway`.
 */

export * from "./authority";
export * from "./cursors";
export * from "./envelopes";
export * from "./errors";
export * from "./handshake";
export * from "./idempotency";
export * from "./ids";
export * from "./provenance";
export * from "./revisions";
export * from "./run-states";
export * from "./server-requests";
