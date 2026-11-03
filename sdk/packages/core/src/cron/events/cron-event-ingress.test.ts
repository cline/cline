import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CronEventSpec } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteCronStore } from "../store/sqlite-cron-store";
import {
	automationEventMatchesFilters,
	CronEventIngress,
} from "./cron-event-ingress";

describe("automationEventMatchesFilters", () => {
	it("matches attributes by default and supports dot paths", () => {
		expect(
			automationEventMatchesFilters(
				{
					eventId: "evt_1",
					eventType: "github.pull_request.opened",
					source: "github",
					occurredAt: "2026-04-23T10:00:00.000Z",
					attributes: {
						repository: "acme/api",
						pullRequest: { baseBranch: "main" },
					},
				},
				{
					repository: "acme/api",
					"pullRequest.baseBranch": "main",
				},
			),
		).toBe(true);
	});
});

describe("CronEventIngress", () => {
	let dir: string;
	let store: SqliteCronStore;
	let nowMs: number;
	let ingress: CronEventIngress;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cline-event-ingress-"));
		store = new SqliteCronStore({ dbPath: join(dir, "cron.db") });
		nowMs = Date.parse("2026-04-23T10:00:00.000Z");
		ingress = new CronEventIngress({ store, now: () => nowMs });
	});

	afterEach(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	function seedEventSpec(overrides: Partial<CronEventSpec> = {}) {
		const spec: CronEventSpec = {
			triggerKind: "event",
			id: "pr-review",
			title: "PR Review",
			prompt: "Review the PR",
			workspaceRoot: "/ws",
			enabled: true,
			event: "github.pull_request.opened",
			filters: { repository: "acme/api" },
			...overrides,
		};
		return store.upsertSpec({
			externalId: spec.id ?? "pr-review",
			sourcePath: `events/${spec.id ?? "pr-review"}.event.md`,
			triggerKind: "event",
			sourceHash: JSON.stringify(spec),
			parseStatus: "valid",
			spec,
		}).record;
	}

	function event(eventId = "evt_retry") {
		return {
			eventId,
			eventType: "github.pull_request.opened",
			source: "github",
			occurredAt: new Date(nowMs).toISOString(),
			dedupeKey: "pr:12",
			attributes: { repository: "acme/api" },
		};
	}

	it.each([
		"first run",
		"second run",
		"processing status",
	])("rolls back failed acceptance at %s and accepts redelivery once", (failurePoint) => {
		const first = seedEventSpec({ id: "first" });
		const second = seedEventSpec({ id: "second" });
		const originalEnqueue = store.enqueueRun.bind(store);
		let calls = 0;
		const injected =
			failurePoint === "processing status"
				? vi.spyOn(store, "updateEventLogProcessing").mockImplementation(() => {
						throw new Error("injected failure");
					})
				: vi.spyOn(store, "enqueueRun").mockImplementation((input) => {
						calls++;
						if (calls === (failurePoint === "first run" ? 1 : 2))
							throw new Error("injected failure");
						return originalEnqueue(input);
					});
		expect(() => ingress.ingestEvent(event())).toThrow("injected failure");
		injected.mockRestore();
		expect(store.getEventLog("evt_retry")).toBeUndefined();
		expect(store.listRuns()).toHaveLength(0);
		expect(store.getSpec(first.specId)?.lastMaterializedRunId).toBeUndefined();
		expect(store.getSpec(second.specId)?.lastMaterializedRunId).toBeUndefined();

		// Reopening proves retryability comes from persisted state, not this instance.
		store.close();
		store = new SqliteCronStore({ dbPath: join(dir, "cron.db") });
		ingress = new CronEventIngress({ store, now: () => nowMs });
		const retried = ingress.ingestEvent(event());
		expect(retried.duplicate).toBe(false);
		expect(retried.queuedRuns).toHaveLength(2);
		expect(new Set(retried.queuedRuns.map((run) => run.specId))).toEqual(
			new Set([first.specId, second.specId]),
		);
		expect(retried.event.processingStatus).toBe("queued");
		expect(retried.event.queuedRunCount).toBe(2);
		expect(ingress.ingestEvent(event()).duplicate).toBe(true);
		expect(store.listRuns()).toHaveLength(2);
	});

	it("rolls back debounce changes when processing fails after materialization", () => {
		seedEventSpec({ debounceSeconds: 30 });
		const accepted = ingress.ingestEvent(event("evt_original"));
		const originalRun = accepted.queuedRuns[0];
		expect(originalRun).toBeDefined();
		nowMs += 10000;
		const injected = vi
			.spyOn(store, "updateEventLogProcessing")
			.mockImplementationOnce(() => {
				throw new Error("status write failed");
			});
		expect(() => ingress.ingestEvent(event())).toThrow("status write failed");
		injected.mockRestore();
		expect(store.getEventLog("evt_retry")).toBeUndefined();
		expect(store.listRuns()).toEqual([originalRun]);
		const retried = ingress.ingestEvent(event());
		expect(retried.queuedRuns[0]?.runId).toBe(originalRun?.runId);
		expect(retried.queuedRuns[0]?.triggerEventId).toBe("evt_retry");
		expect(retried.queuedRuns[0]?.scheduledFor).toBe(
			"2026-04-23T10:00:40.000Z",
		);
		expect(store.listRuns()).toHaveLength(1);
	});

	it("does not expose partial acceptance to another connection", () => {
		seedEventSpec({ id: "first" });
		seedEventSpec({ id: "second" });
		const peer = new SqliteCronStore({ dbPath: join(dir, "cron.db") });
		const enqueue = store.enqueueRun.bind(store);
		const observed = vi
			.spyOn(store, "enqueueRun")
			.mockImplementation((input) => {
				const run = enqueue(input);
				expect(peer.getEventLog("evt_retry")).toBeUndefined();
				expect(peer.listRuns()).toHaveLength(0);
				return run;
			});
		try {
			ingress.ingestEvent(event());
			expect(observed).toHaveBeenCalledTimes(2);
			expect(peer.getEventLog("evt_retry")?.processingStatus).toBe("queued");
			expect(peer.listRuns()).toHaveLength(2);
			const peerIngress = new CronEventIngress({ store: peer });
			expect(peerIngress.ingestEvent(event()).duplicate).toBe(true);
			expect(peer.listRuns()).toHaveLength(2);
		} finally {
			observed.mockRestore();
			peer.close();
		}
	});

	it("persists a normalized event and queues matching event runs", () => {
		const spec = seedEventSpec({
			filters: {
				repository: "acme/api",
				"pullRequest.baseBranch": "main",
			},
		});

		const result = ingress.ingestEvent({
			eventId: "evt_1",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T09:59:59.000Z",
			attributes: {
				repository: "acme/api",
				pullRequest: { baseBranch: "main" },
			},
			payload: { action: "opened" },
		});

		expect(result.duplicate).toBe(false);
		expect(result.matchedSpecs).toHaveLength(1);
		expect(result.queuedRuns).toHaveLength(1);
		expect(result.queuedRuns[0]?.specId).toBe(spec.specId);
		expect(result.queuedRuns[0]?.triggerKind).toBe("event");
		expect(result.queuedRuns[0]?.triggerEventId).toBe("evt_1");
		expect(result.event.processingStatus).toBe("queued");
		expect(result.event.dedupeKey).toBe(
			"github.pull_request.opened:github:acme/api#12",
		);
	});

	it("records unmatched events without queuing", () => {
		seedEventSpec({ filters: { repository: "acme/api" } });

		const result = ingress.ingestEvent({
			eventId: "evt_1",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/web#12",
			occurredAt: "2026-04-23T10:00:00.000Z",
			attributes: { repository: "acme/web" },
		});

		expect(result.matchedSpecs).toHaveLength(0);
		expect(result.queuedRuns).toHaveLength(0);
		expect(result.event.processingStatus).toBe("unmatched");
		expect(store.listRuns()).toHaveLength(0);
	});

	it("queues one run per concurrently matching event spec", () => {
		const first = seedEventSpec({ id: "pr-review-a" });
		const second = seedEventSpec({
			id: "pr-review-b",
			filters: { repository: "acme/api", label: "security" },
		});

		const result = ingress.ingestEvent({
			eventId: "evt_1",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T10:00:00.000Z",
			attributes: { repository: "acme/api", label: "security" },
		});

		expect(result.matchedSpecs.map((spec) => spec.specId).sort()).toEqual(
			[first.specId, second.specId].sort(),
		);
		expect(result.queuedRuns).toHaveLength(2);
		expect(store.listRuns()).toHaveLength(2);
	});

	it("treats duplicate event ids as replay and does not requeue", () => {
		seedEventSpec();
		const event = {
			eventId: "evt_1",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T10:00:00.000Z",
			attributes: { repository: "acme/api" },
		};

		expect(ingress.ingestEvent(event).queuedRuns).toHaveLength(1);
		const duplicate = ingress.ingestEvent(event);

		expect(duplicate.duplicate).toBe(true);
		expect(duplicate.queuedRuns).toHaveLength(0);
		expect(store.listRuns()).toHaveLength(1);
	});

	it("suppresses events inside a dedupe window", () => {
		seedEventSpec({ dedupeWindowSeconds: 600 });
		ingress.ingestEvent({
			eventId: "evt_1",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T10:00:00.000Z",
			dedupeKey: "pr:12",
			attributes: { repository: "acme/api" },
		});
		nowMs = Date.parse("2026-04-23T10:01:00.000Z");

		const suppressed = ingress.ingestEvent({
			eventId: "evt_2",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T10:01:00.000Z",
			dedupeKey: "pr:12",
			attributes: { repository: "acme/api" },
		});

		expect(suppressed.queuedRuns).toHaveLength(0);
		expect(suppressed.event.processingStatus).toBe("suppressed");
		expect(suppressed.suppressions[0]?.reason).toBe("dedupe_window");
		expect(store.listRuns()).toHaveLength(1);
	});

	it("extends a pending debounced run instead of creating another run", () => {
		seedEventSpec({ debounceSeconds: 30 });
		const first = ingress.ingestEvent({
			eventId: "evt_1",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T10:00:00.000Z",
			dedupeKey: "pr:12",
			attributes: { repository: "acme/api" },
		});
		nowMs = Date.parse("2026-04-23T10:00:10.000Z");

		const second = ingress.ingestEvent({
			eventId: "evt_2",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T10:00:10.000Z",
			dedupeKey: "pr:12",
			attributes: { repository: "acme/api" },
		});

		expect(second.queuedRuns).toHaveLength(1);
		expect(second.queuedRuns[0]?.runId).toBe(first.queuedRuns[0]?.runId);
		expect(second.queuedRuns[0]?.triggerEventId).toBe("evt_2");
		expect(second.queuedRuns[0]?.scheduledFor).toBe("2026-04-23T10:00:40.000Z");
		expect(store.listRuns()).toHaveLength(1);
	});

	it("suppresses events during cooldown regardless of dedupe key", () => {
		seedEventSpec({ cooldownSeconds: 300 });
		ingress.ingestEvent({
			eventId: "evt_1",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#12",
			occurredAt: "2026-04-23T10:00:00.000Z",
			dedupeKey: "pr:12",
			attributes: { repository: "acme/api" },
		});
		nowMs = Date.parse("2026-04-23T10:02:00.000Z");

		const suppressed = ingress.ingestEvent({
			eventId: "evt_2",
			eventType: "github.pull_request.opened",
			source: "github",
			subject: "acme/api#13",
			occurredAt: "2026-04-23T10:02:00.000Z",
			dedupeKey: "pr:13",
			attributes: { repository: "acme/api" },
		});

		expect(suppressed.queuedRuns).toHaveLength(0);
		expect(suppressed.event.processingStatus).toBe("suppressed");
		expect(suppressed.suppressions[0]?.reason).toBe("cooldown");
		expect(store.listRuns()).toHaveLength(1);
	});
});
