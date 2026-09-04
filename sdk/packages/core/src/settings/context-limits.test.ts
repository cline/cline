import { describe, expect, it } from "vitest";
import {
	DEFAULT_CONTEXT_LIMITS,
	MESSAGE_LIMIT_ENV,
	resolveContextLimits,
	TOOL_LIMIT_ENV,
} from "./context-limits";

describe("resolveContextLimits", () => {
	it("returns defaults when nothing is set", () => {
		expect(resolveContextLimits({}, {})).toEqual(DEFAULT_CONTEXT_LIMITS);
	});

	it("applies env over explicit overrides over defaults", () => {
		const limits = resolveContextLimits(
			{ tool: { readLines: 5_000, lineChars: 4_000 } },
			{ [TOOL_LIMIT_ENV.readLines]: "9000" },
		);

		expect(limits.tool.readLines).toBe(9_000);
		expect(limits.tool.lineChars).toBe(4_000);
		expect(limits.tool.searchOutputChars).toBe(
			DEFAULT_CONTEXT_LIMITS.tool.searchOutputChars,
		);
	});

	it("ignores values that are not positive integers", () => {
		for (const raw of ["0", "-5", "abc", "1.5", "", "  "]) {
			const limits = resolveContextLimits(
				{},
				{ [MESSAGE_LIMIT_ENV.toolResultChars]: raw },
			);
			expect(limits.message.toolResultChars).toBe(
				DEFAULT_CONTEXT_LIMITS.message.toolResultChars,
			);
		}
	});

	it("accepts 0 for minOutdatedRewriteBytes, which rewrites eagerly", () => {
		const limits = resolveContextLimits(
			{},
			{ [MESSAGE_LIMIT_ENV.minOutdatedRewriteBytes]: "0" },
		);
		expect(limits.message.minOutdatedRewriteBytes).toBe(0);
	});

	it("keeps the infinity/disable sentinels that switch stale-read rewriting off", () => {
		for (const raw of ["Infinity", "infinity", "disable", "  DISABLE  "]) {
			const limits = resolveContextLimits(
				{},
				{ [MESSAGE_LIMIT_ENV.minOutdatedRewriteBytes]: raw },
			);
			expect(limits.message.minOutdatedRewriteBytes).toBe(
				Number.POSITIVE_INFINITY,
			);
		}
	});

	it("keeps every executor cap clear of the forwarding cap by default", () => {
		const { message, tool } = resolveContextLimits({}, {});
		const largest = Math.max(
			tool.commandOutputChars,
			tool.readOutputChars,
			tool.searchOutputChars,
		);
		// The gap must cover a truncation notice, not merely be positive: an
		// executor's capped output arrives at its budget plus that notice.
		expect(message.toolResultChars - largest).toBeGreaterThanOrEqual(2_000);
	});

	it("lowers executor caps to match a reduced forwarding cap", () => {
		// Spending fewer tokens is a supported choice; the executors follow it
		// down so their output still arrives whole rather than being re-cut.
		const { message, tool } = resolveContextLimits(
			{},
			{ [MESSAGE_LIMIT_ENV.toolResultChars]: "10000" },
		);

		expect(message.toolResultChars).toBe(10_000);
		for (const cap of [
			tool.commandOutputChars,
			tool.readOutputChars,
			tool.searchOutputChars,
		]) {
			expect(cap).toBeLessThan(message.toolResultChars);
		}
	});

	it("raises executor caps together with the forwarding cap", () => {
		const { message, tool } = resolveContextLimits(
			{},
			{
				[MESSAGE_LIMIT_ENV.toolResultChars]: "200000",
				[TOOL_LIMIT_ENV.commandOutputChars]: "150000",
			},
		);

		expect(tool.commandOutputChars).toBe(150_000);
		expect(message.toolResultChars).toBeGreaterThan(tool.commandOutputChars);
	});

	it("keeps a usable executor cap when the forwarding cap is set absurdly low", () => {
		// Collapsing toward 1 would leave an executor emitting a truncation notice
		// longer than the result itself. The floor holds, and the forwarding cap
		// the caller asked for is still respected rather than raised back.
		for (const raw of ["1", "1500"]) {
			const { message, tool } = resolveContextLimits(
				{},
				{ [MESSAGE_LIMIT_ENV.toolResultChars]: raw },
			);
			expect(message.toolResultChars).toBe(Number(raw));
			for (const cap of [
				tool.commandOutputChars,
				tool.readOutputChars,
				tool.searchOutputChars,
				tool.webFetchContentChars,
			]) {
				expect(cap).toBeGreaterThanOrEqual(1_000);
			}
		}
	});

	it("honors an explicitly raised executor cap by raising the forwarding cap", () => {
		// Silently discarding the value the caller asked for would be worse than
		// spending the tokens they asked to spend.
		const { message, tool } = resolveContextLimits(
			{},
			{ [TOOL_LIMIT_ENV.commandOutputChars]: "49000" },
		);

		expect(tool.commandOutputChars).toBe(49_000);
		expect(message.toolResultChars).toBeGreaterThanOrEqual(51_000);
	});

	it("clears web-fetch content by the notice headroom too", () => {
		// web-fetch adds headers and the prompt echo on top of its content slice,
		// so it needs the same clearance as the other budgeted producers.
		const { message, tool } = resolveContextLimits({}, {});
		expect(message.toolResultChars - tool.webFetchContentChars).toBe(2_000);
	});
});
