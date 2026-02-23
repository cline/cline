import { parseYamlFrontmatter } from "@core/context/instructions/user-instructions/frontmatter"
import { Logger } from "@shared/services/Logger"
import { ClineDefaultTool, setDynamicToolUseNames } from "@shared/tools"
import chokidar, { type FSWatcher } from "chokidar"
import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { z } from "zod"
import { buildSubagentToolName } from "./SubagentToolName"

/** Default Directory for agent configurations: ~/Documents/Cline/Agents */
export const AGENTS_CONFIG_DIRECTORY_NAME = "Agents"
const SUBAGENT_DYNAMIC_TOOL_NAMESPACE = "subagent"

const AgentBaseConfigSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().trim().min(1),
	tools: z.array(z.nativeEnum(ClineDefaultTool)).default([]),
	modelId: z.string().trim().min(1),
	systemPrompt: z.string().trim().min(1),
})

const AgentConfigFrontmatterSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().trim().min(1),
	modelId: z.string().trim().min(1),
	tools: z.union([z.string(), z.array(z.string())]).optional(),
})

export type AgentBaseConfig = z.infer<typeof AgentBaseConfigSchema>

function normalizeToolName(toolName: string): ClineDefaultTool {
	const trimmed = toolName.trim()
	if (!trimmed) {
		throw new Error("Tool name cannot be empty.")
	}

	const asDefaultTool = trimmed as ClineDefaultTool
	if (Object.values(ClineDefaultTool).includes(asDefaultTool)) {
		return asDefaultTool
	}

	throw new Error(
		`Unknown tool '${trimmed}'. Expected a ClineDefaultTool value (for example: read_file, list_files, search_files).`,
	)
}

function parseTools(tools: string | string[] | undefined): ClineDefaultTool[] {
	if (!tools) {
		return []
	}

	const rawTools = Array.isArray(tools) ? tools : tools.split(",")
	if (rawTools.length === 0) {
		return []
	}

	return Array.from(new Set(rawTools.map(normalizeToolName)))
}

export function parseAgentConfigFromYaml(content: string): AgentBaseConfig {
	const { data, body, hadFrontmatter, parseError } = parseYamlFrontmatter(content)
	if (parseError) {
		throw new Error(`Failed to parse YAML frontmatter: ${parseError}`)
	}
	if (!hadFrontmatter) {
		throw new Error("Missing YAML frontmatter block in agent config file.")
	}

	const parsedFrontmatter = AgentConfigFrontmatterSchema.parse(data)
	const systemPrompt = body.trim()
	if (!systemPrompt) {
		throw new Error("Missing system prompt body in agent config file.")
	}

	return AgentBaseConfigSchema.parse({
		name: parsedFrontmatter.name,
		description: parsedFrontmatter.description,
		modelId: parsedFrontmatter.modelId,
		tools: parseTools(parsedFrontmatter.tools),
		systemPrompt,
	}) as AgentBaseConfig
}

export function getAgentsConfigPath(homeDir = os.homedir()): string {
	return path.join(homeDir, "Documents", "Cline", AGENTS_CONFIG_DIRECTORY_NAME)
}

function normalizeAgentName(name: string): string {
	return name.trim().toLowerCase()
}

function isYamlFile(filePath: string): boolean {
	return /\.(yaml|yml)$/i.test(filePath)
}

export async function readAgentConfigsFromDisk(homeDir = os.homedir()): Promise<Map<string, AgentBaseConfig>> {
	const agentsDirectoryPath = getAgentsConfigPath(homeDir)
	const configs = new Map<string, AgentBaseConfig>()

	try {
		const entries = await fs.readdir(agentsDirectoryPath, { withFileTypes: true })
		const yamlFiles = entries
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.filter(isYamlFile)
			.sort((a, b) => a.localeCompare(b))
		Logger.debug(`[AgentConfigLoader] Found ${yamlFiles.length} YAML file(s).`)

		await Promise.all(
			yamlFiles.map(async (fileName) => {
				const filePath = path.join(agentsDirectoryPath, fileName)
				try {
					const content = await fs.readFile(filePath, "utf8")
					const parsed = parseAgentConfigFromYaml(content)
					Logger.debug(`[AgentConfigLoader] Loaded agent config '${fileName}'`, parsed)
					configs.set(normalizeAgentName(parsed.name), parsed)
				} catch (error) {
					Logger.error(`[AgentConfigLoader] Failed to parse agent config '${fileName}'`, error)
				}
			}),
		)

		return configs
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException
		if (nodeError.code === "ENOENT") {
			return configs
		}
		Logger.error("[AgentConfigLoader] Failed to read agent configs from disk", error)
		throw error
	}
}

export type AgentConfigChangeListener = (configs: ReadonlyMap<string, AgentBaseConfig>, error?: Error) => void

export class AgentConfigLoader {
	private static instance?: AgentConfigLoader

	private readonly homeDir: string
	private readonly directoryPath: string
	private readonly initialLoadPromise: Promise<void>
	private watcher?: FSWatcher
	private cachedConfigs = new Map<string, AgentBaseConfig>()
	private cachedAgentToolNames = new Map<string, string>()
	private cachedToolNameToAgentName = new Map<string, string>()
	private listeners = new Set<AgentConfigChangeListener>()

	private constructor(homeDir = os.homedir()) {
		this.homeDir = homeDir
		this.directoryPath = getAgentsConfigPath(homeDir)
		this.initialLoadPromise = this.load()
			.then(() => undefined)
			.catch((error) => {
				Logger.error("[AgentConfigLoader] Failed to load initial agent configs", error)
			})
			.finally(() =>
				this.watch().catch((error) => Logger.error("[AgentConfigLoader] Failed to start watching agent configs", error)),
			)
	}

	public static getInstance(homeDir = os.homedir()): AgentConfigLoader {
		if (!AgentConfigLoader.instance) {
			AgentConfigLoader.instance = new AgentConfigLoader(homeDir)
		}
		return AgentConfigLoader.instance
	}

	/**
	 * Test-only helper to clear singleton state between unit tests.
	 */
	public static async resetInstanceForTests(): Promise<void> {
		if (!AgentConfigLoader.instance) {
			return
		}

		await AgentConfigLoader.instance.dispose()
		AgentConfigLoader.instance = undefined
	}

	public getConfigPath(): string {
		return this.directoryPath
	}

	public async ready(): Promise<void> {
		await this.initialLoadPromise
	}

	public getCachedConfig(subagentName?: string): AgentBaseConfig | undefined {
		if (!subagentName?.trim()) {
			return undefined
		}
		return this.cachedConfigs.get(normalizeAgentName(subagentName))
	}

	public getAllCachedConfigs(): ReadonlyMap<string, AgentBaseConfig> {
		return new Map(this.cachedConfigs)
	}

	public getAllCachedConfigsWithToolNames(): Array<{ toolName: string; config: AgentBaseConfig }> {
		const result: Array<{ toolName: string; config: AgentBaseConfig }> = []
		for (const [normalizedName, config] of this.cachedConfigs.entries()) {
			const toolName = this.cachedAgentToolNames.get(normalizedName)
			if (toolName) {
				result.push({ toolName, config })
			}
		}
		return result
	}

	public resolveSubagentNameForTool(toolName?: string): string | undefined {
		if (!toolName?.trim()) {
			return undefined
		}

		const normalizedName = this.cachedToolNameToAgentName.get(toolName.trim())
		if (!normalizedName) {
			return undefined
		}

		return this.cachedConfigs.get(normalizedName)?.name
	}

	public isDynamicSubagentTool(toolName?: string): boolean {
		if (!toolName?.trim()) {
			return false
		}
		return this.cachedToolNameToAgentName.has(toolName.trim())
	}

	public async load(): Promise<ReadonlyMap<string, AgentBaseConfig>> {
		const configs = await readAgentConfigsFromDisk(this.homeDir)
		this.cachedConfigs = configs
		this.rebuildDynamicToolMappings()
		Logger.debug(`[AgentConfigLoader] Loaded ${configs.size} agent config(s) from disk.`)
		return this.getAllCachedConfigs()
	}

	public async watch(listener?: AgentConfigChangeListener): Promise<void> {
		if (listener) {
			this.listeners.add(listener)
		}

		if (this.watcher) {
			return
		}

		this.watcher = chokidar.watch(this.directoryPath, {
			persistent: true,
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: 300,
				pollInterval: 100,
			},
		})

		this.watcher
			.on("add", (filePath) => {
				if (isYamlFile(filePath)) {
					void this.reloadAndNotify()
				}
			})
			.on("change", (filePath) => {
				if (isYamlFile(filePath)) {
					void this.reloadAndNotify()
				}
			})
			.on("unlink", (filePath) => {
				if (isYamlFile(filePath)) {
					void this.reloadAndNotify()
				}
			})
			.on("error", (error) => {
				const watcherError = error instanceof Error ? error : new Error(String(error))
				Logger.error("[AgentConfigLoader] Failed to watch agent configs directory", watcherError)
				this.notify(this.cachedConfigs, watcherError)
			})
	}

	public unwatch(listener: AgentConfigChangeListener): void {
		this.listeners.delete(listener)
	}

	public async dispose(): Promise<void> {
		if (!this.watcher) {
			return
		}

		await this.watcher.close()
		this.watcher = undefined
	}

	private async reloadAndNotify(): Promise<void> {
		try {
			await this.load()
			this.notify(this.cachedConfigs)
		} catch (error) {
			const parseError = error instanceof Error ? error : new Error(String(error))
			Logger.error("[AgentConfigLoader] Failed to reload agent configs", parseError)
			this.notify(this.cachedConfigs, parseError)
		}
	}

	private notify(configs: ReadonlyMap<string, AgentBaseConfig>, error?: Error): void {
		for (const listener of this.listeners) {
			listener(new Map(configs), error)
		}
	}

	private rebuildDynamicToolMappings(): void {
		const sortedConfigs = Array.from(this.cachedConfigs.entries()).sort((a, b) => a[0].localeCompare(b[0]))
		const usedToolNames = new Set<string>()
		const agentToolNames = new Map<string, string>()
		const toolNameToAgentName = new Map<string, string>()

		for (const [normalizedName, config] of sortedConfigs) {
			const baseName = buildSubagentToolName(config.name)
			let candidate = baseName
			let suffix = 2
			while (usedToolNames.has(candidate)) {
				const suffixText = `_${suffix++}`
				const maxBaseLength = Math.max(1, 64 - suffixText.length)
				candidate = `${baseName.slice(0, maxBaseLength)}${suffixText}`
			}

			usedToolNames.add(candidate)
			agentToolNames.set(normalizedName, candidate)
			toolNameToAgentName.set(candidate, normalizedName)
		}

		this.cachedAgentToolNames = agentToolNames
		this.cachedToolNameToAgentName = toolNameToAgentName
		setDynamicToolUseNames(SUBAGENT_DYNAMIC_TOOL_NAMESPACE, Array.from(toolNameToAgentName.keys()))
	}
}
