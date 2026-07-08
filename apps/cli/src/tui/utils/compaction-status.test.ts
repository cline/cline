import { describe, expect, it } from "vitest";
import {
	formatCompactionDividerLabel,
	formatTokenCount,
	parseCompactionNoticeMetadata,
} from "./compaction-status";

describe("parseCompactionNoticeMetadata", () => {
	it("extracts a divider entry from a completed auto-compaction notice", () => {
		expect(
			parseCompactionNoticeMetadata({
				kind: "auto_compaction",
				reason: "auto_compaction",
				phase: "completed",
				tokensBefore: 25_101,
				tokensAfter: 6_300,
				messagesBefore: 142,
				messagesAfter: 9,
			}),
		).toEqual({
			compactionMode: "auto",
			status: "completed",
			tokensBefore: 25_101,
			tokensAfter: 6_300,
			messagesBefore: 142,
			messagesAfter: 9,
		});
	});

	it("extracts a streaming divider entry from a started notice", () => {
		expect(
			parseCompactionNoticeMetadata({
				kind: "auto_compaction",
				phase: "started",
			}),
		).toEqual({ compactionMode: "auto", status: "started" });
	});

	it("maps manual compaction notices to manual mode", () => {
		expect(
			parseCompactionNoticeMetadata({
				kind: "manual_compaction",
				phase: "completed",
			})?.compactionMode,
		).toBe("manual");
	});

	it("ignores non-compaction metadata", () => {
		expect(
			parseCompactionNoticeMetadata({ kind: "recovery", phase: "completed" }),
		).toBeUndefined();
		expect(
			parseCompactionNoticeMetadata({ kind: "auto_compaction" }),
		).toBeUndefined();
		expect(parseCompactionNoticeMetadata(undefined)).toBeUndefined();
	});

	it("drops non-numeric counters instead of rendering garbage", () => {
		const parsed = parseCompactionNoticeMetadata({
			kind: "auto_compaction",
			phase: "completed",
			tokensBefore: "25000",
			tokensAfter: Number.NaN,
		});
		expect(parsed?.tokensBefore).toBeUndefined();
		expect(parsed?.tokensAfter).toBeUndefined();
	});
});

describe("formatTokenCount", () => {
	it("formats counts into compact units", () => {
		expect(formatTokenCount(999)).toBe("999");
		expect(formatTokenCount(6_300)).toBe("6.3k");
		expect(formatTokenCount(25_000)).toBe("25k");
		expect(formatTokenCount(1_200_000)).toBe("1.2M");
	});
});

describe("formatCompactionDividerLabel", () => {
	it("includes token and message deltas when present", () => {
		expect(
			formatCompactionDividerLabel({
				kind: "compaction",
				compactionMode: "auto",
				status: "completed",
				tokensBefore: 25_101,
				tokensAfter: 6_300,
				messagesBefore: 142,
				messagesAfter: 9,
			}),
		).toBe("Context compacted · 25.1k → 6.3k tokens · 142 → 9 messages");
	});

	it("labels in-progress compaction", () => {
		expect(
			formatCompactionDividerLabel({
				kind: "compaction",
				compactionMode: "auto",
				status: "started",
			}),
		).toBe("Auto compacting messages");
		expect(
			formatCompactionDividerLabel({
				kind: "compaction",
				compactionMode: "manual",
				status: "started",
			}),
		).toBe("Compacting messages");
	});

	it("labels failed and cancelled compaction", () => {
		expect(
			formatCompactionDividerLabel({
				kind: "compaction",
				compactionMode: "auto",
				status: "failed",
			}),
		).toBe("Compaction failed");
		expect(
			formatCompactionDividerLabel({
				kind: "compaction",
				compactionMode: "auto",
				status: "cancelled",
			}),
		).toBe("Compaction cancelled");
	});

	it("labels inherited working context from forks and restarts", () => {
		expect(
			formatCompactionDividerLabel({
				kind: "compaction",
				compactionMode: "inherited",
				status: "completed",
				messagesBefore: 60,
				messagesAfter: 15,
			}),
		).toBe("Compacted working context carried over · 60 → 15 messages");
	});

	it("labels manual compaction and omits missing counters", () => {
		expect(
			formatCompactionDividerLabel({
				kind: "compaction",
				compactionMode: "manual",
				status: "completed",
			}),
		).toBe("Context compacted (manual)");
	});
});
