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
			command: z.string(),
			args: z.array(z.string()).optional(),
			cwd: z.string().optional(),
			env: z.record(z.string()).optional(),
			// Explicitly disallow other types' fields
			url: z.undefined().optional(),
			headers: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "stdio" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "stdio", { message: TYPE_ERROR_MESSAGE }),
		// SSE config (has url field)
		BaseConfigSchema.extend({
			type: z.literal("sse").optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			// Explicitly disallow other types' fields
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "sse" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "sse", { message: TYPE_ERROR_MESSAGE }),
		// Streamable HTTP config (has url field)
		BaseConfigSchema.extend({
			type: z.literal("streamableHttp").optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			// Explicitly disallow other types' fields
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "streamableHttp" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "streamableHttp", {
				message: TYPE_ERROR_MESSAGE,
			}),
	])
}

export const ServerConfigSchema = createServerTypeSchema()

export const McpSettingsSchema = z.object({
	mcpServers: z.record(ServerConfigSchema),
})
