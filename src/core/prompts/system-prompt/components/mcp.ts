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

// ── Progressive tool disclosure (server-driven) ─────────────────────────────
//
// Dumping every tool's full JSON schema into the system prompt every turn does
// not scale past a few dozen tools. Instead we use two levels of detail, keyed
// off server-attached `_meta`:
//
//   • HOT tools  (`_meta.hot === true`): the small, high-frequency set the
//     agent uses constantly (all Tier-1 scientific tools + a curated allowlist
//     of entry points + the discovery tools themselves). Their FULL inputSchema
//     is injected inline so they're zero-round-trip to call correctly.
//
//   • Everything else: injected as a single summary line —
//     `- name — one-line summary (domain)` — grouped by domain. The parameter
//     schema is NOT shown; the agent fetches it on demand via `describe_tool`.
//
// Nothing is ever fully hidden: every tool name + purpose is always visible,
// so the agent can always discover and (after describe_tool) call any tool.
// This is the opposite of the old approach, which hid the very Tier-1/Tier-2
// scientific tools the agent needed.
//
// Backward compatibility: servers that set no `_meta.hot` on any tool (every
// non-AI-Hydro MCP server) get full schemas for all tools — no behaviour change.

function isHotTool(tool: McpTool): boolean {
	return (tool._meta as any)?.hot === true
}

function toolDomain(tool: McpTool): string {
	return (tool._meta as any)?.domain || "general"
}

/** First non-empty line of a description, used for the summary listing. */
function summaryLine(tool: McpTool): string {
	const desc = (tool.description ?? "").trim()
	const first = desc.split("\n").find((l) => l.trim().length > 0) ?? ""
	return first.trim()
}

function renderFullTool(tool: McpTool): string {
	const schemaStr = tool.inputSchema
		? `    Input Schema:
    ${JSON.stringify(tool.inputSchema, null, 2).split("\n").join("\n    ")}`
		: ""
	return `- ${tool.name}: ${tool.description}\n${schemaStr}`
}

function formatMcpServersList(servers: McpServer[]): string {
	return servers
		.filter((server) => server.status === "connected")
		.map((server) => {
			const allTools = server.tools ?? []

			// Disclosure is active only when the server opts in by marking at
			// least one tool hot. Otherwise render every tool fully (legacy).
			const disclosureActive = allTools.some((t) => isHotTool(t))

			const hotTools = disclosureActive ? allTools.filter((t) => isHotTool(t)) : allTools
			const summaryTools = disclosureActive ? allTools.filter((t) => !isHotTool(t)) : []

			// Full schemas for the hot set.
			const fullBlock = hotTools.map(renderFullTool).join("\n\n")

			// Summary lines for everything else, grouped by domain.
			const byDomain = new Map<string, McpTool[]>()
			for (const tool of summaryTools) {
				const d = toolDomain(tool)
				if (!byDomain.has(d)) byDomain.set(d, [])
				byDomain.get(d)!.push(tool)
			}
			const summaryBlock = Array.from(byDomain.entries())
				.sort((a, b) => a[0].localeCompare(b[0]))
				.map(([domain, toolsInDomain]) => {
					const lines = toolsInDomain
						.sort((a, b) => a.name.localeCompare(b.name))
						.map((t) => `- ${t.name} — ${summaryLine(t)}`)
						.join("\n")
					return `**${domain}**\n${lines}`
				})
				.join("\n\n")

			const summaryAdvisory =
				summaryTools.length > 0
					? `\n\n#### More Tools (names only)\nThe tools below are listed by name and summary only. Before calling one for the first time, call \`describe_tool(name)\` to get its exact parameters and a worked example — do NOT guess parameter names. Use \`aihydro_describe_capability(domain)\` to browse a domain.\n\n${summaryBlock}`
					: ""

			const tools = `${fullBlock}${summaryAdvisory}`

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
				(tools ? `\n\n### Available Tools\n${tools}` : "") +
				(templates ? `\n\n### Resource Templates\n${templates}` : "") +
				(resources ? `\n\n### Direct Resources\n${resources}` : "")
			)
		})
		.join("\n\n")
}
