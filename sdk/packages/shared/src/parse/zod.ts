/**
 * Zod Utilities
 *
 * Helper functions for working with Zod schemas.
 */

import { z } from "zod";

/**
 * Validate input using a Zod schema
 * Throws a formatted error if validation fails
 */
export function validateWithZod<T>(schema: z.ZodType<T>, input: unknown): T {
	const result = schema.safeParse(input);
	if (!result.success) {
		throw new Error(z.prettifyError(result.error));
	}
	return result.data;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	return z.toJSONSchema(schema);
}
