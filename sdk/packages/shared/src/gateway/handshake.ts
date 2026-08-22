/**
 * Connection handshake contract (Gateway RFC, Phase 0).
 *
 * Every connection starts with `gateway.hello`, before any other request.
 * The client offers the protocol versions it speaks and its identity; the
 * Gateway answers with the negotiated version, its durable and process
 * identities, and its capability set. Capabilities are advisory strings:
 * clients must tolerate unknown capabilities (additive evolution).
 */

import { z } from "zod";
import {
	CatalogGenerationSchema,
	ClientIdSchema,
	GatewayIdSchema,
	GatewayInstanceIdSchema,
} from "./ids";

export const GATEWAY_HELLO_METHOD = "gateway.hello";

/** Dotted capability names, e.g. `runs.steer`. */
export const GATEWAY_CAPABILITY_PATTERN =
	/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

export const GatewayCapabilitySchema = z
	.string()
	.regex(GATEWAY_CAPABILITY_PATTERN);

/** Capabilities defined by protocol version 1. The set is additive. */
export const KNOWN_GATEWAY_CAPABILITIES = [
	"runs.async",
	"runs.steer",
	"runs.interrupt",
	"runs.abort",
	"events.replay",
	"serverRequests",
	"bots.delegation",
	"sessions.lazy",
] as const;

export type KnownGatewayCapability =
	(typeof KNOWN_GATEWAY_CAPABILITIES)[number];

export const GatewayHelloParamsSchema = z
	.object({
		/** Protocol versions the client can speak, in preference order. */
		protocolVersions: z.array(z.number().int().positive()).nonempty(),
		client: z
			.object({
				name: z.string().min(1),
				version: z.string().min(1),
				/** Present when the client resumes a registered identity. */
				clientId: ClientIdSchema.optional(),
			})
			.strict(),
		capabilities: z.array(GatewayCapabilitySchema).optional(),
	})
	.strict();

export type GatewayHelloParams = z.infer<typeof GatewayHelloParamsSchema>;

export const GatewayHelloResultSchema = z
	.object({
		protocolVersion: z.number().int().positive(),
		gatewayId: GatewayIdSchema,
		instanceId: GatewayInstanceIdSchema,
		clientId: ClientIdSchema,
		capabilities: z.array(GatewayCapabilitySchema),
		catalogGeneration: CatalogGenerationSchema,
	})
	.strict();

export type GatewayHelloResult = z.infer<typeof GatewayHelloResultSchema>;
