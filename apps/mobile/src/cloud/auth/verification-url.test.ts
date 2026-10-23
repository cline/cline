import { describe, expect, it } from "vitest";
import { isAllowedVerificationUrl } from "./verification-url";

describe("isAllowedVerificationUrl", () => {
	it("allows the https URLs WorkOS actually returns", () => {
		expect(
			isAllowedVerificationUrl("https://api.workos.com/device?code=ABCD-1234"),
		).toBe(true);
		expect(
			isAllowedVerificationUrl("https://staging-app.cline.bot/device"),
		).toBe(true);
	});

	it("allows http only on loopback hosts", () => {
		expect(isAllowedVerificationUrl("http://localhost:3000/device")).toBe(true);
		expect(isAllowedVerificationUrl("http://127.0.0.1:7777/device")).toBe(true);
		expect(isAllowedVerificationUrl("http://[::1]:7777/device")).toBe(true);
		expect(isAllowedVerificationUrl("http://evil.example.com/device")).toBe(
			false,
		);
		expect(isAllowedVerificationUrl("http://localhost.evil.com/device")).toBe(
			false,
		);
	});

	it("rejects every non-browser scheme a hostile response could smuggle in", () => {
		for (const url of [
			"cline://open?token=stolen",
			"javascript:alert(1)",
			"file:///etc/passwd",
			"data:text/html,<script>1</script>",
			"itms-apps://apps.apple.com/app/id1",
			"tel:+15551234567",
			"//workos.com/device",
			"workos.com/device",
			"HTTPS:/workos.com",
		]) {
			expect(isAllowedVerificationUrl(url), url).toBe(false);
		}
	});

	it("rejects empty, whitespace-bearing and non-string values", () => {
		expect(isAllowedVerificationUrl("")).toBe(false);
		expect(isAllowedVerificationUrl("   ")).toBe(false);
		expect(isAllowedVerificationUrl("https://workos.com/a b")).toBe(false);
		expect(isAllowedVerificationUrl("https://workos.com\njavascript:1")).toBe(
			false,
		);
		expect(isAllowedVerificationUrl(null)).toBe(false);
		expect(isAllowedVerificationUrl(undefined)).toBe(false);
	});
});
