import { describe, expect, it } from "vitest";
import {
	clampMcpTimeoutSeconds,
	DEFAULT_MCP_TIMEOUT_SECONDS,
	formatMcpTimeoutErrorMessage,
	isMcpTimeoutConfigured,
	MAX_MCP_TIMEOUT_SECONDS,
	MIN_MCP_TIMEOUT_SECONDS,
	resolveMcpTimeoutSeconds,
} from "./mcp";

describe("resolveMcpTimeoutSeconds", () => {
	it("returns the default for missing or non-numeric values", () => {
		expect(resolveMcpTimeoutSeconds(undefined)).toBe(
			DEFAULT_MCP_TIMEOUT_SECONDS,
		);
		expect(resolveMcpTimeoutSeconds(null)).toBe(DEFAULT_MCP_TIMEOUT_SECONDS);
		expect(resolveMcpTimeoutSeconds("120")).toBe(DEFAULT_MCP_TIMEOUT_SECONDS);
		expect(resolveMcpTimeoutSeconds(Number.NaN)).toBe(
			DEFAULT_MCP_TIMEOUT_SECONDS,
		);
		expect(resolveMcpTimeoutSeconds(Infinity)).toBe(
			DEFAULT_MCP_TIMEOUT_SECONDS,
		);
	});

	it("passes through valid values unchanged", () => {
		expect(resolveMcpTimeoutSeconds(60)).toBe(60);
		expect(resolveMcpTimeoutSeconds(1)).toBe(1);
		expect(resolveMcpTimeoutSeconds(3600)).toBe(3600);
	});

	it("clamps values outside the bounds", () => {
		expect(resolveMcpTimeoutSeconds(0)).toBe(MIN_MCP_TIMEOUT_SECONDS);
		expect(resolveMcpTimeoutSeconds(-5)).toBe(MIN_MCP_TIMEOUT_SECONDS);
		// A milliseconds/seconds mix-up (60000 meaning 60s) clamps instead of
		// becoming ~16 hours.
		expect(resolveMcpTimeoutSeconds(60000)).toBe(MAX_MCP_TIMEOUT_SECONDS);
	});
});

describe("isMcpTimeoutConfigured", () => {
	it("accepts only finite numeric values", () => {
		expect(isMcpTimeoutConfigured(60)).toBe(true);
		expect(isMcpTimeoutConfigured(undefined)).toBe(false);
		expect(isMcpTimeoutConfigured(null)).toBe(false);
		expect(isMcpTimeoutConfigured("60")).toBe(false);
		expect(isMcpTimeoutConfigured(Number.NaN)).toBe(false);
		expect(isMcpTimeoutConfigured(Infinity)).toBe(false);
	});
});

describe("clampMcpTimeoutSeconds", () => {
	it("clamps into [MIN, MAX]", () => {
		expect(clampMcpTimeoutSeconds(0)).toBe(MIN_MCP_TIMEOUT_SECONDS);
		expect(clampMcpTimeoutSeconds(120)).toBe(120);
		expect(clampMcpTimeoutSeconds(999999)).toBe(MAX_MCP_TIMEOUT_SECONDS);
	});
});

describe("formatMcpTimeoutErrorMessage", () => {
	it("names the server, effective bound, and setting to change", () => {
		expect(formatMcpTimeoutErrorMessage("slow-server", 120_000)).toBe(
			'MCP request to "slow-server" timed out after 120s. Increase the "timeout" field (in seconds) for this server in cline_mcp_settings.json.',
		);
	});

	it("can include method context and sub-second precision", () => {
		expect(
			formatMcpTimeoutErrorMessage("slow-server", 1_500, "initialize"),
		).toBe(
			'MCP request to "slow-server" (initialize) timed out after 1.5s. Increase the "timeout" field (in seconds) for this server in cline_mcp_settings.json.',
		);
	});
});
