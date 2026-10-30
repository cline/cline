import { describe, expect, it } from "vitest";
import { UxVerificationReportSchema } from "./ux-verifier";
const report = {
	kind: "ux_verification",
	version: 1,
	title: "Check navigation",
	subtitle: "Local browser",
	checks: [
		{
			id: "menu",
			title: "Menu opens",
			subtitle: "The menu is visible",
			status: "passed",
			screenshot: { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
		},
	],
};
describe("UX verification presentation contract", () => {
	it("accepts a report without producer or subagent metadata", () => {
		expect(UxVerificationReportSchema.parse(report)).toEqual(report);
	});
	it.each(["passed", "failed"])("requires evidence for %s checks", (status) => {
		expect(
			UxVerificationReportSchema.safeParse({
				...report,
				checks: [{ ...report.checks[0], status, screenshot: undefined }],
			}).success,
		).toBe(false);
	});
	it("allows blocked checks without screenshots", () => {
		expect(
			UxVerificationReportSchema.safeParse({
				...report,
				checks: [
					{ ...report.checks[0], status: "blocked", screenshot: undefined },
				],
			}).success,
		).toBe(true);
	});
	it("rejects duplicate IDs", () => {
		expect(
			UxVerificationReportSchema.safeParse({
				...report,
				checks: [...report.checks, ...report.checks],
			}).success,
		).toBe(false);
	});
	it("accepts host-resolved signed image URLs", () => {
		expect(
			UxVerificationReportSchema.safeParse({
				...report,
				checks: [
					{
						...report.checks[0],
						screenshot: {
							type: "image",
							mediaType: "image/png",
							url: "https://example.com/screenshot.png?signature=example",
						},
					},
				],
			}).success,
		).toBe(true);
	});
	it.each([
		"javascript:alert(1)",
		"//example.com/image.png",
		"data:text/html,script",
	])("rejects unsafe screenshot addresses: %s", (url) => {
		expect(
			UxVerificationReportSchema.safeParse({
				...report,
				checks: [
					{
						...report.checks[0],
						screenshot: { type: "image", mediaType: "image/png", url },
					},
				],
			}).success,
		).toBe(false);
	});
});
