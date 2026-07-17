/**
 * Executor implementation for the `schedule_task` agent tool.
 *
 * The tool lets an agent create a recurring scheduled task from inside a
 * session. This module is host-agnostic: it defines a minimal
 * {@link ScheduleTaskClient} seam that the host wires to a real schedule
 * service (e.g. the hub `HubScheduleService`, or a `LocalScheduleClient`), and
 * a factory that builds the executor closure around it.
 */

import type { ScheduleTaskExecutor } from "../types";

/**
 * Delivery descriptor for `deliverTo: "connector"` — mirrors the `delivery`
 * block the connector host stashes in a schedule's metadata for user-typed
 * `/schedule create`, so the existing per-adapter delivery path can post the
 * result into the originating chat thread with no extra wiring.
 */
export interface ScheduleTaskConnectorDelivery {
	adapter: string;
	threadId?: string;
	bindingKey?: string;
	channelId?: string;
	participantKey?: string;
	userName?: string;
}

/**
 * Normalized input the executor passes to the host's schedule client.
 *
 * `workspaceRoot` is optional: when the model omits it and the host provides no
 * default, the host client is expected to resolve it from the origin session
 * (`metadata.originSessionId`).
 */
export interface ScheduleTaskCreateInput {
	name: string;
	cronPattern: string;
	prompt: string;
	workspaceRoot?: string;
	cwd?: string;
	mode?: "act" | "plan";
	timezone?: string;
	/** Origin session id (also mirrored in `metadata.originSessionId`). */
	originSessionId?: string;
	/** Who created the schedule; the tool passes "agent". */
	createdBy?: string;
	/**
	 * Free-form metadata persisted on the schedule spec. The tool populates
	 * `deliveryMode`, `originSessionId`, and (for connector delivery) `delivery`.
	 */
	metadata?: Record<string, unknown>;
}

export interface ScheduleTaskCreateResult {
	scheduleId: string;
	/** Epoch millis of the next scheduled run, when known. */
	nextRunAt?: number;
}

/**
 * Minimal schedule client the executor depends on. The host implements this by
 * delegating to whatever schedule service it has access to.
 */
export interface ScheduleTaskClient {
	createSchedule(
		input: ScheduleTaskCreateInput,
	): Promise<ScheduleTaskCreateResult>;
}

export interface ScheduleTaskExecutorOptions {
	/** Client used to persist the schedule. */
	client: ScheduleTaskClient;
	/**
	 * Session defaults used when the model omits `workspaceRoot`/`cwd`.
	 */
	defaults?: {
		workspaceRoot?: string;
		cwd?: string;
	};
	/**
	 * When the current session is connector-backed, the delivery descriptor for
	 * its chat thread. Required for `deliverTo: "connector"`; absent otherwise.
	 */
	connectorDelivery?: ScheduleTaskConnectorDelivery;
}

/**
 * Build the `schedule_task` executor closure. The returned executor reads the
 * origin session id from the tool context and records it (plus the chosen
 * delivery mode) on the schedule's metadata so downstream delivery and the
 * schedule↔session linkage can find it.
 */
export function createScheduleTaskExecutor(
	options: ScheduleTaskExecutorOptions,
): ScheduleTaskExecutor {
	return async (input, context) => {
		const deliverTo = input.deliverTo ?? "new_session";

		// workspaceRoot/cwd may be omitted; the host client resolves them from the
		// origin session when they are absent.
		const workspaceRoot =
			input.workspaceRoot?.trim() || options.defaults?.workspaceRoot?.trim();
		const cwd = input.cwd?.trim() || options.defaults?.cwd?.trim();
		const originSessionId = context.sessionId?.trim();

		const metadata: Record<string, unknown> = {
			deliveryMode: deliverTo,
			...(originSessionId ? { originSessionId } : {}),
			...(input.timezone ? { timezone: input.timezone } : {}),
		};

		// For connector delivery, use a host-provided descriptor when present
		// (e.g. a client-side executor that already knows its thread). Otherwise
		// leave it unset so the host client can resolve it from the origin
		// session's metadata (the hub does this); it validates/errors there.
		if (deliverTo === "connector" && options.connectorDelivery) {
			metadata.delivery = options.connectorDelivery;
		}

		const result = await options.client.createSchedule({
			name: input.name,
			cronPattern: input.schedule,
			prompt: input.prompt,
			workspaceRoot,
			cwd,
			mode: input.mode,
			timezone: input.timezone,
			originSessionId,
			createdBy: "agent",
			metadata,
		});

		const parts = [
			`Scheduled task "${input.name}" created (id: ${result.scheduleId}).`,
			`Cron: ${input.schedule}${input.timezone ? ` in ${input.timezone}` : ""}.`,
			`Delivery: ${deliverTo}.`,
		];
		if (typeof result.nextRunAt === "number") {
			parts.push(`Next run: ${new Date(result.nextRunAt).toISOString()}.`);
		}
		return parts.join(" ");
	};
}
