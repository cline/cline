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

/**
 * Optional field that tolerates an explicit `null` from the model. The
 * advertised JSON Schema stays a plain typed property (a `.nullable()` union
 * has no top-level `type`, which Gemini/Vertex function declarations reject).
 */
export function nullableOptional<T extends z.ZodTypeAny>(schema: T) {
	return z.preprocess(
		(value) => (value === null ? undefined : value),
		schema.optional(),
	);
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	return z.toJSONSchema(schema);
}
