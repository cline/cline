import { DEFAULT_MCP_TIMEOUT_SECONDS, MIN_MCP_TIMEOUT_SECONDS } from "@shared/mcp"
import { z } from "zod"
import { TYPE_ERROR_MESSAGE } from "./constants"

const AutoApproveSchema = z.array(z.string()).default([])

export const BaseConfigSchema = z.object({
	autoApprove: AutoApproveSchema.optional(),
	disabled: z.boolean().optional(),
	timeout: z.number().min(MIN_MCP_TIMEOUT_SECONDS).optional().default(DEFAULT_MCP_TIMEOUT_SECONDS),
	// Marker for servers that were added by remote config sync.
	// Used to identify which servers should be removed when they are no longer in the remote config.
	remoteConfigured: z.boolean().optional(),
	// OAuth state written by the CLI — preserved as-is (VSCode doesn't implement OAuth flows yet)
	oauth: z.unknown().optional(),
	// Arbitrary metadata written by the CLI — preserved as-is
	metadata: z.unknown().optional(),
})

// Transport schemas for the nested format (as written by the Cline CLI)
const nestedStdioTransportSchema = z.object({
	type: z.literal("stdio"),
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	cwd: z.string().optional(),
	env: z.record(z.string(), z.string()).optional(),
})

const nestedSseTransportSchema = z.object({
	type: z.literal("sse"),
	url: z.string().url("URL must be a valid URL format"),
	headers: z.record(z.string(), z.string()).optional(),
})

const nestedStreamableHttpTransportSchema = z.object({
	type: z.literal("streamableHttp"),
	url: z.string().url("URL must be a valid URL format"),
	headers: z.record(z.string(), z.string()).optional(),
})

/**
 * Nested transport format as produced by the Cline CLI (`cline mcp add`).
 *
 * The CLI writes:
 * ```json
 * { "transport": { "type": "streamableHttp", "url": "..." }, "disabled": false, "oauth": { ... } }
 * ```
 *
 * This arm normalises it to the flat format used internally by the extension:
 * ```json
 * { "type": "streamableHttp", "url": "...", "disabled": false, "oauth": { ... } }
 * ```
 *
 * Placed first in the union so the `transport` key acts as an unambiguous discriminator.
 */
const nestedTransportConfigSchema = z
	.object({
		transport: z.discriminatedUnion("type", [
			nestedStdioTransportSchema,
			nestedSseTransportSchema,
			nestedStreamableHttpTransportSchema,
		]),
		disabled: z.boolean().optional(),
		autoApprove: AutoApproveSchema.optional(),
		timeout: z.number().min(MIN_MCP_TIMEOUT_SECONDS).optional().default(DEFAULT_MCP_TIMEOUT_SECONDS),
		remoteConfigured: z.boolean().optional(),
		oauth: z.unknown().optional(),
		metadata: z.unknown().optional(),
	})
	.transform((data) => {
		const { transport, ...rest } = data
		// Flatten: hoist transport fields to the top level (matches the flat format)
		return { ...transport, ...rest }
	})

// Helper function to create a refined schema with better error messages
const createServerTypeSchema = () => {
	return z.union([
		// Nested transport format (as written by the CLI: { transport: { type, ... }, ... })
		// Must be first so the presence of a `transport` key is an unambiguous discriminator.
		nestedTransportConfigSchema,
		// Stdio config (has command field)
		BaseConfigSchema.extend({
			type: z.literal("stdio").optional(),
			transportType: z.string().optional(), // Support legacy field
			command: z.string(),
			args: z.array(z.string()).optional(),
			cwd: z.string().optional(),
			env: z.record(z.string(), z.string()).optional(),
			// Allow other fields for backward compatibility
			url: z.string().optional(),
			headers: z.record(z.string(), z.string()).optional(),
		})
			.transform((data) => {
				// Support both type and transportType fields
				const finalType = data.type || (data.transportType === "stdio" ? "stdio" : undefined) || "stdio"
				return {
					...data,
					type: finalType as "stdio",
					// Remove the legacy field after transformation
					transportType: undefined,
				}
			})
			.refine((data) => data.type === "stdio", { message: TYPE_ERROR_MESSAGE }),
		// SSE config (has url field)
		// IMPORTANT: The fact that this is listed first before streamableHttp means that when type is not specified, it will default to sse. Since there may be users with older MCP servers configured without a type specified, rearranging this to make streamableHttp first will be a breaking change.
		BaseConfigSchema.extend({
			type: z.literal("sse").optional(),
			transportType: z.string().optional(), // Support legacy field
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string(), z.string()).optional(),
			// Allow other fields for backward compatibility
			command: z.string().optional(),
			args: z.array(z.string()).optional(),
			env: z.record(z.string(), z.string()).optional(),
		})
			.transform((data) => {
				// Support both type and transportType fields
				const finalType =
					data.type || (data.transportType === "sse" ? "sse" : undefined) || (data.transportType ? undefined : "sse")
				return {
					...data,
					type: finalType as "sse",
					// Remove the legacy field after transformation
					transportType: undefined,
				}
			})
			.refine((data) => data.type === "sse", { message: TYPE_ERROR_MESSAGE }),
		// Streamable HTTP config (has url field)
		BaseConfigSchema.extend({
			type: z.literal("streamableHttp").optional(),
			transportType: z.string().optional(), // Support legacy field
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string(), z.string()).optional(),
			// Allow other fields for backward compatibility
			command: z.string().optional(),
			args: z.array(z.string()).optional(),
			env: z.record(z.string(), z.string()).optional(),
		})
			.transform((data) => {
				// Support both type and transportType fields
				const finalType =
					data.type ||
					(data.transportType === "http" || data.transportType === "streamableHttp" ? "streamableHttp" : undefined) ||
					(data.transportType ? undefined : "streamableHttp")
				return {
					...data,
					type: finalType as "streamableHttp",
					// Remove the legacy field after transformation
					transportType: undefined,
				}
			})
			.refine((data) => data.type === "streamableHttp", {
				message: TYPE_ERROR_MESSAGE,
			}),
	])
}

export const ServerConfigSchema = createServerTypeSchema()

export const McpSettingsSchema = z.object({
	mcpServers: z.record(z.string(), ServerConfigSchema),
})
