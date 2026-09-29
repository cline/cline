import { z } from "zod";

// A feature-specific allowlist: no repository names, paths, URLs, or free text.
export const pullRequestTelemetrySchema = z.object({
	action: z.enum([
		"shown",
		"open_clicked",
		"create_clicked",
		"checks_expanded",
		"check_clicked",
		"refresh_clicked",
	]),
	prState: z.enum(["unknown", "none", "open", "draft", "closed", "merged"]),
	ciState: z.enum(["none", "pending", "success", "failure", "skipped"]),
	mergeTone: z.enum(["merged", "failure", "warning", "neutral", "success"]),
});

export type PullRequestTelemetry = z.infer<typeof pullRequestTelemetrySchema>;
