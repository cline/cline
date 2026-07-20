/**
 * Zod Utilities
 *
 * Helper functions for working with Zod schemas.
 */

import { z } from "zod";

/**
 * Validate input using a Zod schema
 * Throws a formatted error if validation fails
 *
 * Root-level union failures prettify to a bare "✖ Invalid input" with no
 * field-level detail, so callers validating union schemas should pass a
 * `hint` describing the canonical input shape (ideally with an example) to
 * give the model something actionable to recover with. The hint is appended
 * only on such union failures; field-level errors are already specific and
 * would only be muddied by restating the whole shape.
 */
export function validateWithZod<T>(
	schema: z.ZodType<T>,
	input: unknown,
	options?: { hint?: string },
): T {
	const result = schema.safeParse(input);
	if (!result.success) {
		const message = z.prettifyError(result.error);
		throw new Error(
			options?.hint && hasRootUnionIssue(result.error)
				? `${message}. ${options.hint}`
				: message,
		);
	}
	return result.data;
}

function hasRootUnionIssue(error: z.ZodError): boolean {
	return error.issues.some(
		(issue) => issue.code === "invalid_union" && issue.path.length === 0,
	);
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	return z.toJSONSchema(schema);
}
