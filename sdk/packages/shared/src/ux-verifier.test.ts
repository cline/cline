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
			screenshot: {
				id: "frame-one",
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			},
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
							id: "frame-one",
							modality: "image",
							mediaType: "image/png",
							source: {
								type: "url",
								url: "https://example.com/screenshot.png?signature=example",
							},
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
						screenshot: {
							id: "frame-one",
							modality: "image",
							mediaType: "image/png",
							source: { type: "url", url },
						},
					},
				],
			}).success,
		).toBe(false);
	});
});
it("preserves canonical artifact references and metadata without storing a signed URL", () => {
	const screenshot = {
		id: "frame-one",
		modality: "image",
		mediaType: "image/png",
		name: "Opened menu",
		sizeBytes: 123,
		source: { type: "artifact", artifactId: " frame/雪 " },
	};
	const parsed = UxVerificationReportSchema.parse({
		...report,
		checks: [{ ...report.checks[0], screenshot }],
	});
	expect(parsed.checks[0].screenshot).toEqual(screenshot);
	expect(JSON.stringify(parsed)).not.toContain("https:");
});
it("accepts GIF evidence supported by the existing media renderer", () => {
	expect(
		UxVerificationReportSchema.safeParse({
			...report,
			checks: [
				{
					...report.checks[0],
					screenshot: {
						...report.checks[0].screenshot,
						mediaType: "image/gif",
					},
				},
			],
		}).success,
	).toBe(true);
});
it.each([
	{
		id: "frame",
		modality: "image",
		mediaType: "image/png",
		source: { type: "artifact", artifactId: "" },
	},
	{
		id: "frame",
		modality: "video",
		mediaType: "video/webm",
		source: { type: "artifact", artifactId: "frame" },
	},
	{
		id: "frame",
		modality: "image",
		mediaType: "image/svg+xml",
		source: { type: "artifact", artifactId: "frame" },
	},
	{
		id: "frame",
		modality: "image",
		mediaType: "image/png",
		sizeBytes: -1,
		source: { type: "artifact", artifactId: "frame" },
	},
	{ type: "image", mediaType: "image/png", data: "aGVsbG8=" },
])("rejects invalid or obsolete screenshot content: %j", (screenshot) => {
	expect(
		UxVerificationReportSchema.safeParse({
			...report,
			checks: [{ ...report.checks[0], screenshot }],
		}).success,
	).toBe(false);
});
