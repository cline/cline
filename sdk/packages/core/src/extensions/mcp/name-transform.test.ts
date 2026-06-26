import { describe, expect, it } from "vitest";
import { defaultMcpToolNameTransform } from "./name-transform";

const MAX_LENGTH = 64;
const VALID_PATTERN = /^[a-zA-Z0-9_-]+$/;

describe("defaultMcpToolNameTransform", () => {
	it("passes through short, valid names unchanged", () => {
		expect(
			defaultMcpToolNameTransform({ serverName: "mock", toolName: "echo" }),
		).toBe("mock__echo");
	});

	it("sanitizes invalid characters", () => {
		const result = defaultMcpToolNameTransform({
			serverName: "my.server",
			toolName: "tool/name",
		});
		expect(result).toMatch(VALID_PATTERN);
		expect(result).not.toContain(".");
		expect(result).not.toContain("/");
	});

	it("truncates valid names longer than 64 characters", () => {
		const toolName = "a".repeat(100);
		const result = defaultMcpToolNameTransform({
			serverName: "server",
			toolName,
		});
		expect(result.length).toBeLessThanOrEqual(MAX_LENGTH);
		expect(result).toMatch(VALID_PATTERN);
	});

	it("keeps names that are exactly at the limit unchanged", () => {
		const toolName = "a".repeat(MAX_LENGTH - "server__".length);
		const rawName = `server__${toolName}`;
		expect(rawName.length).toBe(MAX_LENGTH);
		expect(
			defaultMcpToolNameTransform({ serverName: "server", toolName }),
		).toBe(rawName);
	});

	it("produces distinct names for distinct long inputs via the hash suffix", () => {
		const a = defaultMcpToolNameTransform({
			serverName: "server",
			toolName: `${"x".repeat(80)}_a`,
		});
		const b = defaultMcpToolNameTransform({
			serverName: "server",
			toolName: `${"x".repeat(80)}_b`,
		});
		expect(a).not.toBe(b);
		expect(a.length).toBeLessThanOrEqual(MAX_LENGTH);
		expect(b.length).toBeLessThanOrEqual(MAX_LENGTH);
	});
});
