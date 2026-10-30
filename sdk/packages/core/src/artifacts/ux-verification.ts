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
			"Report observed visual checks with captions and passed, failed, or blocked results. " +
			"Use subtitle for each screenshot's caption and action for the input that produced it. " +
			"Passed and failed checks require screenshot evidence from successful publish_artifacts results in this session. " +
			"An artifactId accompanied by an error is not published evidence. " +
			"Upload success is not a pass. Without published evidence, report blocked and state what you observed in the subtitle. This tool records your report; it does not run checks or upload files.",
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
