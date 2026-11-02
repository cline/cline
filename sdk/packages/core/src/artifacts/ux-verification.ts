import {
	createTool,
	UxScreenshotSchema,
	UxVerificationCheckSchema,
	type UxVerificationReport,
	UxVerificationReportSchema,
	validateWithZod,
	zodToJsonSchema,
} from "@cline/shared";
import { z } from "zod";

const check = UxVerificationCheckSchema.shape;
const report = UxVerificationReportSchema.shape;
const inputSchema = z.strictObject({
	title: report.title,
	subtitle: report.subtitle,
	checks: z
		.array(
			z.strictObject({
				title: check.title,
				subtitle: check.subtitle,
				status: check.status,
				action: check.action,
				screenshot: z
					.strictObject({
						artifactId: UxScreenshotSchema.shape.id,
						mediaType: UxScreenshotSchema.shape.mediaType,
					})
					.optional(),
			}),
		)
		.min(1)
		.max(24),
});

export function createUxVerificationReportTool() {
	return createTool<unknown, UxVerificationReport>({
		name: "report_ux_verification",
		description:
			"Record observed visual checks as passed, failed, or blocked. " +
			"Use subtitle for the caption and action for the input performed. " +
			"Passed/failed checks require screenshots successfully published in this session; never use artifact IDs returned with an error. " +
			"Judge the observed behavior, not upload success. Without published evidence, use blocked and explain the observation and blocker in subtitle.",
		inputSchema: zodToJsonSchema(inputSchema),
		async execute(input) {
			const { checks, ...metadata } = validateWithZod(inputSchema, input);
			return validateWithZod(UxVerificationReportSchema, {
				kind: "ux_verification",
				version: 1,
				...metadata,
				checks: checks.map(({ screenshot, ...check }, index) => ({
					...check,
					id: String(index + 1),
					screenshot: screenshot && {
						id: screenshot.artifactId,
						modality: "image",
						mediaType: screenshot.mediaType,
						source: { type: "artifact", artifactId: screenshot.artifactId },
					},
				})),
			});
		},
	});
}
