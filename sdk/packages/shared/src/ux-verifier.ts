import { z } from "zod";
import {
	GeneratedMediaSchema,
	SUPPORTED_IMAGE_MEDIA_TYPES,
} from "./llms/media";

export const UxCheckStatusSchema = z.enum(["passed", "failed", "blocked"]);
const text = z.string().trim().min(1).max(2000);

/** Screenshot evidence is canonical generated image media. Hosts resolve URL
 * and artifact sources; inline bytes use the shared media renderer. */
export const UxScreenshotSchema = GeneratedMediaSchema.safeExtend({
	modality: z.literal("image"),
	mediaType: z.enum(SUPPORTED_IMAGE_MEDIA_TYPES),
});

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
