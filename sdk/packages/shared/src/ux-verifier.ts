import { z } from "zod";

export const UxCheckStatusSchema = z.enum(["passed", "failed", "blocked"]);
const text = z.string().trim().min(1).max(2000);

export const UxScreenshotSchema = z
	.object({
		type: z.literal("image"),
		mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
		data: z.string().min(1).optional(),
		url: z
			.string()
			.refine(
				(value) => /^(https?:\/\/|cline-asset:|\/(?!\/))/.test(value),
				"Unsupported screenshot URL",
			)
			.optional(),
	})
	.refine(
		(image) => Boolean(image.data) !== Boolean(image.url),
		"Provide image data or a URL",
	);

export const UxVerificationCheckSchema = z
	.object({
		id: z.string().min(1),
		title: text,
		subtitle: text,
		status: UxCheckStatusSchema,
		action: text.optional(),
		screenshot: UxScreenshotSchema.optional(),
	})
	.refine(
		(check) => check.status === "blocked" || Boolean(check.screenshot),
		"Passed and failed checks require screenshot evidence",
	);

export const UxVerificationReportSchema = z
	.object({
		kind: z.literal("ux_verification"),
		version: z.literal(1),
		title: text,
		subtitle: text,
		checks: z.array(UxVerificationCheckSchema).min(1).max(24),
	})
	.refine(
		(report) =>
			new Set(report.checks.map((check) => check.id)).size ===
			report.checks.length,
		"Result IDs must be unique",
	);

export type UxVerificationReport = z.infer<typeof UxVerificationReportSchema>;
export type UxVerificationCheck = z.infer<typeof UxVerificationCheckSchema>;
export type UxScreenshot = z.infer<typeof UxScreenshotSchema>;
export type UxCheckStatus = z.infer<typeof UxCheckStatusSchema>;
