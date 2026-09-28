import { expect, it } from "vitest";
import { sanitizeStartupError } from "./startup-diagnostics";

it.each([
	"https://user:private-value@host/path",
	"ws://host/?approval_token=private-value",
	'provider settings: {"apiKey":"private-value"}',
	"Authorization: Bearer private-value",
	`${"a".repeat(3000)} password=private-value`,
])("omits sensitive startup messages: %s", (message) => {
	const raw = new Error(message, { cause: new Error("private-value") });
	raw.name = "private-value";
	const safe = sanitizeStartupError(raw);
	expect(safe.message).toBe(
		"Sensitive session-service startup diagnostic omitted",
	);
	expect(safe.stack).not.toContain("private-value");
	expect(safe.cause).toBeUndefined();
	expect(safe.name).toBe("Error");
});

it("retains bounded useful messages without copying raw error fields", () => {
	const raw = Object.assign(
		new Error(`Connection refused\n${"a".repeat(3000)}`),
		{ token: "private-value" },
	);
	const safe = sanitizeStartupError(raw);
	expect(safe.message).toHaveLength(2048);
	expect(safe.message).toMatch(/^Connection refused /);
	expect(JSON.stringify(safe)).not.toContain("private-value");
	expect(sanitizeStartupError({ secret: "private-value" }).message).toBe(
		"Unknown session-service startup failure",
	);
});
