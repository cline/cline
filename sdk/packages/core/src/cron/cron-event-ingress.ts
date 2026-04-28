import type { AutomationEventEnvelope, BasicLogger } from "@clinebot/shared";
import type {
	CronEventLogRecord,
	CronRunRecord,
	CronSpecRecord,
	SqliteCronStore,
} from "./sqlite-cron-store";

/**
 * Durable ingress for normalized automation events.
 *
 * This layer persists the incoming event before matching, then materializes
 * queued `cron_runs` for matching event specs. It deliberately does not
 * execute agents; the normal runner claim loop owns execution.
 */

export interface CronEventIngressOptions {
	store: SqliteCronStore;
	now?: () => number;
	logger?: BasicLogger;
}

export type CronEventSuppressionReason =
	| "duplicate_event"
	| "filter_mismatch"
	| "dedupe_window"
	| "cooldown";

export interface CronEventSuppression {
	specId?: string;
	externalId?: string;
	reason: CronEventSuppressionReason;
	dedupeKey?: string;
}

export interface CronEventIngressResult {
	event: CronEventLogRecord;
	duplicate: boolean;
	matchedSpecs: CronSpecRecord[];
	queuedRuns: CronRunRecord[];
	suppressions: CronEventSuppression[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function trimOrUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeIso(value: string | undefined, fallback: string): string {
	const candidate = value?.trim();
	if (!candidate) return fallback;
	const ms = Date.parse(candidate);
	if (!Number.isFinite(ms)) return fallback;
	return new Date(ms).toISOString();
}

function addSeconds(iso: string, seconds: number): string {
	return new Date(
		new Date(iso).getTime() + Math.max(0, Math.floor(seconds)) * 1000,
	).toISOString();
}

function subtractSeconds(iso: string, seconds: number): string {
	return new Date(
		new Date(iso).getTime() - Math.max(0, Math.floor(seconds)) * 1000,
	).toISOString();
}

function maxIso(a: string | undefined, b: string): string {
	if (!a) return b;
	return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function normalizeEvent(
	event: AutomationEventEnvelope,
	receivedAt: string,
): AutomationEventEnvelope {
	const eventId = event.eventId.trim();
	const eventType = event.eventType.trim();
	const source = event.source.trim();
	const subject = trimOrUndefined(event.subject);
	const dedupeKey =
		trimOrUndefined(event.dedupeKey) ??
		`${eventType}:${source}:${subject ?? eventId}`;
	return {
		eventId,
		eventType,
		source,
		subject,
		occurredAt: normalizeIso(event.occurredAt, receivedAt),
		workspaceRoot: trimOrUndefined(event.workspaceRoot),
		payload: isRecord(event.payload) ? event.payload : undefined,
		attributes: isRecord(event.attributes) ? event.attributes : undefined,
		dedupeKey,
	};
}

function getPath(value: unknown, path: string): unknown {
	if (!path) return undefined;
	const parts = path.split(".");
	let current: unknown = value;
	for (const part of parts) {
		if (!isRecord(current)) return undefined;
		current = current[part];
	}
	return current;
}

function resolveFilterValue(
	event: AutomationEventEnvelope,
	filterKey: string,
): unknown {
	if (event.attributes && Object.hasOwn(event.attributes, filterKey)) {
		return event.attributes[filterKey];
	}
	if (event.payload && Object.hasOwn(event.payload, filterKey)) {
		return event.payload[filterKey];
	}
	const candidate = {
		eventId: event.eventId,
		eventType: event.eventType,
		source: event.source,
		subject: event.subject,
		occurredAt: event.occurredAt,
		workspaceRoot: event.workspaceRoot,
		dedupeKey: event.dedupeKey,
		attributes: event.attributes,
		payload: event.payload,
	};
	const direct = getPath(candidate, filterKey);
	if (direct !== undefined) return direct;
	if (event.attributes) {
		const fromAttributes = getPath(event.attributes, filterKey);
		if (fromAttributes !== undefined) return fromAttributes;
	}
	if (event.payload) {
		return getPath(event.payload, filterKey);
	}
	return undefined;
}

function matchesExpected(actual: unknown, expected: unknown): boolean {
	if (Array.isArray(expected)) {
		return expected.some((item) => matchesExpected(actual, item));
	}
	if (Array.isArray(actual)) {
		return actual.some((item) => matchesExpected(item, expected));
	}
	if (isRecord(expected)) {
		if (!isRecord(actual)) return false;
		return Object.entries(expected).every(([key, value]) =>
			matchesExpected(actual[key], value),
		);
	}
	return Object.is(actual, expected);
}

export function automationEventMatchesFilters(
	event: AutomationEventEnvelope,
	filters: Record<string, unknown> | undefined,
): boolean {
	if (!filters || Object.keys(filters).length === 0) return true;
	return Object.entries(filters).every(([key, expected]) =>
		matchesExpected(resolveFilterValue(event, key), expected),
	);
}

export class CronEventIngress {
	private readonly store: SqliteCronStore;
	private readonly nowFn: () => number;
	private readonly logger?: BasicLogger;

	constructor(options: CronEventIngressOptions) {
		this.store = options.store;
		this.nowFn = options.now ?? (() => Date.now());
		this.logger = options.logger;
	}

	public ingestEvent(event: AutomationEventEnvelope): CronEventIngressResult {
		const receivedAt = new Date(this.nowFn()).toISOString();
		const normalized = normalizeEvent(event, receivedAt);
		const inserted = this.store.insertEventLog(normalized, {
			receivedAtIso: receivedAt,
		});
		if (!inserted.created) {
			this.logger?.debug("cron.event.duplicate", {
				eventId: inserted.record.eventId,
				eventType: inserted.record.eventType,
				source: inserted.record.source,
			});
			return {
				event: inserted.record,
				duplicate: true,
				matchedSpecs: [],
				queuedRuns: [],
				suppressions: [
					{
						reason: "duplicate_event",
						dedupeKey: inserted.record.dedupeKey,
					},
				],
			};
		}

		try {
			const allCandidateSpecs = this.store.listEventSpecsForType(
				normalized.eventType,
			);
			const suppressions: CronEventSuppression[] = [];
			const matchedSpecs: CronSpecRecord[] = [];
			const queuedRuns: CronRunRecord[] = [];

			for (const spec of allCandidateSpecs) {
				if (!automationEventMatchesFilters(normalized, spec.filters)) {
					suppressions.push({
						specId: spec.specId,
						externalId: spec.externalId,
						reason: "filter_mismatch",
						dedupeKey: normalized.dedupeKey,
					});
					continue;
				}
				matchedSpecs.push(spec);
				const run = this.materializeForSpec(
					spec,
					normalized,
					inserted.record.receivedAt,
				);
				if (run.run) {
					queuedRuns.push(run.run);
				} else {
					suppressions.push({
						specId: spec.specId,
						externalId: spec.externalId,
						reason: run.reason,
						dedupeKey: normalized.dedupeKey,
					});
				}
			}

			const status =
				matchedSpecs.length === 0
					? "unmatched"
					: queuedRuns.length > 0
						? "queued"
						: "suppressed";
			this.store.updateEventLogProcessing(inserted.record.eventId, {
				status,
				matchedSpecCount: matchedSpecs.length,
				queuedRunCount: queuedRuns.length,
				suppressedCount: suppressions.filter(
					(s) => s.reason !== "filter_mismatch",
				).length,
			});
			const updated = this.store.getEventLog(inserted.record.eventId);
			this.logger?.debug("cron.event.processed", {
				eventId: inserted.record.eventId,
				eventType: inserted.record.eventType,
				status,
				matchedSpecCount: matchedSpecs.length,
				queuedRunCount: queuedRuns.length,
			});
			return {
				event: updated ?? inserted.record,
				duplicate: false,
				matchedSpecs,
				queuedRuns,
				suppressions,
			};
		} catch (err) {
			this.store.updateEventLogProcessing(inserted.record.eventId, {
				status: "failed",
				error: err instanceof Error ? err.message : String(err),
			});
			if (this.logger?.error) {
				this.logger.error("cron.event.failed", {
					eventId: inserted.record.eventId,
					eventType: inserted.record.eventType,
					error: err,
				});
			}
			throw err;
		}
	}

	private materializeForSpec(
		spec: CronSpecRecord,
		event: AutomationEventEnvelope,
		receivedAt: string,
	): {
		run?: CronRunRecord;
		reason: Exclude<
			CronEventSuppressionReason,
			"duplicate_event" | "filter_mismatch"
		>;
	} {
		const dedupeKey = event.dedupeKey ?? event.eventId;
		const debounceSeconds = spec.debounceSeconds ?? 0;
		if (debounceSeconds > 0) {
			const existing = this.store.findQueuedEventRunForDedupe({
				specId: spec.specId,
				dedupeKey,
			});
			if (existing) {
				const scheduledFor = maxIso(
					existing.scheduledFor,
					addSeconds(receivedAt, debounceSeconds),
				);
				const updated = this.store.updateQueuedEventRunForDebounce({
					runId: existing.runId,
					triggerEventId: event.eventId,
					scheduledFor,
				});
				if (updated) return { run: updated, reason: "dedupe_window" };
			}
		}

		const dedupeWindowSeconds = spec.dedupeWindowSeconds ?? 0;
		if (
			dedupeWindowSeconds > 0 &&
			this.store.hasRecentEventRunForDedupe({
				specId: spec.specId,
				dedupeKey,
				sinceIso: subtractSeconds(receivedAt, dedupeWindowSeconds),
			})
		) {
			return { reason: "dedupe_window" };
		}

		const cooldownSeconds = spec.cooldownSeconds ?? 0;
		if (
			cooldownSeconds > 0 &&
			this.store.hasRecentEventRunForSpec({
				specId: spec.specId,
				sinceIso: subtractSeconds(receivedAt, cooldownSeconds),
			})
		) {
			return { reason: "cooldown" };
		}

		const run = this.store.enqueueRun({
			specId: spec.specId,
			specRevision: spec.revision,
			triggerKind: "event",
			triggerEventId: event.eventId,
			scheduledFor:
				debounceSeconds > 0
					? addSeconds(receivedAt, debounceSeconds)
					: receivedAt,
		});
		return { run, reason: "dedupe_window" };
	}
}
