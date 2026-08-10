import { describe, expect, it } from "vitest";
import { truncateNotificationBody } from "../server";

describe("truncateNotificationBody", () => {
	it("keeps short notification bodies unchanged", () => {
		expect(truncateNotificationBody("short reply")).toBe("short reply");
	});

	it("truncates long notification bodies with an ellipsis", () => {
		const body = "a".repeat(200);
		const truncated = truncateNotificationBody(body);
		expect(truncated).toBe(`${"a".repeat(117)}...`);
	});

	it("applies the same truncation budget to multibyte text", () => {
		const body = "🙂".repeat(40);
		const truncated = truncateNotificationBody(body);
		expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(120);
		expect(truncated.endsWith("...")).toBe(true);
	});
});
