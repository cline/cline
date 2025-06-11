import { z } from "zod"

/**
 * Schema for MCP parameter definitions
 */
export const mcpParameterSchema = z.object({
	name: z.string().min(1),
	key: z.string().min(1),
	placeholder: z.string().optional(),
	optional: z.boolean().optional().default(false),
})

/**
 * Schema for MCP installation method with name
 */
export const mcpInstallationMethodSchema = z.object({
	name: z.string().min(1),
	content: z.string().min(1),
	parameters: z.array(mcpParameterSchema).optional(),
	prerequisites: z.array(z.string()).optional(),
})

/**
 * Component type validation
 */
export const marketplaceItemTypeSchema = z.enum(["mode", "mcp"] as const)

/**
 * Schema for a marketplace item (supports both mode and mcp types)
 */
export const marketplaceItemSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1, "Name is required"),
	description: z.string(),
	type: marketplaceItemTypeSchema,
	author: z.string().optional(),
	authorUrl: z.string().url("Author URL must be a valid URL").optional(),
	tags: z.array(z.string()).optional(),
	content: z.union([z.string().min(1), z.array(mcpInstallationMethodSchema)]), // Embedded content (YAML for modes, JSON for mcps, or named methods)
	prerequisites: z.array(z.string()).optional(),
})

/**
 * Local marketplace config schema (JSON format)
 */
export const marketplaceConfigSchema = z.object({
	items: z.record(z.string(), marketplaceItemSchema),
})

/**
 * Local marketplace YAML config schema (uses any for items since they're validated separately by type)
 */
export const marketplaceYamlConfigSchema = z.object({
	items: z.array(z.any()), // Items are validated separately by type-specific schemas
})

// Schemas for YAML files (without type field, as type is added programmatically)
export const modeMarketplaceItemYamlSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	author: z.string().optional(),
	authorUrl: z.string().url().optional(),
	tags: z.array(z.string()).optional(),
	content: z.string(),
	prerequisites: z.array(z.string()).optional(),
})

export const mcpMarketplaceItemYamlSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	author: z.string().optional(),
	authorUrl: z.string().url().optional(),
	url: z.string().url(), // Required url field
	tags: z.array(z.string()).optional(),
	content: z.union([z.string(), z.array(mcpInstallationMethodSchema)]),
	parameters: z.array(mcpParameterSchema).optional(),
	prerequisites: z.array(z.string()).optional(),
})

// Export aliases for backward compatibility (these are the same as the YAML schemas)
export const modeMarketplaceItemSchema = modeMarketplaceItemYamlSchema
export const mcpMarketplaceItemSchema = mcpMarketplaceItemYamlSchema
