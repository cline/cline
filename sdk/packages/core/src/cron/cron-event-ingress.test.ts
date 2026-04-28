import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CronEventSpec } from "@clinebot/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	automationEventMatchesFilters,
	CronEventIngress,
} from "./cron-event-ingress";
import { SqliteCronStore } from "./sqlite-cron-store";

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
