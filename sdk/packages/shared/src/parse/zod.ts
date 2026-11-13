/**
 * Zod Utilities
 *
 * Helper functions for working with Zod schemas.
 */

import { z } from "zod";

type ValidationIssue = z.ZodError["issues"][number];

/**
 * A union reports one `invalid_union` issue whose message is the generic
 * "Invalid input"; the concrete problems live in `issue.errors`, one list per
 * member, and `prettifyError` drops them. Keep the first member's issues so a
 * rejected union still names the field it expected and the key it did not
 * accept.
 */
function unionMemberIssues(issue: ValidationIssue): ValidationIssue[] {
	if (issue.code !== "invalid_union") return [issue];
	const [member] = issue.errors;
	if (!member) return [issue];
	return member.flatMap((nested) =>
		unionMemberIssues(nested).map((leaf) => ({
			...leaf,
			path: [...issue.path, ...leaf.path],
		})),
	);
}

/**
 * Format a validation error for a tool result. Union members are reported with
 * their own issues instead of a bare "Invalid input".
 */
export function formatZodError(error: z.ZodError): string {
	if (!error.issues.some((issue) => issue.code === "invalid_union"))
		return z.prettifyError(error);
	return z.prettifyError(
		new z.ZodError(error.issues.flatMap(unionMemberIssues)),
	);
}

/**
 * Validate input using a Zod schema
 * Throws a formatted error if validation fails
 */
export function validateWithZod<T>(schema: z.ZodType<T>, input: unknown): T {
	const result = schema.safeParse(input);
	if (!result.success) {
		throw new Error(formatZodError(result.error));
	}
	return result.data;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	return z.toJSONSchema(schema);
}
