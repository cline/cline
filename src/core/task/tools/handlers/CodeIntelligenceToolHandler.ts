import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import type { PsiServiceClientInterface } from "@generated/hosts/host-bridge-client-types"
import * as proto from "@shared/proto/index"
import "@utils/path" // Import for toPosix() String prototype extension
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import { getModelInfo } from "../utils/AiOutputTelemetry"

// ─── Types ─────────────────────────────────────────────────

interface ParsedQuery {
	operation: string
	symbolText: string
	filePath?: string
	line?: number
}

interface RefSymbol {
	name: string
	kind: string
	location: string
}

// ─── Handler ───────────────────────────────────────────────

export class CodeIntelligenceToolHandler implements IToolHandler {
	readonly name = ClineDefaultTool.CODE_INTELLIGENCE

	getDescription(block: ToolUse): string {
		const queries = block.params.queries || ""
		const firstLine =
			queries
				.split("\n")
				.find((l: string) => l.trim().length > 0)
				?.trim() || "..."
		return `[${block.name} for '${firstLine}']`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const queriesText: string | undefined = block.params.queries

		// Validate required parameter
		if (!queriesText) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "queries")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Check if PSI client is available
		const psiClient = HostProvider.psi
		if (!psiClient) {
			return formatResponse.toolError(
				"Code intelligence is not available in this environment. Use search_files or list_code_definition_names instead.",
			)
		}

		// Auto-approve: this is a read-only tool, show the result directly
		const sharedMessageProps = {
			tool: "codeIntelligence" as const,
			content: "",
			queries: queriesText,
		}
		await config.callbacks.say("tool", JSON.stringify(sharedMessageProps), undefined, undefined, false)

		try {
			// Parse and execute queries
			const queries = parseQueries(queriesText)
			if (queries.length === 0) {
				return formatResponse.toolError(
					"No valid queries found. Expected format: operation | [file_path[:line] |] symbol_name",
				)
			}

			const cwd = config.cwd
			const results = await executeQueries(psiClient, queries, cwd)
			const formatted = formatResults(queries, results)

			// Capture telemetry for successful code intelligence usage
			const { providerId, modelId } = getModelInfo(config)
			telemetryService.safeCapture(
				() => telemetryService.captureToolUsage(config.ulid, this.name, modelId, providerId, true, true),
				"CodeIntelligenceToolHandler.execute",
			)

			return formatted
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			Logger.error("CodeIntelligence error:", msg)

			// Capture telemetry for failed code intelligence usage
			const { providerId: errProviderId, modelId: errModelId } = getModelInfo(config)
			telemetryService.safeCapture(
				() => telemetryService.captureToolUsage(config.ulid, this.name, errModelId, errProviderId, true, false),
				"CodeIntelligenceToolHandler.execute.error",
			)

			return formatResponse.toolError(`Code intelligence error: ${msg}`)
		}
	}
}

// ─── Query Parsing ─────────────────────────────────────────

function parseQueries(queriesText: string): ParsedQuery[] {
	const results: ParsedQuery[] = []
	const lines = queriesText.split("\n")

	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (line.length === 0 || line.startsWith("#")) {
			continue
		}

		const parts = line.split("|").map((p) => p.trim())

		if (parts.length === 2) {
			results.push({ operation: parts[0], symbolText: parts[1] })
		} else if (parts.length === 3) {
			const [filePart, linePart] = parseFileLine(parts[1])
			results.push({
				operation: parts[0],
				filePath: filePart,
				line: linePart,
				symbolText: parts[2],
			})
		}
		// else: invalid format — skip
	}

	return results
}

function parseFileLine(fileSpec: string): [string, number | undefined] {
	const colonIdx = fileSpec.lastIndexOf(":")
	if (colonIdx > 0) {
		const possibleLine = Number.parseInt(fileSpec.substring(colonIdx + 1))
		if (!isNaN(possibleLine) && possibleLine > 0) {
			return [fileSpec.substring(0, colonIdx), possibleLine]
		}
	}
	return [fileSpec, undefined]
}

// ─── Query Execution ───────────────────────────────────────

interface QueryResult {
	query: ParsedQuery
	response?: proto.host.SymbolQueryResponse
	typeHierarchyResponse?: proto.host.TypeHierarchyResponse
	error?: string
}

async function executeQueries(psiClient: PsiServiceClientInterface, queries: ParsedQuery[], cwd: string): Promise<QueryResult[]> {
	const results: QueryResult[] = []

	for (const query of queries) {
		try {
			const result = await executeSingleQuery(psiClient, query, cwd)
			results.push(result)
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			results.push({ query, error: msg })
		}
	}

	return results
}

async function executeSingleQuery(psiClient: PsiServiceClientInterface, query: ParsedQuery, cwd: string): Promise<QueryResult> {
	const op = query.operation.toLowerCase().trim()

	// Resolve file path to absolute
	const filePath = query.filePath ? path.resolve(cwd, query.filePath) : undefined

	if (op === "search") {
		const response = await psiClient.searchSymbols(
			proto.host.SearchSymbolsRequest.create({
				pattern: query.symbolText,
				maxResults: 20,
			}),
		)
		return { query, response }
	}

	// Build a SymbolQuery for all other operations
	const symbolQuery = proto.host.SymbolQuery.create({
		symbolText: query.symbolText,
		filePath: filePath,
		line: query.line,
	})

	switch (op) {
		case "definition": {
			const response = await psiClient.getDefinition(symbolQuery)
			return { query, response }
		}
		case "references": {
			const response = await psiClient.getReferences(symbolQuery)
			return { query, response }
		}
		case "callers": {
			const response = await psiClient.getCallers(symbolQuery)
			return { query, response }
		}
		case "callees": {
			const response = await psiClient.getCallees(symbolQuery)
			return { query, response }
		}
		case "type_hierarchy": {
			const typeHierarchyResponse = await psiClient.getTypeHierarchy(symbolQuery)
			return { query, typeHierarchyResponse }
		}
		default:
			return {
				query,
				error: `Unknown operation "${op}". Valid operations: search, definition, references, callers, callees, type_hierarchy`,
			}
	}
}

// ─── Result Formatting ─────────────────────────────────────

function formatResults(queries: ParsedQuery[], queryResults: QueryResult[]): string {
	const referencedSymbols = new Map<string, RefSymbol>()
	const sections: string[] = []

	for (let i = 0; i < queryResults.length; i++) {
		const { query, response, typeHierarchyResponse, error } = queryResults[i]
		const header =
			queryResults.length > 1
				? `═══ Query ${i + 1}/${queryResults.length}: ${describeQuery(query)} ═══`
				: `── ${describeQuery(query)} ──`

		sections.push(header)

		if (error) {
			sections.push(error)
			continue
		}

		if (typeHierarchyResponse) {
			sections.push(formatTypeHierarchy(typeHierarchyResponse, referencedSymbols))
			continue
		}

		if (response) {
			if (response.error) {
				sections.push(response.error)
				continue
			}

			if (query.operation.toLowerCase() === "search") {
				sections.push(formatSearchResults(response, referencedSymbols))
			} else {
				sections.push(formatSymbolQueryResults(query, response, referencedSymbols))
			}
		}
	}

	// Append unified reference table
	if (referencedSymbols.size > 0) {
		sections.push(formatReferenceTable(referencedSymbols))
	}

	return sections.join("\n\n")
}

function describeQuery(query: ParsedQuery): string {
	const op = query.operation.toLowerCase()
	const loc = query.filePath ? (query.line ? `${query.filePath}:${query.line}` : query.filePath) : ""
	const locSuffix = loc ? ` (${loc})` : ""

	switch (op) {
		case "search":
			return `Symbol search: "${query.symbolText}"`
		case "definition":
			return `definition of \`${query.symbolText}\`${locSuffix}`
		case "references":
			return `references of \`${query.symbolText}\`${locSuffix}`
		case "callers":
			return `callers of \`${query.symbolText}\`${locSuffix}`
		case "callees":
			return `callees of \`${query.symbolText}\`${locSuffix}`
		case "type_hierarchy":
			return `type hierarchy of \`${query.symbolText}\`${locSuffix}`
		default:
			return `${op} \`${query.symbolText}\`${locSuffix}`
	}
}

function formatSearchResults(response: proto.host.SymbolQueryResponse, referencedSymbols: Map<string, RefSymbol>): string {
	const allResults = response.groups?.flatMap((g) => g.results || []) || []

	if (allResults.length === 0) {
		return "No symbols found."
	}

	const lines: string[] = [`Found ${allResults.length} symbol${allResults.length === 1 ? "" : "s"}:`, ""]

	for (let i = 0; i < allResults.length; i++) {
		const r = allResults[i]
		const kindSuffix = r.kind && r.kind !== "symbol" ? ` — ${r.kind}` : ""
		const containerSuffix = r.containerName ? ` in ${r.containerName}` : ""
		const shortPath = shortenPath(r.filePath)

		lines.push(`${i + 1}. ${r.symbolName}()${kindSuffix}${containerSuffix}`)
		lines.push(`   ${shortPath}:${r.line}`)

		if (r.containerName) {
			addRefSymbol(referencedSymbols, r.containerName, "container", r.containerFilePath, r.containerLine)
		}
	}

	return lines.join("\n")
}

function formatSymbolQueryResults(
	query: ParsedQuery,
	response: proto.host.SymbolQueryResponse,
	referencedSymbols: Map<string, RefSymbol>,
): string {
	const groups = response.groups || []

	if (groups.length === 0) {
		return `No ${query.operation} found for ${query.symbolText}.`
	}

	const lines: string[] = []
	const multiGroup = groups.length > 1

	for (const group of groups) {
		const def = group.definition
		const results = group.results || []

		if (multiGroup && def) {
			const kindSuffix = def.kind && def.kind !== "symbol" ? ` — ${def.kind}` : ""
			const containerSuffix = def.containerName ? ` in ${def.containerName}` : ""
			lines.push(`━━ ${def.symbolName}()${kindSuffix}${containerSuffix} (${shortenPath(def.filePath)}:${def.line}) ━━`)
			lines.push("")
		}

		if (query.operation.toLowerCase() === "definition" && def) {
			// For definition queries, show the definition itself
			const shortPath = shortenPath(def.filePath)
			lines.push(`${shortPath}:${def.line}`)
			lines.push(`│ ${def.lineContent}`)
			const kindSuffix = def.kind && def.kind !== "symbol" ? ` — ${def.kind}` : ""
			const containerSuffix = def.containerName ? ` in ${def.containerName}` : ""
			lines.push(`│ symbol: ${def.symbolName}${kindSuffix}${containerSuffix}`)

			if (def.containerName) {
				addRefSymbol(referencedSymbols, def.containerName, "container", def.containerFilePath, def.containerLine)
			}
			continue
		}

		if (results.length === 0) {
			lines.push(`No ${query.operation} found.`)
			continue
		}

		const totalLabel = `${results.length} ${query.operation}`
		if (!multiGroup && def) {
			lines.push(`${totalLabel} of \`${def.symbolName}\` (${shortenPath(def.filePath)}:${def.line})`)
			lines.push("")
		}

		for (let i = 0; i < results.length; i++) {
			const r = results[i]
			const shortPath = shortenPath(r.filePath)
			lines.push(`${i + 1}. ${shortPath}:${r.line}`)
			lines.push(`   │ ${r.lineContent}`)

			if (r.containerName) {
				const kindSuffix = r.kind && r.kind !== "symbol" ? ` — ${r.kind}` : ""
				lines.push(`   │ in: ${r.containerName}()${kindSuffix}`)
				addRefSymbol(referencedSymbols, r.containerName, r.kind || "symbol", r.containerFilePath, r.containerLine)
			}
			lines.push("")
		}

		if (group.truncated) {
			lines.push("(results truncated)")
		}
	}

	return lines.join("\n")
}

function formatTypeHierarchy(response: proto.host.TypeHierarchyResponse, referencedSymbols: Map<string, RefSymbol>): string {
	if (response.error) {
		return response.error
	}

	const target = response.target
	if (!target) {
		return "No type hierarchy information available."
	}

	const lines: string[] = []
	lines.push(`${shortenPath(target.filePath)}:${target.line}`)
	lines.push("")

	// Supertypes
	lines.push("Supertypes:")
	const supertypes = response.supertypes || []
	if (supertypes.length === 0) {
		lines.push("  (none found)")
	} else {
		let indent = "  "
		for (const st of supertypes) {
			const kindSuffix = st.kind && st.kind !== "symbol" ? st.kind : "class"
			const loc = st.filePath ? `${shortenPath(st.filePath)}:${st.line}` : "(JDK)"
			lines.push(`${indent}└─ ${st.symbolName} — ${kindSuffix} at ${loc}`)
			indent += "   "
			addRefSymbol(referencedSymbols, st.symbolName, kindSuffix, st.filePath, st.line)
		}
	}

	lines.push("")

	// Subtypes
	lines.push("Subtypes:")
	const subtypes = response.subtypes || []
	if (subtypes.length === 0) {
		lines.push("  (none found)")
	} else {
		for (const st of subtypes) {
			const kindSuffix = st.kind && st.kind !== "symbol" ? st.kind : "class"
			const loc = st.filePath ? `${shortenPath(st.filePath)}:${st.line}` : "(unknown)"
			lines.push(`  └─ ${st.symbolName} — ${kindSuffix} at ${loc}`)
			addRefSymbol(referencedSymbols, st.symbolName, kindSuffix, st.filePath, st.line)
		}
		if (response.subtypesTruncated) {
			lines.push("  (subtypes truncated)")
		}
	}

	return lines.join("\n")
}

function formatReferenceTable(referencedSymbols: Map<string, RefSymbol>): string {
	const lines: string[] = ["── Referenced Symbols ──"]
	const maxNameLen = Math.max(...Array.from(referencedSymbols.values()).map((s) => s.name.length))

	for (const [, sym] of referencedSymbols) {
		const padded = sym.name.padEnd(maxNameLen + 2)
		lines.push(`  ${padded}— ${sym.kind} at ${sym.location}`)
	}

	return lines.join("\n")
}

// ─── Helpers ───────────────────────────────────────────────

function shortenPath(filePath: string): string {
	if (!filePath) return ""
	// Normalize to POSIX separators for consistent cross-platform display
	const normalized = filePath.toPosix()
	// Try to find src/ and show from there
	const srcIdx = normalized.indexOf("/src/")
	if (srcIdx >= 0) {
		return "src/" + normalized.substring(srcIdx + 5)
	}
	// Otherwise try just the filename parts
	const parts = normalized.split("/")
	if (parts.length > 3) {
		return ".../" + parts.slice(-3).join("/")
	}
	return normalized
}

function addRefSymbol(map: Map<string, RefSymbol>, name: string, kind: string, filePath: string, line: number): void {
	if (!name || map.has(name)) return
	const loc = filePath ? `${shortenPath(filePath)}:${line}` : "(unknown)"
	map.set(name, { name, kind, location: loc })
}
