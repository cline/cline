/**
 * Gateway-internal command registry (Gateway RFC, Phase 0).
 *
 * Reusable wire schemas (envelopes, IDs, errors) live in
 * `@cline/shared/gateway`; the per-method command surface stays private to
 * the Gateway. Every mutating method requires an idempotency key. Adding a
 * method is an additive protocol change.
 */

import {
	ProviderCapabilitySchema,
	ProviderClientSchema,
	ProviderProtocolSchema,
} from "@cline/shared";
import {
	BotIdSchema,
	BotToolConfigurationSchema,
	ConnectorIdSchema,
	createGatewayError,
	GATEWAY_HELLO_METHOD,
	type GatewayError,
	GatewayHelloParamsSchema,
	type GatewayRequest,
	GatewayRequestSchema,
	IDEMPOTENCY_KEY_PARAM,
	IdempotencyKeySchema,
	RunIdSchema,
	ScheduleIdSchema,
	SessionIdSchema,
	ToolProfileSchema,
} from "@cline/shared/gateway";
import { z } from "zod";
import { MAX_VOICE_AUDIO_BASE64_CHARACTERS } from "./voice";

const IdempotentParamsBase = z.object({
	[IDEMPOTENCY_KEY_PARAM]: IdempotencyKeySchema,
});

const StatisticsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const VoiceInputSelectionSchema = z
	.object({
		providerId: z.string().min(1),
		modelId: z.string().min(1),
	})
	.strict();

const AudioBase64Schema = z
	.string()
	.min(4)
	.max(MAX_VOICE_AUDIO_BASE64_CHARACTERS)
	.regex(
		/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
		"audioBase64 must be valid base64",
	);

const ScheduleNotifySchema = z
	.object({
		connectorId: ConnectorIdSchema,
		externalAccountId: z.string().min(1),
		externalConversationId: z.string().min(1),
	})
	.strict();

const ScheduleModelSelectionSchema = z
	.object({
		providerId: z.string().min(1).optional(),
		modelId: z.string().min(1).optional(),
	})
	.strict();

const ScheduleDetailsShape = {
	metadata: z.record(z.string(), z.unknown()).optional(),
	modelSelection: ScheduleModelSelectionSchema.optional(),
	mode: z.enum(["act", "plan", "yolo"]).optional(),
	workspaceRoot: z.string().min(1).optional(),
	cwd: z.string().min(1).optional(),
	systemPrompt: z.string().optional(),
	maxIterations: z.number().int().positive().optional(),
	timeoutSeconds: z.number().int().positive().optional(),
	maxParallel: z.number().int().positive().optional(),
	tags: z.array(z.string()).max(100).optional(),
};

export interface GatewayMethodDefinition {
	readonly method: string;
	/** Mutating methods require an idempotency key in params. */
	readonly mutating: boolean;
	readonly params: z.ZodType<unknown>;
}

const TurnOverridesSchema = z
	.object({
		providerId: z.string().min(1).optional(),
		modelId: z.string().min(1).optional(),
		systemPrompt: z.string().optional(),
		maxIterations: z.number().int().positive().optional(),
		tools: BotToolConfigurationSchema.optional(),
	})
	.strict();

const ClineAccountQuerySchema = z.discriminatedUnion("operation", [
	z.object({ operation: z.literal("fetchMe") }).strict(),
	z
		.object({
			operation: z.literal("fetchBalance"),
			userId: z.string().min(1).optional(),
		})
		.strict(),
	z
		.object({
			operation: z.literal("fetchUsageTransactions"),
			userId: z.string().min(1).optional(),
		})
		.strict(),
	z
		.object({
			operation: z.literal("fetchPaymentTransactions"),
			userId: z.string().min(1).optional(),
		})
		.strict(),
	z.object({ operation: z.literal("fetchUserOrganizations") }).strict(),
	z
		.object({
			operation: z.literal("fetchOrganizationBalance"),
			organizationId: z.string().min(1),
		})
		.strict(),
	z
		.object({
			operation: z.literal("fetchOrganizationUsageTransactions"),
			organizationId: z.string().min(1),
			memberId: z.string().min(1).optional(),
		})
		.strict(),
]);

function define(
	method: string,
	mutating: boolean,
	params: z.ZodType<unknown>,
): GatewayMethodDefinition {
	return { method, mutating, params };
}

/**
 * Protocol v1 command surface. `run.start` acks immediately with
 * `{runId, acceptedAt, queuePosition}` — it never stays open for the turn.
 */
export const GATEWAY_METHODS: readonly GatewayMethodDefinition[] = [
	define(GATEWAY_HELLO_METHOD, false, GatewayHelloParamsSchema),
	define("gateway.status", false, z.object({}).strict().optional()),
	define(
		"bot.systemPrompt.get",
		false,
		z.object({ botId: BotIdSchema }).strict(),
	),
	define(
		"bot.systemPrompt.put",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			content: z.string(),
			expectedRevision: z.number().int().nonnegative().optional(),
		}).strict(),
	),
	define("provider.catalog.list", false, z.object({}).strict().optional()),
	define(
		"provider.models.list",
		false,
		z.object({ providerId: z.string().min(1) }).strict(),
	),
	define(
		"provider.settings.get",
		false,
		z.object({ providerId: z.string().min(1) }).strict(),
	),
	define(
		"provider.settings.patch",
		true,
		IdempotentParamsBase.extend({
			providerId: z.string().min(1),
			enabled: z.boolean().optional(),
			settings: z.record(z.string(), z.unknown()).optional(),
		}).strict(),
	),
	define(
		"provider.add",
		true,
		IdempotentParamsBase.extend({
			providerId: z.string().min(1),
			name: z.string().min(1),
			baseUrl: z.string().min(1),
			apiKey: z.string().optional(),
			headers: z.record(z.string(), z.string()).optional(),
			timeoutMs: z.number().int().positive().optional(),
			models: z.array(z.string().min(1)).max(2_000).optional(),
			defaultModelId: z.string().min(1).optional(),
			modelsSourceUrl: z.string().min(1).optional(),
			protocol: ProviderProtocolSchema.optional(),
			client: ProviderClientSchema.optional(),
			capabilities: z.array(ProviderCapabilitySchema).optional(),
		}).strict(),
	),
	define(
		"provider.models.put",
		true,
		IdempotentParamsBase.extend({
			providerId: z.string().min(1),
			models: z.array(z.string().min(1)).min(1).max(2_000),
			defaultModelId: z.string().min(1).optional(),
		}).strict(),
	),
	define(
		"provider.oauth.login",
		true,
		IdempotentParamsBase.extend({ providerId: z.literal("cline") }).strict(),
	),
	define(
		"provider.oauth.cancel",
		true,
		IdempotentParamsBase.extend({ providerId: z.literal("cline") }).strict(),
	),
	define("account.cline.query", false, ClineAccountQuerySchema),
	define(
		"account.cline.switch",
		true,
		IdempotentParamsBase.extend({
			operation: z.literal("switchAccount"),
			organizationId: z.string().min(1).nullable().optional(),
		}).strict(),
	),
	define("settings.global.get", false, z.object({}).strict().optional()),
	define(
		"settings.global.patch",
		true,
		IdempotentParamsBase.extend({
			telemetryOptOut: z.boolean().optional(),
			autoUpdateEnabled: z.boolean().optional(),
			webSearchEnabled: z.boolean().optional(),
		}).strict(),
	),
	define(
		"voice.settings.put",
		true,
		IdempotentParamsBase.extend({
			selection: VoiceInputSelectionSchema.nullable(),
		}).strict(),
	),
	define(
		"voice.transcription.createSession",
		false,
		z.object({}).strict().optional(),
	),
	define(
		"voice.transcription.transcribe",
		false,
		z
			.object({
				audioBase64: AudioBase64Schema,
				mediaType: z
					.string()
					.min(1)
					.max(255)
					.refine(
						(value) =>
							value.toLowerCase().startsWith("audio/") && !/[\r\n]/.test(value),
						"mediaType must be an audio media type",
					)
					.optional(),
			})
			.strict(),
	),
	define("marketplace.catalog.get", false, z.object({}).strict().optional()),
	define("marketplace.installed.list", false, z.object({}).strict().optional()),
	define(
		"marketplace.install",
		true,
		IdempotentParamsBase.extend({
			type: z.enum(["mcp", "skill", "plugin"]),
			id: z.string().min(1).max(128),
		}).strict(),
	),
	define(
		"marketplace.uninstall",
		true,
		IdempotentParamsBase.extend({
			type: z.enum(["mcp", "skill", "plugin"]),
			id: z.string().min(1).max(128),
		}).strict(),
	),
	define("mcp.servers.list", false, z.object({}).strict().optional()),
	define(
		"mcp.servers.put",
		true,
		IdempotentParamsBase.extend({
			name: z.string().min(1).max(128),
			previousName: z.string().min(1).max(128).optional(),
			transportType: z.enum(["stdio", "sse", "streamableHttp"]),
			command: z.string().max(4_096).optional(),
			args: z.array(z.string().max(8_192)).max(256).optional(),
			cwd: z.string().max(8_192).optional(),
			env: z.record(z.string(), z.string().max(32_768)).optional(),
			url: z.string().max(2_048).optional(),
			headers: z.record(z.string(), z.string().max(32_768)).optional(),
			disabled: z.boolean().optional(),
			metadata: z.unknown().optional(),
		}).strict(),
	),
	define(
		"mcp.servers.delete",
		true,
		IdempotentParamsBase.extend({ name: z.string().min(1).max(128) }).strict(),
	),
	define(
		"mcp.servers.setDisabled",
		true,
		IdempotentParamsBase.extend({
			name: z.string().min(1).max(128),
			disabled: z.boolean(),
		}).strict(),
	),
	define("plugins.managed.list", false, z.object({}).strict().optional()),
	define(
		"plugins.managed.setDisabled",
		true,
		IdempotentParamsBase.extend({
			path: z.string().min(1).max(8_192),
			disabled: z.boolean(),
		}).strict(),
	),
	define(
		"extensions.managed.uninstall",
		true,
		IdempotentParamsBase.extend({
			type: z.enum(["mcp", "skill", "workflow", "plugin"]),
			id: z.string().min(1).max(512).optional(),
			name: z.string().min(1).max(512).optional(),
			path: z.string().min(1).max(8_192).optional(),
		})
			.strict()
			.refine(
				(value) => Boolean(value.id || value.name || value.path),
				"one of id, name, or path is required",
			),
	),
	define(
		"gateway.drain",
		true,
		IdempotentParamsBase.extend({
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"gateway.stop",
		true,
		IdempotentParamsBase.extend({
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"run.start",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			prompt: z.string().min(1),
			/**
			 * Target session (canonical by default). Desktop names a
			 * connector conversation's dedicated session here to join it
			 * intentionally.
			 */
			sessionId: SessionIdSchema.optional(),
			workspaceRoot: z.string().min(1).optional(),
			newSession: z.boolean().optional(),
			overrides: TurnOverridesSchema.optional(),
		}).strict(),
	),
	define(
		"workspace.file.upload",
		true,
		IdempotentParamsBase.extend({
			sessionId: SessionIdSchema,
			name: z.string().min(1).max(255),
			mediaType: z.string().min(1).max(255).optional(),
			base64: z.string().min(1).max(7_000_000),
		}).strict(),
	),
	define(
		"run.steer",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
			text: z.string().min(1),
		}).strict(),
	),
	define(
		"run.updateQueued",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
			input: z
				.string()
				.refine((value) => value.trim().length > 0, "input must not be empty"),
		}).strict(),
	),
	define(
		"run.promoteQueued",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
		}).strict(),
	),
	define(
		"run.interrupt",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"run.retry",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"run.abort",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"run.subscribe",
		false,
		z
			.object({
				sessionId: SessionIdSchema.optional(),
				runId: RunIdSchema.optional(),
				/** Opaque replay cursor from `@cline/shared/gateway`. */
				cursor: z.string().optional(),
			})
			.strict(),
	),
	define(
		"bot.delegate",
		true,
		IdempotentParamsBase.extend({
			parentBotId: BotIdSchema,
			name: z.string().min(1),
			role: z.enum(["worker", "contractor"]),
			reason: z.string().optional(),
		}).strict(),
	),
	define("bot.list", false, z.object({}).strict().optional()),
	define(
		"session.create",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			workspaceRoot: z.string().min(1).optional(),
			kind: z.enum(["canonical", "dedicated"]).optional(),
		}).strict(),
	),
	define(
		"session.fork",
		true,
		IdempotentParamsBase.extend({
			sessionId: SessionIdSchema,
			/** Copy history strictly before the Nth user message. */
			beforeRunCount: z.number().int().positive().optional(),
		}).strict(),
	),
	define(
		"session.update",
		true,
		IdempotentParamsBase.extend({
			sessionId: SessionIdSchema,
			title: z.string().max(500).nullable().optional(),
			metadata: z.record(z.string(), z.unknown()).optional(),
			expectedRevision: z.number().int().nonnegative().optional(),
		})
			.strict()
			.refine(
				(params) => params.title !== undefined || params.metadata !== undefined,
				"title or metadata is required",
			),
	),
	define(
		"session.close",
		true,
		IdempotentParamsBase.extend({
			sessionId: SessionIdSchema,
		}).strict(),
	),
	define(
		"session.delete",
		true,
		IdempotentParamsBase.extend({
			sessionId: SessionIdSchema,
		}).strict(),
	),
	define(
		"session.list",
		false,
		z.object({ botId: BotIdSchema.optional() }).strict().optional(),
	),
	define(
		"session.get",
		false,
		z
			.object({
				sessionId: SessionIdSchema,
				messageLimit: z.number().int().positive().max(800).optional(),
			})
			.strict(),
	),
	define(
		"run.list",
		false,
		z
			.object({
				sessionId: SessionIdSchema.optional(),
				runId: RunIdSchema.optional(),
			})
			.strict()
			.optional(),
	),
	define("tools.catalog", false, z.object({}).strict().optional()),
	define("tools.profiles.list", false, z.object({}).strict().optional()),
	define(
		"tools.profiles.put",
		true,
		IdempotentParamsBase.extend({
			profile: ToolProfileSchema,
			expectedRevision: z.number().int().nonnegative().optional(),
		}).strict(),
	),
	define(
		"tools.configuration.get",
		false,
		z
			.object({
				scope: z.discriminatedUnion("kind", [
					z.object({ kind: z.literal("global") }).strict(),
					z
						.object({
							kind: z.literal("workspace"),
							workspaceRoot: z.string().min(1),
						})
						.strict(),
					z.object({ kind: z.literal("bot"), botId: BotIdSchema }).strict(),
				]),
			})
			.strict(),
	),
	define(
		"tools.configuration.put",
		true,
		IdempotentParamsBase.extend({
			scope: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("global") }).strict(),
				z
					.object({
						kind: z.literal("workspace"),
						workspaceRoot: z.string().min(1),
					})
					.strict(),
				z.object({ kind: z.literal("bot"), botId: BotIdSchema }).strict(),
			]),
			config: BotToolConfigurationSchema,
			expectedRevision: z.number().int().nonnegative().optional(),
		}).strict(),
	),
	define(
		"tools.previewEffective",
		false,
		z
			.object({
				botId: BotIdSchema,
				workspaceRoot: z.string().min(1),
				providerId: z.string().min(1),
				modelId: z.string().min(1),
				turn: BotToolConfigurationSchema.optional(),
			})
			.strict(),
	),
	// Statistics read surface (bounded aggregate queries; the equivalents
	// of GET /statistics/{summary,activity,rankings,usage} for clients).
	define(
		"statistics.summary",
		false,
		z
			.object({
				from: StatisticsDateSchema.optional(),
				to: StatisticsDateSchema.optional(),
			})
			.strict()
			.optional(),
	),
	define(
		"statistics.activity",
		false,
		z
			.object({
				from: StatisticsDateSchema.optional(),
				to: StatisticsDateSchema.optional(),
			})
			.strict()
			.optional(),
	),
	define(
		"statistics.rankings",
		false,
		z
			.object({
				dimension: z.enum(["model", "agent", "topic"]),
				from: StatisticsDateSchema.optional(),
				to: StatisticsDateSchema.optional(),
				limit: z.number().int().min(1).max(100).optional(),
			})
			.strict(),
	),
	define(
		"statistics.usage",
		false,
		z
			.object({
				/** Calendar month, e.g. `2026-08`. */
				month: z.string().regex(/^\d{4}-\d{2}$/),
			})
			.strict(),
	),
	// Phase 6: connectors are bot-scoped; registration names exactly one bot.
	define(
		"connector.register",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			kind: z.enum(["telegram", "slack"]),
			name: z.string().min(1),
			config: z.record(z.string(), z.unknown()).optional(),
			/** Name of an owner-only secret file — never the secret itself. */
			credentialRef: z.string().min(1).optional(),
		}).strict(),
	),
	define(
		"connector.configure",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			kind: z.enum(["telegram", "slack"]),
			name: z.string().min(1),
			config: z.record(z.string(), z.unknown()).optional(),
			/** Raw credential received over the authenticated local transport. */
			credential: z.string().min(1).max(32_768),
		}).strict(),
	),
	define(
		"connector.list",
		false,
		z.object({ botId: BotIdSchema.optional() }).strict().optional(),
	),
	define(
		"connector.inspect",
		false,
		z.object({ connectorId: ConnectorIdSchema }).strict(),
	),
	define(
		"connector.setEnabled",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
			enabled: z.boolean(),
		}).strict(),
	),
	define(
		"connector.updateConfig",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
			/** Non-secret configuration only; secret-like keys are refused. */
			config: z.record(z.string(), z.unknown()),
		}).strict(),
	),
	define(
		"connector.setCredential",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
			/** Secret FILE reference; omitted clears it. Never a token. */
			credentialRef: z.string().min(1).optional(),
		}).strict(),
	),
	define(
		"connector.remove",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
		}).strict(),
	),
	define(
		"connector.routes",
		false,
		z.object({ connectorId: ConnectorIdSchema }).strict(),
	),
	define(
		"connector.testCredentials",
		false,
		z.object({ connectorId: ConnectorIdSchema }).strict(),
	),
	define(
		"connector.sendTest",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
			externalConversationId: z.string().min(1),
			externalAccountId: z.string().min(1).optional(),
			text: z.string().min(1).optional(),
		}).strict(),
	),
	define(
		"connector.outbound",
		false,
		z
			.object({
				connectorId: ConnectorIdSchema.optional(),
				botId: BotIdSchema.optional(),
				state: z.enum(["pending", "sending", "delivered", "failed"]).optional(),
				limit: z.number().int().min(1).max(500).optional(),
			})
			.strict()
			.optional(),
	),
	// Phase 6: schedules — durable triggers creating ordinary automation runs.
	define(
		"schedule.create",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			name: z.string().min(1),
			prompt: z.string().min(1),
			intervalMs: z.number().int().positive().optional(),
			at: z.number().int().nonnegative().optional(),
			cronPattern: z.string().min(1).optional(),
			maxAttempts: z.number().int().positive().optional(),
			enabled: z.boolean().optional(),
			...ScheduleDetailsShape,
			/** Deliver firing outcomes to a connector conversation. */
			notify: ScheduleNotifySchema.optional(),
		})
			.strict()
			.refine(
				(params) =>
					[params.intervalMs, params.at, params.cronPattern].filter(
						(value) => value !== undefined,
					).length === 1,
				"exactly one trigger is required",
			),
	),
	define(
		"schedule.update",
		true,
		IdempotentParamsBase.extend({
			scheduleId: ScheduleIdSchema,
			expectedRevision: z.number().int().nonnegative().optional(),
			name: z.string().min(1).optional(),
			prompt: z.string().min(1).optional(),
			intervalMs: z.number().int().positive().optional(),
			at: z.number().int().nonnegative().optional(),
			cronPattern: z.string().min(1).optional(),
			maxAttempts: z.number().int().positive().optional(),
			enabled: z.boolean().optional(),
			metadata: z.record(z.string(), z.unknown()).optional(),
			modelSelection: ScheduleModelSelectionSchema.nullable().optional(),
			mode: z.enum(["act", "plan", "yolo"]).nullable().optional(),
			workspaceRoot: z.string().min(1).nullable().optional(),
			cwd: z.string().min(1).nullable().optional(),
			systemPrompt: z.string().nullable().optional(),
			maxIterations: z.number().int().positive().nullable().optional(),
			timeoutSeconds: z.number().int().positive().nullable().optional(),
			maxParallel: z.number().int().positive().optional(),
			tags: z.array(z.string()).max(100).optional(),
		}).strict(),
	),
	define(
		"schedule.enable",
		true,
		IdempotentParamsBase.extend({ scheduleId: ScheduleIdSchema }).strict(),
	),
	define(
		"schedule.disable",
		true,
		IdempotentParamsBase.extend({ scheduleId: ScheduleIdSchema }).strict(),
	),
	define(
		"schedule.trigger",
		true,
		IdempotentParamsBase.extend({ scheduleId: ScheduleIdSchema }).strict(),
	),
	define(
		"schedule.delete",
		true,
		IdempotentParamsBase.extend({ scheduleId: ScheduleIdSchema }).strict(),
	),
	define(
		"schedule.list",
		false,
		z.object({ botId: BotIdSchema.optional() }).strict().optional(),
	),
	define(
		"schedule.report",
		false,
		z.object({ scheduleId: ScheduleIdSchema }).strict(),
	),
];

const METHODS_BY_NAME = new Map(
	GATEWAY_METHODS.map((definition) => [definition.method, definition]),
);

export function getMethodDefinition(
	method: string,
): GatewayMethodDefinition | undefined {
	return METHODS_BY_NAME.get(method);
}

export type ValidatedGatewayRequest =
	| {
			ok: true;
			request: GatewayRequest;
			definition: GatewayMethodDefinition;
			params: unknown;
	  }
	| { ok: false; error: GatewayError };

/**
 * Validate a raw inbound value against the envelope, the method registry,
 * the idempotency requirement, and the method's param schema.
 */
export function validateGatewayRequest(
	value: unknown,
): ValidatedGatewayRequest {
	const envelope = GatewayRequestSchema.safeParse(value);
	if (!envelope.success) {
		return {
			ok: false,
			error: createGatewayError(
				"invalid_request",
				`Malformed request envelope: ${envelope.error.issues[0]?.message ?? "unknown"}`,
			),
		};
	}
	const definition = METHODS_BY_NAME.get(envelope.data.method);
	if (!definition) {
		return {
			ok: false,
			error: createGatewayError(
				"not_found",
				`Unknown method: ${envelope.data.method}`,
			),
		};
	}
	if (definition.mutating) {
		const key = envelope.data.params?.[IDEMPOTENCY_KEY_PARAM];
		if (!IdempotencyKeySchema.safeParse(key).success) {
			return {
				ok: false,
				error: createGatewayError(
					"idempotency_key_required",
					`Mutating method ${definition.method} requires a valid "${IDEMPOTENCY_KEY_PARAM}" param`,
				),
			};
		}
	}
	const params = definition.params.safeParse(envelope.data.params);
	if (!params.success) {
		return {
			ok: false,
			error: createGatewayError(
				"invalid_request",
				`Invalid params for ${definition.method}: ${params.error.issues[0]?.message ?? "unknown"}`,
			),
		};
	}
	return {
		ok: true,
		request: envelope.data,
		definition,
		params: params.data,
	};
}
