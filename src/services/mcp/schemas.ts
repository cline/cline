import { z } from "zod"
import { DEFAULT_MCP_TIMEOUT_SECONDS, MIN_MCP_TIMEOUT_SECONDS } from "@shared/mcp"
import { TYPE_ERROR_MESSAGE } from "./constants"

export const AutoApproveSchema = z.array(z.string()).default([])

export const BaseConfigSchema = z.object({
	autoApprove: AutoApproveSchema.optional(),
	disabled: z.boolean().optional(),
	timeout: z.number().min(MIN_MCP_TIMEOUT_SECONDS).optional().default(DEFAULT_MCP_TIMEOUT_SECONDS),
})

// Helper function to create a refined schema with better error messages
const createServerTypeSchema = () => {
	return z.union([
		// Stdio config (has command field)
		BaseConfigSchema.extend({
			type: z.literal("stdio").optional(),
			transportType: z.string().optional(), // Support legacy field
			command: z.string(),
			args: z.array(z.string()).optional(),
			cwd: z.string().optional(),
			env: z.record(z.string()).optional(),
			// Allow other fields for backward compatibility
			url: z.string().optional(),
			headers: z.record(z.string()).optional(),
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
		BaseConfigSchema.extend({
			type: z.literal("sse").optional(),
			transportType: z.string().optional(), // Support legacy field
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			// Allow other fields for backward compatibility
			command: z.string().optional(),
			args: z.array(z.string()).optional(),
			env: z.record(z.string()).optional(),
		})
			.transform((data) => {
				// Support both type and transportType fields
				const finalType = data.type || (data.transportType === "sse" ? "sse" : undefined) || "sse"
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
			headers: z.record(z.string()).optional(),
			// Allow other fields for backward compatibility
			command: z.string().optional(),
			args: z.array(z.string()).optional(),
			env: z.record(z.string()).optional(),
		})
			.transform((data) => {
				// Support both type and transportType fields
				// Note: legacy transportType was "http" not "streamableHttp"
				const finalType = data.type || (data.transportType === "http" ? "streamableHttp" : undefined) || "streamableHttp"
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
	mcpServers: z.record(ServerConfigSchema),
})
