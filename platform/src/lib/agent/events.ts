import { sanitizeLogMessage } from "@/lib/api";
import { getServiceClient } from "@/lib/supabase/service";

type EventLevel = "debug" | "info" | "warn" | "error";

type PendingEvent = {
	task_id: string;
	owner_id: string;
	type: string;
	level: EventLevel;
	message: string | null;
	tool_name: string | null;
	payload: Record<string, unknown> | null;
};

const SENSITIVE_KEY = /key|token|secret|password|authorization|credential/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
	if (depth > 6) return "[depth limit]";
	if (typeof value === "string") {
		return sanitizeLogMessage(value).slice(0, 20_000);
	}
	if (Array.isArray(value)) {
		return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
			out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeValue(entry, depth + 1);
		}
		return out;
	}
	return value;
}

/**
 * Buffers streaming text deltas into at most one database row every ~350ms while
 * persisting lifecycle and tool events immediately. Inserts are serialized so
 * event ids always reflect execution order.
 */
export class TaskEventLogger {
	private chain: Promise<void> = Promise.resolve();
	private deltaBuffer = "";
	private deltaIteration = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private closed = false;

	constructor(
		private readonly taskId: string,
		private readonly ownerId: string,
	) {}

	async emit(
		type: string,
		input?: {
			level?: EventLevel;
			message?: string;
			toolName?: string;
			payload?: Record<string, unknown>;
			iteration?: number;
		},
	): Promise<void> {
		if (type === "assistant.delta") {
			this.deltaBuffer += input?.message ?? "";
			this.deltaIteration = input?.iteration ?? this.deltaIteration;
			if (!this.timer) {
				this.timer = setTimeout(() => {
					this.timer = null;
					void this.flushDelta();
				}, 350);
			}
			return;
		}

		await this.flushDelta();
		await this.enqueue({
			task_id: this.taskId,
			owner_id: this.ownerId,
			type,
			level: input?.level ?? "info",
			message: input?.message ? sanitizeLogMessage(input.message).slice(0, 8000) : null,
			tool_name: input?.toolName ?? null,
			payload: input?.payload ? (sanitizeValue(input.payload) as Record<string, unknown>) : null,
		});
	}

	async delta(iteration: number, text: string): Promise<void> {
		await this.emit("assistant.delta", { message: text, iteration });
	}

	private enqueue(event: PendingEvent): Promise<void> {
		this.chain = this.chain.then(async () => {
			const { error } = await getServiceClient().from("a21_task_events").insert(event);
			if (error) {
				console.error("[21-agent] Failed to persist task event:", error.message);
			}
		});
		return this.chain;
	}

	private async flushDelta(): Promise<void> {
		if (!this.deltaBuffer) return;
		const text = this.deltaBuffer;
		this.deltaBuffer = "";
		await this.enqueue({
			task_id: this.taskId,
			owner_id: this.ownerId,
			type: "assistant.delta",
			level: "info",
			message: null,
			tool_name: null,
			payload: { text: text.slice(0, 12_000), iteration: this.deltaIteration },
		});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		await this.flushDelta();
		await this.chain;
	}
}
