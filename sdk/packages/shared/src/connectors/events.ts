import { z } from "zod";

export const ConnectorHookEventNameSchema = z.enum([
	"connector.started",
	"connector.stopping",
	"session.authorize",
	"message.received",
	"message.denied",
	"message.completed",
	"message.failed",
	"session.started",
	"session.reused",
	"session.reset",
	"schedule.delivery.started",
	"schedule.delivery.sent",
	"schedule.delivery.failed",
]);

export type ConnectorHookEventName = z.infer<
	typeof ConnectorHookEventNameSchema
>;

export const ConnectorEventActorSchema = z.object({
	id: z.string().optional(),
	label: z.string().optional(),
	role: z.string().optional(),
	participantKey: z.string().optional(),
	participantLabel: z.string().optional(),
	platformUserId: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ConnectorEventContextSchema = z.object({
	source: z.string(),
	sourceEvent: z.string(),
	threadId: z.string(),
	channelId: z.string(),
	isDM: z.boolean(),
	sessionId: z.string().optional(),
	workspaceRoot: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ConnectorAuthorizationRequestSchema = z.object({
	actor: ConnectorEventActorSchema,
	context: ConnectorEventContextSchema,
	payload: z.record(z.string(), z.unknown()).optional(),
});

export const ConnectorAuthorizationDecisionSchema = z.object({
	action: z.enum(["allow", "deny"]).default("allow"),
	message: z.string().optional(),
	reason: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ConnectorHookEventSchema = z.object({
	adapter: z.string(),
	botUserName: z.string().optional(),
	event: ConnectorHookEventNameSchema,
	payload: z.record(z.string(), z.unknown()),
	ts: z.string(),
});

export type ConnectorHookEvent = z.infer<typeof ConnectorHookEventSchema>;
export type ConnectorEventActor = z.infer<typeof ConnectorEventActorSchema>;
export type ConnectorEventContext = z.infer<typeof ConnectorEventContextSchema>;
export type ConnectorAuthorizationRequest = z.infer<
	typeof ConnectorAuthorizationRequestSchema
>;
export type ConnectorAuthorizationDecision = z.infer<
	typeof ConnectorAuthorizationDecisionSchema
>;
