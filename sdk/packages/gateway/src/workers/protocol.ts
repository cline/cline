/**
 * Out-of-process worker supervision contract (Gateway RFC, Phase 4).
 *
 * The supervisor and a worker speak newline-delimited JSON messages. The
 * contract is deliberately small and versioned:
 *
 * supervisor -> worker: `initialize`, `execute`, `steer`, `interrupt`,
 * `drain`, `heartbeat`, `capability-result`.
 * worker -> supervisor: `initialized`, `event`, `executed`,
 * `capability-call`, `heartbeat-ack`, `drained`.
 *
 * Capability calls are how a worker reaches Gateway-owned resources
 * (approvals, storage, scoped network credentials) — workers never mount
 * secret files and never receive raw credentials in their environment.
 */

import { BotIdSchema, WorkerIdSchema } from "@cline/shared/gateway";
import { z } from "zod";

export const WORKER_PROTOCOL_VERSION = 1 as const;

// -----------------------------------------------------------------------------
// Invocation payload (a serializable projection of EngineInvocation)
// -----------------------------------------------------------------------------

export const WorkerInvocationSchema = z
	.object({
		runId: z.string().min(1),
		sessionId: z.string().min(1),
		botId: z.string().min(1),
		input: z.string(),
		workspaceRoot: z.string().min(1),
		effectiveConfig: z.record(z.string(), z.unknown()),
		overrides: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

export type WorkerInvocation = z.infer<typeof WorkerInvocationSchema>;

export const WorkerOutcomeSchema = z
	.object({
		status: z.enum(["completed", "failed", "aborted", "interrupted"]),
		outputText: z.string(),
		error: z.object({ name: z.string(), message: z.string() }).optional(),
	})
	.strict();

export type WorkerOutcome = z.infer<typeof WorkerOutcomeSchema>;

// -----------------------------------------------------------------------------
// Supervisor -> worker
// -----------------------------------------------------------------------------

export const InitializeMessageSchema = z
	.object({
		t: z.literal("initialize"),
		protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
		workerId: WorkerIdSchema,
		botId: BotIdSchema,
		/** Catalog generation the worker is pinned to (observability). */
		catalogGeneration: z.number().int().nonnegative().optional(),
		config: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export const ExecuteMessageSchema = z
	.object({
		t: z.literal("execute"),
		executionId: z.string().min(1),
		invocation: WorkerInvocationSchema,
	})
	.strict();

export const SteerMessageSchema = z
	.object({
		t: z.literal("steer"),
		executionId: z.string().min(1),
		text: z.string().min(1),
	})
	.strict();

export const InterruptMessageSchema = z
	.object({
		t: z.literal("interrupt"),
		/** Omitted: interrupt every execution (graceful stop path). */
		executionId: z.string().min(1).optional(),
		mode: z.enum(["interrupt", "abort"]),
		reason: z.string().optional(),
	})
	.strict();

export const DrainMessageSchema = z.object({ t: z.literal("drain") }).strict();

export const HeartbeatMessageSchema = z
	.object({ t: z.literal("heartbeat"), seq: z.number().int().nonnegative() })
	.strict();

export const CapabilityResultMessageSchema = z
	.object({
		t: z.literal("capability-result"),
		callId: z.string().min(1),
		ok: z.boolean(),
		result: z.unknown().optional(),
		error: z.string().optional(),
	})
	.strict();

export const SupervisorToWorkerMessageSchema = z.discriminatedUnion("t", [
	InitializeMessageSchema,
	ExecuteMessageSchema,
	SteerMessageSchema,
	InterruptMessageSchema,
	DrainMessageSchema,
	HeartbeatMessageSchema,
	CapabilityResultMessageSchema,
]);

export type SupervisorToWorkerMessage = z.infer<
	typeof SupervisorToWorkerMessageSchema
>;

// -----------------------------------------------------------------------------
// Worker -> supervisor
// -----------------------------------------------------------------------------

export const InitializedMessageSchema = z
	.object({
		t: z.literal("initialized"),
		protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
		workerId: WorkerIdSchema,
		pid: z.number().int().positive().optional(),
	})
	.strict();

export const EventMessageSchema = z
	.object({
		t: z.literal("event"),
		executionId: z.string().min(1),
		event: z.unknown(),
	})
	.strict();

export const ExecutedMessageSchema = z
	.object({
		t: z.literal("executed"),
		executionId: z.string().min(1),
		outcome: WorkerOutcomeSchema,
	})
	.strict();

export const CapabilityCallMessageSchema = z
	.object({
		t: z.literal("capability-call"),
		callId: z.string().min(1),
		capability: z.string().min(1),
		params: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export const HeartbeatAckMessageSchema = z
	.object({
		t: z.literal("heartbeat-ack"),
		seq: z.number().int().nonnegative(),
	})
	.strict();

export const DrainedMessageSchema = z
	.object({ t: z.literal("drained") })
	.strict();

export const WorkerToSupervisorMessageSchema = z.discriminatedUnion("t", [
	InitializedMessageSchema,
	EventMessageSchema,
	ExecutedMessageSchema,
	CapabilityCallMessageSchema,
	HeartbeatAckMessageSchema,
	DrainedMessageSchema,
]);

export type WorkerToSupervisorMessage = z.infer<
	typeof WorkerToSupervisorMessageSchema
>;
