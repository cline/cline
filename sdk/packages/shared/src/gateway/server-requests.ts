/**
 * Server-initiated requests (Gateway RFC, Phase 0).
 *
 * The Gateway can ask a connected client a question — tool approval,
 * credential entry, elicitation — while a run is in flight. These are NOT
 * events: they demand an answer, carry their own `id` correlation space,
 * and are not ordered by the event `sequence`. A disconnected client
 * neither loses nor implicitly answers them; the Gateway re-issues pending
 * server requests on reconnection.
 */

import { z } from "zod";
import {
	GATEWAY_METHOD_PATTERN,
	GATEWAY_PROTOCOL_VERSION,
	GatewayEventScopeSchema,
} from "./envelopes";
import { GatewayErrorSchema } from "./errors";

export const GatewayServerRequestSchema = z
	.object({
		version: z.literal(GATEWAY_PROTOCOL_VERSION),
		id: z.string().min(1),
		method: z.string().regex(GATEWAY_METHOD_PATTERN),
		scope: GatewayEventScopeSchema,
		params: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export type GatewayServerRequest = z.infer<typeof GatewayServerRequestSchema>;

export const GatewayServerResponseSchema = z
	.object({
		version: z.literal(GATEWAY_PROTOCOL_VERSION),
		id: z.string().min(1),
		result: z.unknown().optional(),
		error: GatewayErrorSchema.optional(),
	})
	.strict()
	.refine(
		(value) => (value.result === undefined) !== (value.error === undefined),
		{
			message:
				"A server-request response carries exactly one of `result` or `error`",
		},
	);

export type GatewayServerResponse = z.infer<typeof GatewayServerResponseSchema>;

/** Well-known server-request methods (additive registry). */
export const SERVER_REQUEST_METHODS = {
	toolApproval: "client.requestToolApproval",
	question: "client.requestQuestion",
	credential: "client.requestCredential",
	/** Ask the initiating desktop host to open a validated external URL. */
	openExternalUrl: "client.openExternalUrl",
} as const;
