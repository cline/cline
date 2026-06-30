// SdkPluginCommandCoordinator — discovers and executes plugin-registered
// slash commands, mirroring the CLI's createWorkspaceChatCommandHost.
//
// Plugins register commands via `api.registerCommand({ name, handler })` in
// their setup(). The ContributionRegistry runs setup() and collects the
// registered commands. This coordinator:
//   1. Lazily loads plugins via resolveAndLoadAgentPlugins (sandbox mode)
//   2. Initializes a ContributionRegistry to run setup() and gather commands
//   3. Exposes getSlashCommands() for autocomplete
//   4. Exposes resolveCommand(text) to execute a /command and return its result

import {
	type AgentExtensionCommand,
	type AgentExtensionCommandResult,
	createContributionRegistry,
	noopBasicLogger,
	resolveAndLoadAgentPlugins,
} from "@cline/core"
import { Logger } from "@shared/services/Logger"

export interface PluginSlashCommand {
	name: string
	description?: string
}

export interface PluginCommandResult {
	reply?: string
	submitPrompt?: string
}

interface LoadedPlugins {
	commands: AgentExtensionCommand[]
	shutdown: () => Promise<void>
}

export class SdkPluginCommandCoordinator {
	private loadedPromise: Promise<LoadedPlugins | undefined> | undefined

	/**
	 * Lazily load plugins and initialize the contribution registry. The result
	 * is cached so subsequent calls reuse the same sandbox process. Returns
	 * undefined if no plugins are installed or loading fails.
	 */
	private ensureLoaded(): Promise<LoadedPlugins | undefined> {
		if (this.loadedPromise) {
			return this.loadedPromise
		}
		this.loadedPromise = (async () => {
			let loaded: Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>
			try {
				loaded = await resolveAndLoadAgentPlugins({
					logger: noopBasicLogger,
				})
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				Logger.warn(`[PluginCommands] Plugin loading failed; continuing without plugin commands (${message})`)
				return undefined
			}
			if (!loaded.extensions.length) {
				await loaded.shutdown?.().catch(() => {})
				return undefined
			}

			const registry = createContributionRegistry({
				extensions: loaded.extensions,
			})
			try {
				await registry.initialize()
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				Logger.warn(`[PluginCommands] Contribution registry initialization failed (${message})`)
				await loaded.shutdown?.().catch(() => {})
				return undefined
			}

			return {
				commands: registry.getRegistrySnapshot().commands,
				shutdown: async () => {
					await loaded.shutdown?.().catch(() => {})
				},
			}
		})()
		return this.loadedPromise
	}

	/**
	 * Return plugin-registered slash commands for autocomplete. Returns an
	 * empty array if no plugins are installed or loading fails.
	 */
	async getSlashCommands(): Promise<PluginSlashCommand[]> {
		const loaded = await this.ensureLoaded()
		if (!loaded) {
			return []
		}
		return loaded.commands
			.filter((cmd) => typeof cmd.handler === "function")
			.map((cmd) => ({
				name: cmd.name,
				description: cmd.description,
			}))
	}

	/**
	 * Resolve a leading /command from a plugin. Returns null if the text does
	 * not match a plugin command. Returns { reply?, submitPrompt? } from the
	 * command handler.
	 */
	async resolveCommand(text: string): Promise<PluginCommandResult | null> {
		if (!text.startsWith("/") || text.length < 2) {
			return null
		}
		const match = text.match(/^\/(\S+)/)
		if (!match?.[1]) {
			return null
		}
		const name = match[1]
		const remainder = text.slice(name.length + 1).trim()

		const loaded = await this.ensureLoaded()
		if (!loaded) {
			return null
		}
		const command = loaded.commands.find(
			(cmd) => cmd.name === name && typeof cmd.handler === "function",
		)
		if (!command?.handler) {
			return null
		}

		try {
			const result: AgentExtensionCommandResult = await command.handler(remainder)
			if (typeof result === "string") {
				return { reply: result }
			}
			return {
				reply: result.reply,
				submitPrompt: result.submitPrompt,
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			Logger.warn(`[PluginCommands] Command "/${name}" failed: ${message}`)
			return { reply: `Command /${name} failed: ${message}` }
		}
	}

	/**
	 * Shut down the plugin sandbox process. Called on extension disposal.
	 */
	async dispose(): Promise<void> {
		const promise = this.loadedPromise
		this.loadedPromise = undefined
		if (promise) {
			const loaded = await promise.catch(() => undefined)
			await loaded?.shutdown().catch(() => {})
		}
	}
}
