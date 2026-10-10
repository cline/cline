import { describe, expect, it } from "vitest";
import {
	isSensitiveKey,
	matchSensitiveKey,
	redactSensitiveData,
	type SensitiveDataRedaction,
	sanitizeSensitiveString,
} from "./sensitive-data";

describe("matchSensitiveKey", () => {
	it("matches exact secret and PII keys case-insensitively", () => {
		expect(matchSensitiveKey("apiKey")).toBe("key-exact");
		expect(matchSensitiveKey("Authorization")).toBe("key-exact");
		expect(matchSensitiveKey("email")).toBe("key-exact");
	});

	it("matches suffixes only at a word boundary", () => {
		expect(matchSensitiveKey("userId")).toBe("key-suffix");
		expect(matchSensitiveKey("org_id")).toBe("key-suffix");
		expect(matchSensitiveKey("total-cost")).toBe("key-suffix");
		expect(matchSensitiveKey("id")).toBe("key-suffix");
		expect(matchSensitiveKey("video")).toBeUndefined();
		expect(matchSensitiveKey("valid")).toBeUndefined();
		expect(isSensitiveKey("model")).toBe(false);
	});
});

describe("sanitizeSensitiveString", () => {
	it("replaces home paths and AWS access key ids", () => {
		expect(
			sanitizeSensitiveString(
				"/Users/alice/repo and /home/bob/x key AKIAABCDEFGHIJKLMNOP",
			),
		).toBe(
			"/Users/REDACTED_USER/repo and /home/REDACTED_USER/x key AKIA_REDACTED",
		);
	});
});

describe("redactSensitiveData", () => {
	it("redacts sensitive keys and value patterns and reports each removal", () => {
		const redactions: SensitiveDataRedaction[] = [];
		const result = redactSensitiveData(
			{
				apiKey: "sk-123",
				nested: { userId: 42, label: "ok" },
				items: [{ token: "t" }, "/home/carol/file"],
				encoded: JSON.stringify({ password: "hunter2" }),
				workspaceId: { kept: "objects under sensitive keys are walked" },
			},
			{ path: "root", onRedaction: (entry) => redactions.push(entry) },
		);
		expect(result).toEqual({
			apiKey: "REDACTED",
			nested: { userId: "REDACTED", label: "ok" },
			items: [{ token: "REDACTED" }, "/home/REDACTED_USER/file"],
			encoded: JSON.stringify({ password: "REDACTED" }),
			workspaceId: { kept: "objects under sensitive keys are walked" },
		});
		expect(redactions).toEqual([
			{ path: "root.apiKey", rule: "key-exact" },
			{ path: "root.nested.userId", rule: "key-suffix" },
			{ path: "root.items[0].token", rule: "key-exact" },
			{ path: "root.items[1]", rule: "value:linux-home-path" },
			{ path: "root.encoded.password", rule: "key-exact" },
		]);
		expect(JSON.stringify(redactions)).not.toContain("sk-123");
	});

	it("is idempotent", () => {
		const once = redactSensitiveData({ email: "a@b.c", cwd: "/Users/dan" });
		const redactions: SensitiveDataRedaction[] = [];
		const twice = redactSensitiveData(once, {
			onRedaction: (entry) => redactions.push(entry),
		});
		expect(twice).toEqual(once);
		expect(redactions).toEqual([]);
	});
});
