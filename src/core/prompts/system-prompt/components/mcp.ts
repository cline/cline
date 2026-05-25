import type { McpServer, McpTool } from "@/shared/mcp"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const MCP_TEMPLATE_TEXT = `MCP SERVERS

The Model Context Protocol (MCP) enables communication between the system and locally running MCP servers that provide additional tools and resources to extend your capabilities.

# Connected MCP Servers

When a server is connected, you can use the server's tools via the \`use_mcp_tool\` tool, and access the server's resources via the \`access_mcp_resource\` tool.

{{MCP_SERVERS_LIST}}`

export async function getMcp(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	const servers = context.mcpHub?.getServers() || []
	// Skip the section if there are no servers connected / available
	if (servers.length === 0) {
		return undefined
	}
	return await getMcpServers(servers, variant, context)
}

async function getMcpServers(servers: McpServer[], variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = variant.componentOverrides?.[SystemPromptSection.MCP]?.template || MCP_TEMPLATE_TEXT

	const serversList = servers.length > 0 ? formatMcpServersList(servers) : "(No MCP servers currently connected)"
	return new TemplateEngine().resolve(template, context, {
		MCP_SERVERS_LIST: serversList,
	})
}

// ── Wave 1.5: tier-based tool filtering ─────────────────────────────────────
//
// When an MCP server exposes many tools, putting every full schema in the
// system prompt every turn is wasteful. Servers can tag each tool with
// `_meta.tier` (1 = scientific output, 2 = workflow, 3 = infrastructure /
// discovery) and `_meta.domain`. When a server's total tool schema size
// exceeds TIER_FILTER_CHAR_THRESHOLD, we surface only tier 3 + a small set
// of always-helpful discovery tools, and append a note pointing the agent
// at the discovery tool to expand on demand.
//
// Hidden tools remain fully callable via use_mcp_tool — they're just not
// listed in the system prompt. The agent uses `aihydro_describe_capability`
// (or any list_*/get_*/describe_* tool) to surface a focused subset on demand.
//
// Backward compatibility: servers that don't set `_meta.tier` (every existing
// non-AI-Hydro MCP server) are surfaced fully — no behaviour change.

/** Char threshold above which a server's tool list gets tier-filtered. */
const TIER_FILTER_CHAR_THRESHOLD = 8_000

/** Tool names matching these prefixes are always shown (discovery helpers). */
const ALWAYS_SHOW_PREFIXES = ["list_", "get_", "describe_", "find_", "aihydro_"]

function estimateServerToolChars(server: McpServer): number {
	if (!server.tools) return 0
	let total = 0
	for (const tool of server.tools) {
		total += (tool.name?.length ?? 0) + (tool.description?.length ?? 0)
		if (tool.inputSchema) {
			total += JSON.stringify(tool.inputSchema).length
		}
	}
	return total
}

function shouldAlwaysShow(tool: McpTool): boolean {
	if (ALWAYS_SHOW_PREFIXES.some((p) => tool.name.startsWith(p))) return true
	const tier = (tool._meta as any)?.tier
	return tier === 3
}

interface FilterResult {
	visible: McpTool[]
	hiddenByDomain: Map<string, number>
}

function applyTierFilter(tools: McpTool[]): FilterResult {
	// Only filter if at least one tool actually carries tier metadata —
	// otherwise we'd be silently hiding tools on third-party servers that
	// don't opt in.
	const hasTierMeta = tools.some((t) => (t._meta as any)?.tier !== undefined)
	if (!hasTierMeta) {
		return { visible: tools, hiddenByDomain: new Map() }
	}

	const visible: McpTool[] = []
	const hiddenByDomain = new Map<string, number>()
	for (const tool of tools) {
		if (shouldAlwaysShow(tool)) {
			visible.push(tool)
			continue
		}
		const domain = (tool._meta as any)?.domain || "general"
		hiddenByDomain.set(domain, (hiddenByDomain.get(domain) ?? 0) + 1)
	}
	return { visible, hiddenByDomain }
}

function formatMcpServersList(servers: McpServer[]): string {
	return servers
		.filter((server) => server.status === "connected")
		.map((server) => {
			const allTools = server.tools ?? []
			const serverChars = estimateServerToolChars(server)
			const filterActive = serverChars > TIER_FILTER_CHAR_THRESHOLD

			const { visible, hiddenByDomain } = filterActive
				? applyTierFilter(allTools)
				: { visible: allTools, hiddenByDomain: new Map<string, number>() }

			const tools = visible
				.map((tool) => {
					const schemaStr = tool.inputSchema
						? `    Input Schema:
    ${JSON.stringify(tool.inputSchema, null, 2).split("\n").join("\n    ")}`
						: ""

					return `- ${tool.name}: ${tool.description}\n${schemaStr}`
				})
				.join("\n\n")

			// Hidden-tools advisory (only when filtering took effect)
			const totalHidden = Array.from(hiddenByDomain.values()).reduce((a, b) => a + b, 0)
			const domainSummary = Array.from(hiddenByDomain.entries())
				.sort((a, b) => b[1] - a[1])
				.map(([d, n]) => `${d} (${n})`)
				.join(", ")
			const hiddenAdvisory =
				totalHidden > 0
					? `\n\n_${totalHidden} additional tools are registered on this server but hidden from this list to keep context tight (domains: ${domainSummary}). Call a discovery tool such as \`aihydro_describe_capability\` with a domain name to surface them. All hidden tools remain fully callable via \`use_mcp_tool\`._`
					: ""

			const templates = server.resourceTemplates
				?.map((template) => `- ${template.uriTemplate} (${template.name}): ${template.description}`)
				.join("\n")

			const resources = server.resources
				?.map((resource) => `- ${resource.uri} (${resource.name}): ${resource.description}`)
				.join("\n")

			const config = JSON.parse(server.config)

			return (
				`## ${server.name}` +
				(config.command
					? ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)`
					: "") +
				(tools ? `\n\n### Available Tools\n${tools}${hiddenAdvisory}` : "") +
				(templates ? `\n\n### Resource Templates\n${templates}` : "") +
				(resources ? `\n\n### Direct Resources\n${resources}` : "")
			)
		})
		.join("\n\n")
}
