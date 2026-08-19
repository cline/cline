/**
 * Gateway identity contracts (Gateway RFC, Phase 0).
 *
 * Every durable Gateway concept gets its own branded ID type with a distinct
 * wire prefix. The brands make the IDs non-interchangeable at the type level
 * (a `BotId` is not assignable where a `SessionId` is expected), and the
 * per-prefix schemas make them non-interchangeable at the wire level (the
 * `BotId` schema rejects a serialized `SessionId`).
 *
 * Identity semantics from the RFC:
 * - `GatewayId` is durable and names a canonical data directory.
 * - `InstanceId` names one Gateway process and is NOT durable.
 * - `SessionId` is allocated only with the first accepted prompt.
 * - `RunId` is issued at admission time, before the run starts.
 * - `catalogGeneration` is a monotonic number, not an ID.
 */

import { z } from "zod";

declare const idBrand: unique symbol;

/** Nominal (branded) string. Brands are erased at runtime. */
export type BrandedId<TBrand extends string> = string & {
	readonly [idBrand]: TBrand;
};

/** Durable identity of a canonical local Cline data directory. */
export type GatewayId = BrandedId<"GatewayId">;
/** Identity of one Gateway process. Not durable across restarts. */
export type GatewayInstanceId = BrandedId<"GatewayInstanceId">;
/** Identity of an authenticated principal (human or automation). */
export type PrincipalId = BrandedId<"PrincipalId">;
/** Identity of one connected client (per connection registry entry). */
export type ClientId = BrandedId<"ClientId">;
/** Durable identity of a registered bot. */
export type BotId = BrandedId<"BotId">;
/** Durable identity of a session. Allocated on first accepted prompt. */
export type SessionId = BrandedId<"SessionId">;
/** Durable identity of a run. Issued at admission. */
export type RunId = BrandedId<"RunId">;
/** Identity of a supervised worker process. */
export type WorkerId = BrandedId<"WorkerId">;
/** Durable identity of a registered connector instance (bot-scoped). */
export type ConnectorId = BrandedId<"ConnectorId">;
/** Durable identity of a schedule (automation trigger). */
export type ScheduleId = BrandedId<"ScheduleId">;

const ID_BODY_PATTERN = "[A-Za-z0-9_-]{8,64}";

export interface IdContract<TId extends string> {
	/** Wire prefix, e.g. `bot` for `bot_<body>`. */
	readonly prefix: string;
	/** Validating schema. Rejects IDs carrying any other prefix. */
	readonly schema: z.ZodType<TId>;
	/** Create a new ID from an injected entropy source. */
	create(random?: () => string): TId;
	/** Runtime type guard. */
	is(value: unknown): value is TId;
	/** Parse or throw. */
	parse(value: unknown): TId;
}

function defaultRandomIdBody(): string {
	// 128 bits of entropy, hex, no separator dependence.
	return globalThis.crypto.randomUUID().replaceAll("-", "");
}

export function defineIdContract<TId extends string>(
	prefix: string,
): IdContract<TId> {
	const pattern = new RegExp(`^${prefix}_${ID_BODY_PATTERN}$`);
	const schema = z
		.string()
		.regex(
			pattern,
			`Expected an ID with prefix "${prefix}_"; IDs are not interchangeable across kinds`,
		) as unknown as z.ZodType<TId>;
	const is = (value: unknown): value is TId =>
		typeof value === "string" && pattern.test(value);
	return {
		prefix,
		schema,
		create(random = defaultRandomIdBody): TId {
			const id = `${prefix}_${random()}`;
			if (!is(id)) {
				throw new Error(
					`Injected entropy source produced an invalid ID body for prefix "${prefix}_"`,
				);
			}
			return id;
		},
		is,
		parse(value: unknown): TId {
			return schema.parse(value);
		},
	};
}

export const gatewayIdContract = defineIdContract<GatewayId>("gw");
export const gatewayInstanceIdContract =
	defineIdContract<GatewayInstanceId>("gwi");
export const principalIdContract = defineIdContract<PrincipalId>("prn");
export const clientIdContract = defineIdContract<ClientId>("cli");
export const botIdContract = defineIdContract<BotId>("bot");
export const sessionIdContract = defineIdContract<SessionId>("ses");
export const runIdContract = defineIdContract<RunId>("run");
export const workerIdContract = defineIdContract<WorkerId>("wrk");
export const connectorIdContract = defineIdContract<ConnectorId>("con");
export const scheduleIdContract = defineIdContract<ScheduleId>("sch");

export const GatewayIdSchema = gatewayIdContract.schema;
export const GatewayInstanceIdSchema = gatewayInstanceIdContract.schema;
export const PrincipalIdSchema = principalIdContract.schema;
export const ClientIdSchema = clientIdContract.schema;
export const BotIdSchema = botIdContract.schema;
export const SessionIdSchema = sessionIdContract.schema;
export const RunIdSchema = runIdContract.schema;
export const WorkerIdSchema = workerIdContract.schema;
export const ConnectorIdSchema = connectorIdContract.schema;
export const ScheduleIdSchema = scheduleIdContract.schema;

export const createGatewayId = gatewayIdContract.create;
export const createGatewayInstanceId = gatewayInstanceIdContract.create;
export const createPrincipalId = principalIdContract.create;
export const createClientId = clientIdContract.create;
export const createBotId = botIdContract.create;
export const createSessionId = sessionIdContract.create;
export const createRunId = runIdContract.create;
export const createWorkerId = workerIdContract.create;
export const createConnectorId = connectorIdContract.create;
export const createScheduleId = scheduleIdContract.create;

/** All ID contracts, keyed by kind. Used by exhaustive contract tests. */
export const ID_CONTRACTS = {
	gatewayId: gatewayIdContract,
	instanceId: gatewayInstanceIdContract,
	principalId: principalIdContract,
	clientId: clientIdContract,
	botId: botIdContract,
	sessionId: sessionIdContract,
	runId: runIdContract,
	workerId: workerIdContract,
	connectorId: connectorIdContract,
	scheduleId: scheduleIdContract,
} as const;

/**
 * Monotonic generation counter for the Gateway's resource catalog.
 * A number, not an ID: it orders catalog snapshots, it does not name one.
 */
export const CatalogGenerationSchema = z.number().int().nonnegative();
export type CatalogGeneration = z.infer<typeof CatalogGenerationSchema>;
