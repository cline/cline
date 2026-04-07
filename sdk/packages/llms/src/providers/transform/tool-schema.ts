import z from "zod";

export function normalizeToolInputSchemaToZod(inputSchema: unknown) {
	return z.fromJSONSchema(
		inputSchema as boolean | z.core.JSONSchema.JSONSchema,
	);
}

export function normalizeToolInputSchema(inputSchema: unknown) {
	return z.toJSONSchema(normalizeToolInputSchemaToZod(inputSchema)) as Record<
		string,
		unknown
	>;
}
